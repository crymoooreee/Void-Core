const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SessionStore } = require('../core/performance/session-store');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'voidcore-sessions-'));
  let timestamp = 100000;
  const create = () => new SessionStore({directory,appVersion:'0.4.6',now:()=>timestamp});
  const game = {name:'CS2',pid:123,platform:'Steam',startedAt:'start-1'};
  const data = (fps,extra={}) => ({active:true,game, sample:{timestamp,game,fps,frameTime:8,capture:{running:true,stale:false}},diagnostics:[],suppressedEvents:[],...extra});
  try {
    const store = create();await store.init();
    await store.ingest(data(120));
    const id = store.active.id;
    assert.equal((await fs.readdir(directory)).filter(x=>x.endsWith('.json')).length,1);
    timestamp+=2000;
    const event={id:'drop-1',timestamp,game,title:'CPU',fps:40,beforeFps:120};
    await store.ingest(data(60,{diagnostics:[event]}));
    await store.ingest(data(0,{diagnostics:[event],sample:{timestamp,game,fps:0,capture:{running:true,stale:true}}}));
    assert.equal(store.active.stats.validSamples,2);
    assert.equal(store.active.stats.drops,1);
    assert.equal(store.list().items[0].averageSampledFps,90);
    timestamp+=4000;
    await store.ingest({active:false});
    assert.equal(store.active,null);
    assert.equal((await store.get(id)).endReason,'game-closed');
    const restarted=create();await restarted.init();
    assert.equal(restarted.list().total,1);
    assert.equal((await restarted.get(id)).events.length,1);
    await assert.rejects(()=>restarted.get('../package.json'));
    console.log('Session boundaries / persisted restart / statistics / event dedup / ID validation: PASS');

    timestamp+=10000;await restarted.ingest(data(100));
    const activeId=restarted.active.id;
    await restarted.flush();
    // Simulated abrupt termination: no close() call on restarted instance.
    const recovered=create();await recovered.init();
    assert.equal((await recovered.get(activeId)).status,'interrupted');
    assert.equal((await recovered.get(activeId)).endedAt,timestamp);
    timestamp+=10000;await recovered.ingest(data(110));
    const switchedId=recovered.active.id;
    timestamp+=2000;await recovered.ingest(data(120,{game:{...game,pid:456},sample:{timestamp,game:{...game,pid:456},fps:120,capture:{running:true}}}));
    assert.equal((await recovered.get(switchedId)).endReason,'game-switched');
    await recovered.close();
    assert.equal(recovered.list().total,4);
    assert.equal(recovered.list({offset:1,limit:2}).items.length,2);
    assert.equal(recovered.list().items[0].endReason,'app-closed');
    console.log('Crash recovery / process switch / quit / pagination: PASS');

    const badName='00000000-0000-0000-0000-000000000000.json';
    await fs.writeFile(path.join(directory,badName),'broken');
    const corrupt=create();await corrupt.init();
    assert.ok(corrupt.list().error);
    assert.equal(await fs.readFile(path.join(directory,badName),'utf8'),'broken');
    console.log('Corrupt file preserved, usable history remains: PASS');

    const blockedPath=path.join(directory,'blocked');
    await fs.mkdir(blockedPath);
    const blocked=new SessionStore({directory:blockedPath,appVersion:'0.4.6',now:()=>timestamp});await blocked.init();
    await fs.rm(blockedPath,{recursive:true});await fs.writeFile(blockedPath,'not a directory');
    await blocked.ingest(data(100));
    assert.ok(blocked.list().error);assert.equal(blocked.pending.size,1);
    console.log('Write failure reported; pending data retained: PASS');
  } finally {await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
