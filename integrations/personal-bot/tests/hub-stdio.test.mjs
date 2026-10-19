import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PassThrough} from 'node:stream'
import {bridgeMain} from '../src/hub-stdio.mjs'

test('forced bridge pins the owner socket and releases it when SSH output closes',()=>{
  const input=new PassThrough(),output=new PassThrough(),socket=new PassThrough()
  let address
  bridgeMain({input,output,uid:1000,connect:path=>{address=path;return socket}})
  assert.equal(address,'/run/user/1000/odk-personal-bot/agent.sock')
  output.emit('close')
  assert.equal(socket.destroyed,true)
  assert.throws(()=>bridgeMain({uid:0}),/non-root/)
  assert.throws(()=>bridgeMain({uid:null}),/non-root/)
  input.destroy();output.destroy()
})


for (const preserveMainSymlink of [false, true]) test('forced bridge starts through the current release symlink with SSH input open' + (preserveMainSymlink ? ' with preserved main symlinks' : ''), {
  skip: process.platform === 'win32' ? 'The forced resident bridge runs on CM5 with a Unix owner' : false,
  timeout: 10000,
}, async t => {
  const {mkdtemp,mkdir,writeFile,readFile,symlink,rm,realpath}=await import('node:fs/promises')
  const {join}=await import('node:path')
  const {tmpdir}=await import('node:os')
  const {pathToFileURL}=await import('node:url')
  const {createServer}=await import('node:net')
  const {spawn}=await import('node:child_process')
  const {once}=await import('node:events')
  const {endpoint}=await import('./helpers/private-channel.mjs')
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-hub-entry-'))),release=join(directory,'release'),current=join(directory,'current')
  await mkdir(release)
  const entry=join(release,'hub-stdio.mjs'),linkedEntry=join(current,'hub-stdio.mjs'),address=endpoint(directory,'hub'),peers=new Set()
  await writeFile(entry,await readFile(new URL('../src/hub-stdio.mjs',import.meta.url)))
  await symlink(release,current,'dir')
  const network=join(directory,'private-network.mjs'),preload=join(directory,'private-hook.mjs')
  await writeFile(network,`import net from 'node:net';import assert from 'node:assert/strict';
export default {connect(address){assert.equal(address,'/run/user/'+process.getuid()+'/odk-personal-bot/agent.sock');return net.connect(${JSON.stringify(address)})}};`)
  await writeFile(preload,`import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(context.parentURL===${JSON.stringify(pathToFileURL(preserveMainSymlink ? linkedEntry : entry).href)}&&specifier==='node:net')return {url:${JSON.stringify(pathToFileURL(network).href)},shortCircuit:true};return next(specifier,context)}});`)
  let command,child,output='',stderr=''
  const request=new Promise(resolve=>{command=resolve})
  const server=createServer(peer=>{
    peers.add(peer)
    let input=''
    peer.on('error',()=>{})
    peer.on('data',chunk=>{input+=chunk;if(input.includes('\n')){command(input);peer.write('{"v":1,"type":"status","state":"idle"}\n')}})
  })
  t.after(async()=>{
    for(const peer of peers)peer.destroy()
    if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed}
    if(server.listening)await new Promise(resolve=>server.close(resolve))
    await rm(directory,{recursive:true,force:true})
  })
  server.listen(address);await once(server,'listening')
  child=spawn(process.execPath,[...(preserveMainSymlink ? ['--preserve-symlinks-main'] : []),'--import',pathToFileURL(preload).href,linkedEntry],{stdio:['pipe','pipe','pipe']})
  const closed=once(child,'close').then(([code])=>{throw Error('Forced bridge exited before status while SSH input was open: '+code+' '+stderr)})
  const response=new Promise(resolve=>child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))resolve(output)}))
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(0,4000)})
  child.stdin.on('error',()=>{})
  child.stdin.write('{"v":1,"type":"status"}\n')
  assert.equal(await Promise.race([request,closed]),'{"v":1,"type":"status"}\n')
  assert.equal(await Promise.race([response,closed]),'{"v":1,"type":"status","state":"idle"}\n')
  assert.equal(child.exitCode,null)
  assert.equal(stderr,'')
})


test('importing the bridge from stdin does not resolve stdin as an entry file', { timeout: 10000 }, async t => {
  const {spawn}=await import('node:child_process')
  const {once}=await import('node:events')
  const child=spawn(process.execPath,['--input-type=module','-'],{stdio:['pipe','pipe','pipe']})
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed}})
  let output='',stderr=''
  child.stdout.on('data',chunk=>{output+=chunk})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.stdin.end(`await import(${JSON.stringify(new URL('../src/hub-stdio.mjs',import.meta.url).href)})`)
  const [code]=await once(child,'close')
  assert.equal(code,0,stderr)
  assert.equal(output,'')
  assert.equal(stderr,'')
})
