'use strict'
const { execFile } = require('node:child_process')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
/** An operator binds one reporting identity to its configured read-only collector; never a control grant. */
function createPiBackfill({env=process.env,execute=execFile}={}) {
  return async (record, {signal} = {}) => {
    if(signal?.aborted)return null
    if (!env.ODK_PI_SSH_MACHINE || record.machine!==env.ODK_PI_SSH_MACHINE || !UUID.test(record.sessionId)) return null
    const {ODK_PI_SSH_HOST:host,ODK_PI_SSH_NODE:node,ODK_PI_SSH_COLLECTOR:collector}=env
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host??'') || ![node,collector].every(v=>typeof v==='string' && v.startsWith('/') && !/[\x00-\x1f\x7f]/.test(v))) return null
    return new Promise(resolve=>execute('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ConnectionAttempts=1','-o','ClearAllForwardings=yes','--',host,`${quote(node)} ${quote(collector)} --events=${record.sessionId}`],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024,killSignal:'SIGKILL',signal},(error,stdout)=>{
      try { if(error || signal?.aborted)return resolve(null);const value=JSON.parse(stdout);resolve(value.ok===true && value.sessionId===record.sessionId && value.cwd===record.project && Array.isArray(value.events)?value:null) }catch{resolve(null)}
    }))
  }
}
module.exports={createPiBackfill}
