#!/usr/bin/env node
'use strict'
const path = require('node:path')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
/** A forced SSH command may select only this fixed collector's bounded read operation. */
function parseCollectorRequest({args=[],originalCommand='',node=process.execPath,collector=path.resolve(__filename)}={}) {
  if (originalCommand) {
    if (args.length) throw Error('Invalid collector request')
    const prefixes=[`${quote(node)} ${quote(collector)}`]
    if(!/\s/.test(node+collector))prefixes.push(`${node} ${collector}`)
    const prefix=prefixes.find(value=>originalCommand===value || originalCommand.startsWith(`${value} --events=`))
    if(!prefix)throw Error('Invalid collector request')
    args=originalCommand===prefix?[]:[originalCommand.slice(prefix.length+1)]
  }
  if(!args.length)return null
  if(args.length!==1 || !args[0].startsWith('--events=') || !UUID.test(args[0].slice(9)))throw Error('Invalid collector request')
  return args[0].slice(9).toLowerCase()
}
async function main() {
  const requested=parseCollectorRequest({args:process.argv.slice(2),originalCommand:process.env.SSH_ORIGINAL_COMMAND??''})
  const {scanPiSessions,readSessionEvents}=require('../src/pi-sessions')
  const snapshot=await scanPiSessions({strictProcessInspection:true})
  if(!requested)return snapshot
  const matches=snapshot.sessions.filter(session=>(session.sessionId??session.uuid)?.toLowerCase()===requested)
  if(matches.length!==1 || !matches[0].cwd)return {ok:false,reason:'session_identity_unavailable'}
  return {...readSessionEvents({sessionId:requested,cwd:matches[0].cwd}),sessionId:requested,cwd:matches[0].cwd}
}
if(require.main===module)main().then(value=>process.stdout.write(`${JSON.stringify(value)}\n`)).catch(()=>{process.stderr.write('Pi collection failed\n');process.exitCode=1})
module.exports={parseCollectorRequest}
