import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ALLOWED = new Set(['maps_textsearch', 'taxi_estimate', 'taxi_create_order', 'taxi_query_order', 'taxi_cancel_order', 'taxi_get_driver_location']);
const safeError = () => new Error('滴滴服务请求失败；请检查配置或稍后查询状态。');

async function deadline(operation, timeoutMs, abort = () => {}) {
  let timer;
  try { return await Promise.race([operation, new Promise((_,reject) => {timer=setTimeout(()=>{abort();reject(safeError());},timeoutMs);})]); }
  finally {clearTimeout(timer);}
}

/** Bound every HTTP response body, including streamed SSE and initialization notifications. */
export function boundedDidiFetch(fetchImpl = globalThis.fetch, timeoutMs = 20000, maxBytes = 1048576) {
  return async (url, init = {}) => {
    const signal=AbortSignal.any([...(init.signal ? [init.signal] : []),AbortSignal.timeout(timeoutMs)]);
    const response=await fetchImpl(url,{...init,redirect:'error',signal});
    if(!response.body) return response;
    const reader=response.body.getReader();let bytes=0;
    const body=new ReadableStream({
      async pull(controller) {
        try {
          const result=await reader.read();
          if(result.done) {controller.close();return;}
          bytes+=result.value.byteLength;
          if(bytes>maxBytes) {await reader.cancel();throw safeError();}
          controller.enqueue(result.value);
        } catch {controller.error(safeError());}
      },
      async cancel() {await reader.cancel();},
    });
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
}

/** Credentials never enter returned errors, logs, or persisted state. */
export async function createDidiTransport({ keyFile, sandbox = true, connectTimeoutMs = 15000, clientFactory = () => new Client({name:'open-deskos-rides',version:'1.0.0'}), transportFactory = (url, signal) => new StreamableHTTPClientTransport(url, {fetch:boundedDidiFetch(),reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}, requestInit:{redirect:'error',signal}}) }) {
  let client;
  try {
    const file = await open(keyFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    let key;
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid?.() || info.size > 8192) throw safeError();
      key = (await file.readFile('utf8')).trim();
      if (!key || /\s/.test(key)) throw safeError();
    } finally { await file.close(); }
    const url = new URL(`https://mcp.didichuxing.com/mcp-servers${sandbox ? '-sandbox' : ''}`);
    url.searchParams.set('key', key);
    client = clientFactory();
    client.onerror = () => {};
    const connectionAbort=new AbortController();
    await deadline(client.connect(transportFactory(url,connectionAbort.signal), {timeout:connectTimeoutMs}),connectTimeoutMs,()=>connectionAbort.abort());
  } catch {
    if(client) await deadline(client.close(),1000).catch(() => {});
    throw safeError();
  }
  return {
    async call(name, args) {
      if (!ALLOWED.has(name)) throw new Error('不支持的滴滴操作。');
      try {
        const result = await client.callTool({name,arguments:args}, undefined, {timeout:20000});
        if (result.isError) throw safeError();
        if (name === 'maps_textsearch') {
          const text = result.content.find(part => part.type === 'text');
          if (!text || text.type !== 'text') throw safeError();
          const parsed = JSON.parse(text.text);
          if (!Array.isArray(parsed)) throw safeError();
          return parsed;
        }
        // Sandbox query responses can omit the documented structured status. Text is
        // informational only; never use this compatibility path for mutations.
        if (name === 'taxi_query_order' && result.structuredContent === undefined) {
          const statusText = (result.content ?? []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text.trim()).filter(Boolean).join('\n').slice(0,4096);
          if (!statusText) throw safeError();
          return {statusUnavailable:true,statusText};
        }
        if (!result.structuredContent || typeof result.structuredContent !== 'object') throw safeError();
        return result.structuredContent;
      } catch { throw safeError(); }
    },
    async close() { try { await deadline(client.close(),1000); } catch { throw safeError(); } },
  };
}
