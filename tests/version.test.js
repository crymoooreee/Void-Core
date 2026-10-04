const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { checkVersion } = require('../scripts/check-version');
const root = path.resolve(__dirname, '..');
(async () => {
  const current = require('../package.json').version;
  assert.equal(checkVersion(root), current);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'voidcore-version-'));
  try {
    for (const file of ['package.json','package-lock.json','renderer/index.html','scripts/check-version.js']) {
      const dest = path.join(temporary, file);
      fs.mkdirSync(path.dirname(dest), {recursive:true});
      fs.copyFileSync(path.join(root,file),dest);
    }
    const pkgPath=path.join(temporary,'package.json');
    const original=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
    for (const invalid of ['01.4.6','0.4','0.4.6-beta.01','wrong']) {
      fs.writeFileSync(pkgPath,JSON.stringify({...original,version:invalid}));
      assert.throws(()=>checkVersion(temporary),/SemVer/);
    }
    fs.writeFileSync(pkgPath,JSON.stringify({...original,version:'0.4.7'}));
    assert.throws(()=>checkVersion(temporary),/mismatch/);
    fs.writeFileSync(pkgPath,JSON.stringify(original));
    const bumped=spawnSync(process.platform==='win32'?'npm.cmd':'npm', ['run','version:patch'], {
      cwd:temporary,encoding:'utf8',timeout:30000,shell:process.platform==='win32'
    });
    assert.equal(bumped.status,0,bumped.stdout+'\n'+bumped.stderr);
    const parts=current.split('.').map(Number);
    assert.equal(checkVersion(temporary),`${parts[0]}.${parts[1]}.${parts[2]+1}`);
    assert.equal(checkVersion(root),current,'Real project version must not change during test');
    console.log('Version validation / lock mismatch / isolated patch bump: PASS');
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }

  let exposed, calledChannel;
  vm.runInNewContext(fs.readFileSync(path.join(root,'electron/preload.js'),'utf8'),{
    require:name=>{
      assert.equal(name,'electron');
      return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'voidCore');exposed=value;}},
        ipcRenderer:{invoke:channel=>{calledChannel=channel;return Promise.resolve({version:current});}}};
    }
  });
  await exposed.app.getInfo();
  assert.equal(calledChannel,'app:getInfo');
  console.log('Safe preload version API: PASS');

  const nodes=[{textContent:''},{textContent:''}];
  const document={title:'VoidCore',querySelectorAll:()=>nodes};
  const source=fs.readFileSync(path.join(root,'renderer/js/version.js'),'utf8');
  await vm.runInNewContext(source,{document,window:{voidCore:{app:{getInfo:async()=>({version:current})}}},console});
  assert.ok(nodes.every(n=>n.textContent===current));
  assert.equal(document.title,`VoidCore ${current}`);
  await vm.runInNewContext(source,{document,window:{voidCore:{app:{getInfo:async()=>{throw Error('No IPC');}}}},console:{error:()=>{}}});
  assert.ok(nodes.every(n=>n.textContent==='unavailable'));
  console.log('Sidebar / settings / title / unavailable fallback: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
