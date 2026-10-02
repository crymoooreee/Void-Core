const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(relative, deps) {
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
    module, exports:module.exports, require:name => {
      if (!(name in deps)) throw new Error('Unexpected dependency: '+name);
      return deps[name];
    }, Date, console, process, setTimeout, clearTimeout
  });
  return module.exports;
}
(async () => {
  let processesCalls=0;
  const snapshot = load('core/monitor/process-snapshot.js', {
    systeminformation:{processes:async()=>{processesCalls++; await new Promise(r=>setTimeout(r,10)); return {list:[{pid:1,name:'cs2.exe'}]};}}
  });
  const results=await Promise.all(Array.from({length:20},()=>snapshot.getProcessSnapshot()));
  await snapshot.getProcessSnapshot();
  assert.equal(processesCalls,1);
  assert.equal(results[0][0].name,'cs2.exe');
  console.log('Shared process cache / concurrent calls: PASS');

  let graphicsCalls=0, tempCalls=0, loadCalls=0, gpuCalls=0;
  const hardware=load('core/monitor/hardware.js', {
    systeminformation:{
      currentLoad:async()=>{loadCalls++; return {currentLoad:40};},
      cpuTemperature:async()=>{tempCalls++; return {main:60};},
      mem:async()=>({total:16*1024**3,used:8*1024**3,available:8*1024**3}),
      graphics:async()=>{graphicsCalls++; return {controllers:[]};}
    },
    child_process:{execFile:(file,args,options,cb)=>{gpuCalls++; setTimeout(()=>cb(null,'NVIDIA,60,40,8192,2048,6144'),5);}},
    os:require('os')
  });
  const info=await Promise.all(Array.from({length:20},()=>hardware.getSystemInfo()));
  await hardware.getSystemInfo();
  assert.equal(loadCalls,1); assert.equal(tempCalls,1); assert.equal(gpuCalls,1); assert.equal(graphicsCalls,0);
  assert.equal(info[0].memory.used,8);
  console.log('Hardware dedup / NVIDIA skips graphics fallback / GB: PASS');

  const fps=require('../core/performance/fps-monitor');
  fps._test.resetFPSData();
  const csv=fs.readFileSync(path.join(root,'tests/fixtures/presentmon-synthetic.csv'),'utf8');
  const started=process.hrtime.bigint();
  for(let i=0;i<csv.length;i+=4096) fps._test.consumePresentMonOutput(csv.slice(i,i+4096));
  fps._test.consumePresentMonOutput('\n');
  await new Promise(r=>setTimeout(r,300));
  const result=fps.getFPSData();
  assert.equal(result.frameCount,100);
  const at=result.sampledAt;
  await new Promise(r=>setTimeout(r,300));
  assert.equal(fps.getFPSData().sampledAt,at);
  console.log('Parser frame count / polling does not change freshness: PASS');

  const diagnostic=require('../core/performance/diagnostic-engine');
  diagnostic.resetDiagnostics();
  const game={pid:123,name:'CS2'};
  const sample={timestamp:10000,game,fps:30,frameTime:33,capture:{running:true},cpu:{usage:40},gpu:{usage:40},ram:{usage:40},vram:{usage:40}};
  const history=Array.from({length:8},()=>({fps:120,frameTime:8.3,game}));
  const suppressed=await diagnostic.inspectSample({sample,history,processes:[],windowStateProvider:async()=>({supported:true,isMinimized:true,isForeground:false})});
  assert.equal(suppressed,null);
  const event=await diagnostic.inspectSample({sample:{...sample,timestamp:20000},history,processes:[{pid:0,name:'System Idle Process',cpu:99}],windowStateProvider:async()=>({supported:true,isMinimized:false,isForeground:true,hasVisibleWindow:true})});
  assert.ok(event); assert.equal(event.topProcesses.length,0);
  console.log('Minimized suppression / idle exclusion / real drop: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
