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
