const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const box={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/update-controller.js'),'utf8'),{
  module:box,process:{platform:'win32'},setTimeout,clearTimeout,console
});
const {createUpdateController,isNewerStableVersion,publicUpdateError}=box.exports;
(async()=>{
  for(const version of ['0.4.6','v0.4.6','0.4.6+build.2','0.4.5','0.4.7-beta.1','invalid']) {
    assert.equal(isNewerStableVersion(version,'0.4.6'),false,version);
  }
  for(const version of ['0.4.7','0.4.10','0.5.0','1.0.0'])assert.equal(isNewerStableVersion(version,'0.4.6'),true,version);
  assert.equal(isNewerStableVersion('0.4.9','0.4.10'),false);
  const raw='Cannot parse releases feed: Unable to find latest version on GitHub: HttpError: 406 Headers: set-cookie=SECRET at C:/private/path';
  assert.ok(publicUpdateError(Error(raw)).includes('стабильный релиз'));
  assert.ok(!publicUpdateError(Error(raw)).includes('SECRET'));
  assert.ok(publicUpdateError(Error('latest.yml not found')).includes('latest.yml'));
  console.log('Strict stable version comparison / concise error without headers: PASS');
  let resultVersion='0.4.7';let failure=false;
  const updater=new EventEmitter();updater.setFeedURL=()=>{};
  updater.checkForUpdates=async()=>{
    if(failure){updater.emit('error',Error(raw));throw Error(raw);}
    updater.emit('update-available',{version:resultVersion});
  };
  const c=createUpdateController({app:{isPackaged:true,getVersion:()=> '0.4.6'},ipcMain:{handle:()=>{}},
    getRunningGames:async()=>[],notify:()=>{},loadUpdater:()=>updater,createToken:()=>({cancel:()=>{}})});
  c.start();
  for(const candidate of ['0.4.6','0.4.5','0.4.7-beta.1']){
    resultVersion=candidate;await c.check();assert.equal(c.snapshot().status,'up-to-date');assert.equal(c.snapshot().availableVersion,null);
  }
  resultVersion='0.4.7';await c.check();assert.equal(c.snapshot().status,'available');
  failure=true;await c.check();assert.equal(c.snapshot().status,'error');assert.equal(c.snapshot().availableVersion,null);
  assert.ok(c.snapshot().message.length<300);c.dispose();
  console.log('Same/older/prerelease never advertised; failed check clears stale version: PASS');

  function element(){const classes=new Set(['hidden']);return{classList:{toggle:(name,value)=>value?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},textContent:'',value:0,disabled:false,addEventListener:()=>{}};}
  const ids=['updateMessage','updateAvailableVersion','updateProgress','checkUpdateBtn','downloadUpdateBtn','installUpdateBtn','updateNotice'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  let callback;
  const initial={status:'idle',message:'Idle',availableVersion:null};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/js/updates.js'),'utf8'),{
    document:{getElementById:id=>elements[id],querySelector:()=>({click:()=>{}})},
    window:{voidCore:{updates:{getState:async()=>initial,onState:fn=>{callback=fn;return()=>{};}}},addEventListener:()=>{}}
  });
  await Promise.resolve();
  for(const status of ['idle','checking','error','up-to-date','disabled']){
    callback({status,message:'Status',availableVersion:null});assert.equal(elements.updateNotice.classList.contains('hidden'),true);
  }
  callback({status:'available',message:'New',availableVersion:'0.4.7'});assert.equal(elements.updateNotice.classList.contains('hidden'),false);
  const css=fs.readFileSync(path.join(__dirname,'../renderer/css/style.css'),'utf8');
  assert.ok(/\.update-notice\.hidden,[\s\S]*?display:\s*none\s*!important/.test(css));
  console.log('Notification hidden unless update confirmed; CSS visibility override: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
