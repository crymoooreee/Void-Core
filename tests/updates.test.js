const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/update-controller.js'),'utf8'),{
  module:moduleObject,process:{platform:'win32'},setTimeout,clearTimeout,console
});
const {createUpdateController}=moduleObject.exports;
(async()=>{
  const updater=new EventEmitter();
  let game=false, queries=0,checks=0, downloads=0,installs=0;
  const handlers={};
  updater.setFeedURL=feed=>assert.equal(feed.repo,'Void-Core');
  updater.checkForUpdates=async()=>{checks++; updater.emit('update-available',{version:'0.4.7'});};
  updater.downloadUpdate=async token=>{downloads++;updater.emit('update-downloaded',{version:'0.4.7'});};
  updater.quitAndInstall=(silent,restart)=>{assert.equal(silent,false);assert.equal(restart,true);installs++;};
  const controller=createUpdateController({app:{isPackaged:true,getVersion:()=> '0.4.6'},
    ipcMain:{handle:(channel,fn)=>{handlers[channel]=fn;}},
    getRunningGames:async()=>{queries++;return game?[{name:'CS2'}]:[];},
    notify:()=>{},loadUpdater:()=>updater,createToken:()=>({cancel:()=>{}})
  });
  controller.start();
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
  assert.ok(handlers['updates:install']);
  game=true;await controller.check();assert.equal(checks,0);
  game=false;await controller.check();assert.equal(checks,1);assert.equal(controller.snapshot().status,'available');assert.equal(downloads,0);
  game=true;await controller.download();assert.equal(downloads,0);
  game=false;await controller.download();assert.equal(downloads,1);assert.equal(controller.snapshot().status,'downloaded');assert.equal(installs,0);
  game=true;await controller.install();assert.equal(installs,0);
  game=false;await controller.install();assert.equal(installs,1);
  controller.dispose();
  console.log('No automatic download/install; game blocks actions; explicit install: PASS');

  const interrupted=new EventEmitter();
  interrupted.setFeedURL=()=>{};
  interrupted.checkForUpdates=async()=>interrupted.emit('update-available',{version:'0.4.7'});
  let cancelCalled=0;
  let rejectDownload;
  interrupted.downloadUpdate=()=>new Promise((_resolve,reject)=>{rejectDownload=reject;});
  const c=createUpdateController({app:{isPackaged:true,getVersion:()=> '0.4.6'},ipcMain:{handle:()=>{}},
    getRunningGames:async()=>[],notify:()=>{},loadUpdater:()=>interrupted,
    createToken:()=>({cancel:()=>{cancelCalled++;rejectDownload(Error('cancelled'));}})});
  c.start();await c.check();const pending=c.download();
  await new Promise(resolve=>setImmediate(resolve));
  c.onGameActivity(true);await pending;
  assert.equal(cancelCalled,1);assert.equal(c.snapshot().status,'available');c.dispose();
  console.log('Starting a supported game cancels download: PASS');

  const unavailable=createUpdateController({app:{isPackaged:true,getVersion:()=> '0.4.6'},ipcMain:{handle:()=>{}},
    getRunningGames:async()=>[],notify:()=>{},loadUpdater:()=>{throw Error('missing dependency');},createToken:()=>{}});
  unavailable.start();assert.equal(unavailable.snapshot().status,'disabled');unavailable.dispose();
  console.log('Missing updater fails safely: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
