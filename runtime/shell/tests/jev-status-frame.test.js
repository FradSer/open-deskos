const {test}=require('node:test')
const assert=require('node:assert/strict')
const {parseJevStatus}=require('../src/jev-status-frame')

test('Jev authentication projection accepts only fixed status and reason values',()=>{
  for (const status of ['checking','verified','missing_credential','auth_rejected','unavailable']) {
    assert.deepEqual(parseJevStatus({status,token:'private',path:'/private',body:'upstream'}),{status})
  }
  for (const reason of ['timeout','network','rate_limited','upstream','invalid_response','configuration','credential_unavailable','request_rejected']) {
    assert.deepEqual(parseJevStatus({status:'unavailable',reason}),{status:'unavailable',reason})
  }
  for (const value of [null,[],{},'verified',{status:'ready'},{status:'verified',reason:'network'},{status:'verified',reason:'private error'}]) {
    assert.deepEqual(parseJevStatus(value),{status:'unavailable'})
  }
  assert.equal(parseJevStatus(undefined),undefined)
})
