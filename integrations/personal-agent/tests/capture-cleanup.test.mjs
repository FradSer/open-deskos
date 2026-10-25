import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,realpath,mkdir,writeFile,lstat,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cleanStaleCaptures} from '../src/capture-cleanup.mjs'

test('startup clears private local and remote audio before admission and preserves other entries',{skip:process.platform==='win32'?'CM5 owns server capture cleanup':false},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'odk-stale-')))
 t.after(()=>rm(root,{recursive:true,force:true}))
 for(const name of ['capture-ABC123','remote-voice-abc123','preserved']){await mkdir(join(root,name),{mode:0o700});await writeFile(join(root,name,'audio.wav'),'private',{mode:0o600})}
 await cleanStaleCaptures(root)
 await assert.rejects(lstat(join(root,'capture-ABC123')),{code:'ENOENT'})
 await assert.rejects(lstat(join(root,'remote-voice-abc123')),{code:'ENOENT'})
 assert.equal((await lstat(join(root,'preserved','audio.wav'))).isFile(),true)
 await symlink(join(root,'preserved'),join(root,'remote-voice-ABC123'))
 await assert.rejects(cleanStaleCaptures(root),/Unsafe stale/)
 assert.equal((await lstat(join(root,'preserved','audio.wav'))).isFile(),true)
})
