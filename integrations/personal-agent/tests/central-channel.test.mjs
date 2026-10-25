import {test} from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {PersonalAgentService} from '../src/service.mjs'
import {listen} from '../src/socket.mjs'
import {createDisplayRelay} from '../src/display-relay.mjs'
import {createRemoteVoice} from '../src/remote-voice.mjs'
import {createDisplayVoice} from '../src/display-voice.mjs'
import {createConversationProjection} from '../src/conversation-projection.mjs'
import {readFrames,writeFrame} from '../src/channel-frames.mjs'
import {endpoint,fixtureToken} from './helpers/private-channel.mjs'

async function until(check){const deadline=Date.now()+2500;while(!check()){if(Date.now()>deadline)assert.fail('Central state did not arrive');await new Promise(r=>setTimeout(r,5))}}
function wav(){const b=Buffer.alloc(44+640);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(640,40);return b}

test('actual channels admit Windows audio and CM5 audio through one resident and one public history', {timeout:5000,skip:process.platform==='win32'?'CM5 resident socket and remote recording require the Linux owner host':false},async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-central-'))),bytes=wav(),file=join(directory,'fixture.wav')
 await writeFile(file,bytes,{mode:0o600})
 let localRecords=0,displayRecords=0,prompts=0,transcriptions=0
 const capture=()=>({done:new Promise(()=>{}),stop:async()=>file,cleanup:async()=>{}})
 const service=new PersonalAgentService({record:async()=>{localRecords++;return capture()},transcribe:async path=>{assert.deepEqual(await readFile(path),bytes);transcriptions++;return '中文语音指令'},prompt:async text=>{assert.equal(text,'中文语音指令');return '中央回复 '+(++prompts)}})
 const history=await createConversationProjection({file:join(directory,'public.json')})
 const unsubscribe=service.subscribe(status=>{if(!service.closed)history.observe(status)})
 const voice=createRemoteVoice({service,directory})
 const hub=await listen(endpoint(directory,'hub'),service,{remoteVoice:voice,conversation:history,token:fixtureToken})
 const relay=await createDisplayRelay({endpoint:endpoint(directory,'display'),stateDir:directory,alias:'cm5-agent',token:fixtureToken,connect:()=>net.connect(endpoint(directory,'hub')),
  createVoice:({send})=>createDisplayVoice({send,record:async()=>{displayRecords++;return capture()}})})
 const client=net.connect(endpoint(directory,'display')),frames=[]
 readFrames(client,frame=>{frames.push(frame)},{maxFrame:131072,maxBatch:524288})
 t.after(async()=>{client.destroy();await relay.close();await hub.close();unsubscribe();await history.close();await service.close();await rm(directory,{recursive:true,force:true})})
 await once(client,'connect');await writeFrame(client,{v:1,type:'status'})
 await until(()=>frames.some(f=>f.state==='idle'))
 await writeFrame(client,{v:1,type:'toggle'});await until(()=>displayRecords===1)
 assert.equal(service.sendText('不得并发'),false)
 assert.equal(localRecords,0);assert.equal(prompts,0)
 // CM5 MIC can stop the recording owned by the Windows source.
 await service.toggle();await until(()=>prompts===1&&service.status.state==='idle')
 await until(()=>frames.some(f=>f.type==='conversation'&&f.conversation.turns.at(-1)?.message==='中央回复 1'))
 assert.equal(transcriptions,1);assert.equal(displayRecords,1)
 const firstId=history.snapshot().conversation.turns[0].id
 // A Windows MIC control can stop the recording owned by CM5.
 const recordingFrames=frames.filter(f=>f.state==='recording').length
 await service.toggle();await until(()=>localRecords===1&&frames.filter(f=>f.state==='recording').length>recordingFrames)
 await writeFrame(client,{v:1,type:'toggle'});await until(()=>prompts===2&&service.status.state==='idle')
 await until(()=>frames.some(f=>f.type==='conversation'&&f.conversation.turns.at(-1)?.message==='中央回复 2'))
 assert.equal(localRecords,1);assert.equal(displayRecords,1);assert.equal(transcriptions,2)
 assert.equal(history.snapshot().conversation.turns.length,2)
 assert.notEqual(history.snapshot().conversation.turns[1].id,firstId)
 // Cancelling from either display discards audio instead of creating another turn.
 const beforeCancel=frames.filter(f=>f.state==='recording').length
 await writeFrame(client,{v:1,type:'toggle'});await until(()=>displayRecords===2)
 await writeFrame(client,{v:1,type:'cancel_recording'});await until(()=>service.status.state==='idle')
 assert.equal(transcriptions,2);assert.equal(history.snapshot().conversation.turns.length,2)
 await service.toggle();await until(()=>localRecords===2&&frames.filter(f=>f.state==='recording').length>beforeCancel)
 await writeFrame(client,{v:1,type:'cancel_recording'});await until(()=>service.status.state==='idle')
 assert.equal(transcriptions,2);assert.equal(history.snapshot().conversation.turns.length,2)

})
