import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {createJevClient as client,checkJevAuthentication as check} from '../../src/jev-client.mjs'
import {createJevJudge as judge} from '../../src/proactive-jev.mjs'
import {createJevIntentRouter as router} from '../../src/intent-routing.mjs'
import {createJudgmentClient as judgment} from '../../src/judgment-client.mjs'

// Real Pi authentication with an empty credential store. Never read user credentials or model overrides.
export async function isolatedRuntime(env = {}) {
  const runtime = await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,
    credentials:{read:async()=>undefined,list:async()=>[],modify:async()=>{throw Error('Read only fixture')},delete:async()=>{throw Error('Read only fixture')}}})
  for(const id of ['typesafe','opencode','opencode-go']) {
    const provider=runtime.getProvider(id),apiKey=provider.auth.apiKey
    runtime.registerNativeProvider({...provider,auth:{...provider.auth,apiKey:{...apiKey,
      resolve:input=>apiKey.resolve({...input,ctx:{...input.ctx,env:async name=>env[name]}})}}})
  }
  return runtime
}
const options = input => ({...input,env:{TYPESAFE_API_KEY:'',OPENCODE_API_KEY:'',...input?.env},runtime:input?.runtime ?? isolatedRuntime(input?.env)})
export const createJevClient = input => client(options(input))
export const checkJevAuthentication = input => check(options(input))
export const createJevJudge = input => judge(options(input))
export const createJevIntentRouter = input => router(options(input))
export const createJudgmentClient = input => judgment({createJev:createJevClient,...input})
