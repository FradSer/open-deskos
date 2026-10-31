const { notPortedOnWindows } = require('./not-ported')
if (notPortedOnWindows(require('node:test').test, 'cm5-tooling')) return
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { findRepositoryRoot } = require('./helpers/repo-root')
const root = findRepositoryRoot(__dirname)
const scriptsDir = fs.existsSync(path.join(root, 'runtime/shell/scripts'))
  ? path.join(root, 'runtime/shell/scripts')
  : path.join(root, 'scripts')
const integrationsDir = fs.existsSync(path.join(root, 'integrations'))
  ? path.join(root, 'integrations')
  : root
const allowed = ['service_runtime.py', ...['__init__','__main__','cli','docker_backend','manifest','manager','python_backend','systemd_controller'].map(n => `odk_service_runtime/${n}.py`)]
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'odk-manager-seal-')))
  const source = path.join(dir, 'integrations')
  for (const name of [...allowed.map(n => `service-runtime/${n}`), 'other/src/main.js', 'service-runtime/tests/test_manager.py', 'service-runtime/.venv/bin/python', 'service-runtime/__pycache__/secret.pyc', 'service-runtime/.env', 'service-runtime/credentials.json', 'service-runtime/private.tmp', 'service-runtime/README.md', 'service-runtime/odk_service_runtime/undeclared.py']) {
    const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture')
  }
  return { dir, source, destination: path.join(dir, 'sealed') }
}
function files(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e=> e.isDirectory() ? files(path.join(dir,e.name)).map(n=>`${e.name}/${n}`) : [e.name]).sort() }
function copy(f) {
  const script = 'source "$1"; run_as_target_user() { "$@"; }; if declare -f copy_integrations_release_input >/dev/null; then copy_integrations_release_input "$2/" "$3/"; else copy_release_input "$2/" "$3/"; fi'
  return spawnSync('bash',['-c',script,'fixture',path.join(scriptsDir,'cm5-personal-agent.sh'),f.source,f.destination],{encoding:'utf8'})
}
test('Given manager developer state, when sealed, then only launcher and declared stdlib modules remain', () => {
  const f=fixture(); try { const r=copy(f); assert.equal(r.status,0,r.stderr); assert.deepEqual(files(path.join(f.destination,'service-runtime')),allowed.sort()); assert.equal(fs.readFileSync(path.join(f.destination,'other/src/main.js'),'utf8'),'fixture') } finally { fs.rmSync(f.dir,{recursive:true,force:true}) }
})
test('Given a symlinked declared module, sealing fails before copying integrations', () => {
  const f=fixture(); try { fs.unlinkSync(path.join(f.source,'service-runtime/service_runtime.py')); fs.symlinkSync('../other/src/main.js',path.join(f.source,'service-runtime/service_runtime.py')); const r=copy(f); assert.notEqual(r.status,0); assert.equal(fs.existsSync(f.destination),false) } finally {fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('Given a missing declared module, sealing fails without a partial destination', () => {
  const f=fixture(); try { fs.unlinkSync(path.join(f.source,'service-runtime/odk_service_runtime/manager.py'));const r=copy(f);assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.destination),false) } finally {fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('Given no optional manager, sealing retains the other integration', () => {
  const f=fixture(); try {fs.rmSync(path.join(f.source,'service-runtime'),{recursive:true});const r=copy(f);assert.equal(r.status,0,r.stderr);assert.deepEqual(files(f.destination),['other/src/main.js'])} finally {fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('Both release paths use the same manager allowlist before transfer or copy', () => {
 const stage=fs.readFileSync(path.join(scriptsDir,'cm5-stage-release.sh'),'utf8'); const install=fs.readFileSync(path.join(scriptsDir,'cm5-install.sh'),'utf8'); assert(stage.includes('"${SERVICE_RUNTIME_RELEASE_FILTERS[@]}"')); assert(stage.indexOf('validate_service_runtime_source "${ROOT}/integrations"') < stage.indexOf('ssh "${TARGET}"')); assert(install.includes('copy_integrations_release_input "${REPOSITORY_ROOT}/${tree}/"')); assert(!/\b(?:uv|docker) (?:install|run|pull)/.test(stage));
})
test('Given source staging, fake SSH and local rsync seal the same whitelist without running the installer', () => {
 const f=fixture();try {
 const repo=path.join(f.dir,'repo'); const scripts=path.join(repo,'runtime/shell/scripts');fs.mkdirSync(scripts,{recursive:true});for(const n of ['cm5-stage-release.sh','cm5-personal-agent.sh']) fs.copyFileSync(path.join(scriptsDir,n),path.join(scripts,n));fs.cpSync(f.source,path.join(repo,'integrations'),{recursive:true});for(const n of ['runtime/android/app/src/main','experiments','peripherals','.agents'])fs.mkdirSync(path.join(repo,n),{recursive:true});fs.writeFileSync(path.join(repo,'DESIGN.md'),'fixture');
 const bin=path.join(f.dir,'bin');fs.mkdirSync(bin);const log=path.join(f.dir,'commands');
 fs.writeFileSync(path.join(bin,'ssh'),'#!/bin/bash\nprintf "%s\\n" "$*" >> "$FIXTURE_LOG"\n');
 fs.writeFileSync(path.join(bin,'rsync'),'#!/bin/bash\nargs=("$@"); last=$(($# - 1)); dest="${args[$last]}"; dest="${dest#*:}"; args[$last]="$dest"; mkdir -p "$dest"; exec /usr/bin/rsync "${args[@]}"\n');
 for(const n of ['uv','docker','systemctl','apt-get','sudo'])fs.writeFileSync(path.join(bin,n),'#!/bin/bash\necho forbidden >> "$FIXTURE_LOG"; exit 91\n');for(const n of fs.readdirSync(bin))fs.chmodSync(path.join(bin,n),0o700);
 const remote=path.join(f.dir,'remote');const r=spawnSync('bash',[path.join(scripts,'cm5-stage-release.sh')],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FIXTURE_LOG:log,ODK_CM5_TARGET:'fixture-never-connected',ODK_RUNTIME_ROOT:remote,ODK_STAGING_ID:'fixture'}});assert.equal(r.status,0,r.stderr);assert.deepEqual(files(path.join(remote,'staging/fixture/repo/integrations/service-runtime')),allowed.sort());assert(fs.readFileSync(log,'utf8').includes('bash scripts/cm5-install.sh'));assert(!fs.readFileSync(log,'utf8').includes('forbidden'));assert.equal(fs.readFileSync(path.join(remote,'staging/fixture/repo/integrations/other/src/main.js'),'utf8'),'fixture');
 } finally {fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('The installer integration branch seals the same sources and retains private-file exclusions', () => {
 const f=fixture();try {fs.writeFileSync(path.join(f.source,'other/.env'),'fixture-secret'); const text=fs.readFileSync(path.join(scriptsDir,'cm5-install.sh'),'utf8'); const start=text.indexOf('  for tree in peripherals integrations experiments .agents; do');const end=text.indexOf('\n  done',start)+7;assert(start>=0 && end>start); const body=text.slice(start,end);const script='source "$1"; run_as_target_user() { "$@"; }; REPOSITORY_ROOT="$2"; RELEASE_DIR="$3"; '+body; const repo=path.join(f.dir,'repo');fs.mkdirSync(repo);fs.renameSync(f.source,path.join(repo,'integrations')); const r=spawnSync('bash',['-c',script,'fixture',path.join(scriptsDir,'cm5-personal-agent.sh'),repo,f.destination],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(files(path.join(f.destination,'integrations/service-runtime')),allowed.sort());assert(!fs.existsSync(path.join(f.destination,'integrations/other/.env')));assert(fs.existsSync(path.join(f.destination,'integrations/other/src/main.js')))
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('A clean sealed manager imports and displays CLI help using only the Python standard library', () => {
 const f=fixture();try{fs.rmSync(path.join(f.source,'service-runtime'),{recursive:true});fs.cpSync(path.join(integrationsDir,'service-runtime'),path.join(f.source,'service-runtime'),{recursive:true});const r=copy(f);assert.equal(r.status,0,r.stderr);const py=spawnSync('python3',['-S',path.join(f.destination,'service-runtime/service_runtime.py'),'--help'],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:f.dir}});assert.equal(py.status,0,py.stderr);for(const name of ['install','update','enable','disable','rollback','remove','inspect','list','run'])assert(py.stdout.includes(name));assert.deepEqual(files(path.join(f.destination,'service-runtime')).filter(n=>!n.includes('__pycache__')),allowed.sort())}finally{fs.rmSync(f.dir,{recursive:true,force:true})}
})
test('A symlinked integration ancestor fails before copying manager sources', () => {
 const f=fixture();try {const alias=path.join(f.dir,'alias');fs.symlinkSync(f.source,alias,'dir');const r=copy({...f,source:alias});assert.notEqual(r.status,0);assert(!fs.existsSync(f.destination))}finally{fs.rmSync(f.dir,{recursive:true,force:true})}
})
