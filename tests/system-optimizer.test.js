const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {GamingOptimizer}=require('../core/optimizer/gaming-optimizer');
const {HIGH_PERFORMANCE,validateValue}=require('../core/optimizer/windows-profile');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voidcore-system-'));
 const balanced='381b4222-f694-41f0-9685-ff5bb260df2e',other='a1841308-3541-4fab-bc81-f71556f20b4a';
 let power=balanced,ac=true,available=true,denied=false;
 let keys=[{exists:true,kind:'DWord',value:1},{exists:false,kind:null,value:null}];
 const driver={power:async()=>power,highAvailable:async()=>available,setPower:async g=>{power=g;},onAC:async()=>ac,
  readKey:async i=>({...keys[i]}),writeKey:async(i,value)=>{if(denied)throw Error('Denied');keys[i]={...value};}};
 const game={pid:123,name:'CS2',startedAt:'start'};const values=new Map([[123,0],[999,0]]);
 const system={constants:{priority:{PRIORITY_ABOVE_NORMAL:-7,PRIORITY_BELOW_NORMAL:10}},getPriority:pid=>values.get(pid),setPriority:(pid,value)=>values.set(pid,value)};
 const create=()=>new GamingOptimizer({file:path.join(dir,'system.json'),priorityFile:path.join(dir,'priority.json'),getGames:async()=>[game],driver,platform:'win32',prioritySystem:system,ownPid:999});
 try{
  let optimizer=create();await optimizer.init();await optimizer.optimize();assert.equal(power,balanced);assert.equal(keys[0].value,1);await optimizer.revert();
  await optimizer.configure({highPerformance:true,disableDvr:true});assert.equal(power,balanced);assert.equal(keys[0].value,1);
  await optimizer.optimize();assert.equal(power,HIGH_PERFORMANCE);assert.equal(keys[0].value,0);assert.equal(keys[1].value,0);
  await optimizer.revert();assert.equal(power,balanced);assert.equal(keys[0].value,1);assert.equal(keys[1].exists,false);
  console.log('System actions opt-in only; power and DVR applied, verified and exactly restored: PASS');

  ac=false;await optimizer.configure({highPerformance:true,disableDvr:false});await optimizer.optimize();assert.equal(power,balanced);assert.ok(optimizer.snapshot().message.includes('батарея'));await optimizer.revert();ac=true;
  available=false;await optimizer.optimize();assert.equal(power,balanced);await optimizer.revert();available=true;
  console.log('Battery and unavailable scheme never switch power: PASS');

  await optimizer.configure({highPerformance:true,disableDvr:true});await optimizer.optimize();
  values.set(999,0);optimizer=create();await optimizer.init();assert.equal(power,balanced);assert.equal(keys[0].value,1);assert.equal(keys[1].exists,false);
  console.log('Crash journal restores system settings on next start: PASS');

  await optimizer.configure({automatic:true,highPerformance:true,disableDvr:false});await optimizer.update(game);assert.equal(power,HIGH_PERFORMANCE);
  ac=false;optimizer.lastBatteryCheck=0;await optimizer.update(game);assert.equal(power,balanced);ac=true;await optimizer.revert();
  console.log('Switch to battery restores owned power scheme: PASS');

  await optimizer.configure({highPerformance:true,disableDvr:true});await optimizer.optimize();power=other;keys[0]={exists:true,kind:'DWord',value:2};await optimizer.revert();assert.equal(power,other);assert.equal(keys[0].value,2);assert.equal(keys[1].exists,false);
  console.log('User/external changes preserved: PASS');

  power=balanced;keys[0]={exists:true,kind:'DWord',value:1};denied=true;await optimizer.optimize();assert.ok(optimizer.snapshot().message.includes('Не все'));assert.ok(optimizer.records.length);denied=false;await optimizer.revert();assert.equal(power,balanced);assert.equal(keys[0].value,1);
  console.log('Partial failures retain journal, allow rollback and never claim full success: PASS');
  await optimizer.close();await fs.writeFile(path.join(dir,'system.json'),'corrupt');const bad=create();await bad.init();await bad.close();assert.equal(bad.snapshot().supported,false);assert.equal(await fs.readFile(path.join(dir,'system.json'),'utf8'),'corrupt');
  assert.equal(validateValue({exists:true,kind:'String',value:'1'}),false);
  console.log('Corrupt journal preserved; unsupported registry types rejected: PASS');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
