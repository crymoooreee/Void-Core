const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {calculateLows}=require('../core/performance/low-metrics');const {PriorityOptimizer}=require('../core/optimizer/priority-optimizer');
(async()=>{
 assert.equal(calculateLows(Array.from({length:999},()=>({frameTime:10}))).onePercentLow,null);
 const a=calculateLows(Array.from({length:1000},()=>({frameTime:10})));assert.equal(a.onePercentLow,100);assert.equal(a.pointOnePercentLow,null);
 const lows=calculateLows(Array.from({length:10000},(_,i)=>({frameTime:i<10?100:i<100?20:10})));assert.equal(lows.pointOnePercentLow,10);assert.ok(Math.abs(lows.onePercentLow-1000/28)<1e-9);console.log('Low calculation and warm-up: PASS');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voidcore-priority-'));const file=path.join(dir,'optimizer.json');let game={pid:123,name:'CS2',startedAt:'start1'},games=[game],lookups=0;const values=new Map([[123,0],[999,0]]);
 const system={constants:{priority:{PRIORITY_ABOVE_NORMAL:-7,PRIORITY_BELOW_NORMAL:10}},getPriority:pid=>values.get(pid),setPriority:(pid,v)=>values.set(pid,v)};
 const create=()=>new PriorityOptimizer({file,system,platform:'win32',ownPid:999,getGames:async()=>{lookups++;return games;}});
 try{
 const e=create();await e.init();await e.update(game);assert.equal(values.get(123),0);await e.configure({automatic:true});await e.update(game);assert.equal(values.get(123),-7);assert.equal(values.get(999),10);const n=lookups;await e.update(game);assert.equal(lookups,n);await e.revert();assert.equal(values.get(123),0);assert.equal(values.get(999),0);
 await e.optimize();const recovery=create();await recovery.init();assert.equal(values.get(123),0);values.set(999,0);await recovery.optimize();games=[{...game,startedAt:'start2'}];values.set(123,0);const reused=create();await reused.init();assert.equal(values.get(123),0);
 games=[game];values.set(999,0);await reused.optimize();values.set(123,5);await reused.revert();assert.equal(values.get(123),5);assert.equal(values.get(999),0);
 values.set(123,0);await reused.configure({automatic:true});await reused.update(game);await reused.update(null);assert.equal(values.get(123),0);assert.equal(values.get(999),0);await reused.close();
 await fs.writeFile(file,'corrupt');const bad=create();await bad.init();await bad.close();assert.equal(bad.snapshot().supported,false);assert.equal(await fs.readFile(file,'utf8'),'corrupt');
 const denied=new PriorityOptimizer({file:path.join(dir,'denied.json'),platform:'win32',ownPid:999,getGames:async()=>games,system:{...system,setPriority:()=>{throw Error('Denied');}}});await denied.init();await denied.optimize();assert.equal(denied.records.length,0);assert.ok(denied.snapshot().message.includes('Не удалось'));
 console.log('Opt-in, apply, rollback, crash recovery, PID reuse, external changes, denial and corrupt journal: PASS');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
