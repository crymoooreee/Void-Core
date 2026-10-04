const fs=require('node:fs/promises');
const path=require('node:path');
const {PriorityOptimizer}=require('./priority-optimizer');
const {HIGH_PERFORMANCE,GUID,validateValue}=require('./windows-profile');
const same=(a,b)=>a.exists===b.exists&&(!a.exists||(a.kind===b.kind&&a.value===b.value));
const disabledValue={exists:true,kind:'DWord',value:0};
class GamingOptimizer {
 constructor({file,priorityFile,getGames,driver,platform=process.platform,onChange=()=>{},prioritySystem,ownPid}){
  Object.assign(this,{file,getGames,driver,platform,onChange});this.settings={highPerformance:false,disableDvr:false};this.records=[];this.queue=Promise.resolve();this.key=null;this.manual=false;this.blocked=false;this.systemMessage='';this.lastBatteryCheck=0;
  this.priority=new PriorityOptimizer({file:priorityFile,getGames,platform,system:prioritySystem,ownPid,onChange:()=>this.publish()});
 }
 snapshot(){const base=this.priority.snapshot();return {...base,supported:base.supported&&!this.blocked,active:base.active||this.records.length>0,settings:{...base.settings,...this.settings},message:[base.message,this.systemMessage].filter(Boolean).join(' ')};}
 publish(){const state=this.snapshot();this.onChange(state);return state;}
 enqueue(task){const pending=this.queue.then(task);this.queue=pending.catch(()=>{});return pending;}
 async save(){await fs.mkdir(path.dirname(this.file),{recursive:true});const h=await fs.open(this.file+'.tmp','w');try{await h.writeFile(JSON.stringify({schemaVersion:1,settings:this.settings,records:this.records}));await h.sync();}finally{await h.close();}await fs.rename(this.file+'.tmp',this.file);}
 async init(){
  await this.priority.init();
  try{const data=JSON.parse(await fs.readFile(this.file,'utf8'));
   if(data.schemaVersion!==1||!data.settings||typeof data.settings.highPerformance!=='boolean'||typeof data.settings.disableDvr!=='boolean'||!Array.isArray(data.records)||data.records.length>3||data.records.some(r=>r.kind==='power'?(!GUID.test(r.original)||r.applied!==HIGH_PERFORMANCE):r.kind==='dvr'?(![0,1].includes(r.index)||!validateValue(r.original)||!same(r.applied||{},disabledValue)):true))throw Error('Invalid system journal');
   this.settings=data.settings;this.records=data.records;
   if(this.platform==='win32')await this.restore();else if(this.records.length)throw Error('Windows recovery required');
  }catch(e){if(e.code!=='ENOENT'){this.blocked=true;this.systemMessage='Системный журнал недоступен: профиль заблокирован; файл сохранён.';}}
  return this.publish();
 }
 async restore(kinds=null){
  const remaining=[];
  for(const r of this.records){if(kinds&&!kinds.includes(r.kind)){remaining.push(r);continue;}
   try{if(r.kind==='power'){if(await this.driver.power()===r.applied){await this.driver.setPower(r.original);if(await this.driver.power()!==r.original)throw Error('Power restore verification failed');}}
    else if(same(await this.driver.readKey(r.index),r.applied)){await this.driver.writeKey(r.index,r.original);if(!same(await this.driver.readKey(r.index),r.original))throw Error('Registry restore verification failed');}
   }catch(e){remaining.push(r);}}
  this.records=remaining;await this.save();if(remaining.some(r=>!kinds||kinds.includes(r.kind)))throw Error('System restore incomplete');
 }
 async journal(record,change){this.records.push(record);try{await this.save();}catch(e){this.records.pop();throw e;}await change();}
 async applySystem(){
  const messages=[];
  if(this.settings.highPerformance){
   if(!await this.driver.onAC())messages.push('План питания пропущен: батарея или неизвестный источник питания.');
   else if(!await this.driver.highAvailable())messages.push('План High Performance отсутствует; новый план не создавался.');
   else{const original=await this.driver.power();if(original!==HIGH_PERFORMANCE){await this.journal({kind:'power',original,applied:HIGH_PERFORMANCE},async()=>{await this.driver.setPower(HIGH_PERFORMANCE);if(await this.driver.power()!==HIGH_PERFORMANCE)throw Error('Power verification failed');});messages.push('Активирован план High Performance (больше расход энергии и нагрев).');}else messages.push('План High Performance уже включён.');}
  }
  if(this.settings.disableDvr){
   for(const index of [0,1]){const original=await this.driver.readKey(index);if(!same(original,disabledValue)){await this.journal({kind:'dvr',index,original,applied:disabledValue},async()=>{await this.driver.writeKey(index,disabledValue);if(!same(await this.driver.readKey(index),disabledValue))throw Error('DVR verification failed');});}}
   messages.push('Настройки записи Xbox Game DVR выключены для текущего пользователя; эффект может требовать перезапуска игры.');
  }
  this.lastBatteryCheck=Date.now();this.systemMessage=messages.join(' ');
 }
 configure(options){return this.enqueue(async()=>{
  if(this.blocked)return this.snapshot();const allowed=['automatic','raiseGame','lowerApp','highPerformance','disableDvr'];
  if(!options||Object.keys(options).some(k=>!allowed.includes(k)||typeof options[k]!=='boolean'))throw Error('Invalid settings');
  await this.restore();const old={...this.settings};this.key=null;this.manual=false;
  this.settings={highPerformance:options.highPerformance??old.highPerformance,disableDvr:options.disableDvr??old.disableDvr};
  try{await this.save();}catch(e){this.settings=old;throw e;}
  const priorities={};for(const k of ['automatic','raiseGame','lowerApp'])if(k in options)priorities[k]=options[k];
  await this.priority.configure(priorities);this.systemMessage='Системные опции сохранены. Изменения применятся вместе с игровым профилем.';return this.publish();
 });}
 optimize(){return this.enqueue(async()=>{
  if(this.blocked||this.platform!=='win32'||!this.priority.state.supported)return this.snapshot();
  try{const games=await this.getGames();if(!games.length){this.systemMessage='Запустите поддерживаемую игру.';return this.publish();}
   await this.restore();await this.priority.optimize();this.manual=true;this.key=this.priority.identity(games[0]);await this.applySystem();return this.publish();
  }catch(e){this.systemMessage='Не все действия выполнены. Проверьте права доступа; нажмите «Восстановить» для отката. Прирост FPS не подтверждён.';return this.publish();}
 });}
 update(game){
  if(this.blocked||this.platform!=='win32'||!this.priority.state.supported)return Promise.resolve(this.snapshot());
  const id=this.priority.identity(game);
  if(!game&&!this.records.length&&!this.key&&!this.manual&&!this.priority.snapshot().active)return this.priority.update(null).then(()=>this.snapshot());
  return this.enqueue(async()=>{
   try{
    if(!game||(this.key&&this.key!==id)){await this.restore();this.key=null;if(!game)this.manual=false;}
    await this.priority.update(game);
    if(game&&(this.priority.settings.automatic||this.manual)&&id!==this.key){
     const fresh=await this.getGames();if(!fresh.some(g=>this.priority.identity(g)===id))throw Error('Game changed');
     this.key=id;await this.applySystem();
    }
    if(this.records.some(r=>r.kind==='power')&&Date.now()-this.lastBatteryCheck>=15000){this.lastBatteryCheck=Date.now();if(!await this.driver.onAC()){await this.restore(['power']);this.systemMessage='План питания восстановлен: работа от батареи или источник питания недоступен.';}}
    if(!game)this.systemMessage='Системные изменения восстановлены.';
    return this.publish();
   }catch(e){this.systemMessage='Не удалось завершить системный профиль или откат. Журнал сохранён для восстановления.';return this.publish();}
  });
 }
 revert(){return this.enqueue(async()=>{if(this.blocked)return this.snapshot();this.manual=false;this.key=null;let failed=false;try{await this.restore();}catch(e){failed=true;}await this.priority.revert();this.systemMessage=failed?'Не все системные изменения восстановлены; журнал сохранён.':'План питания и настройки записи восстановлены.';return this.publish();});}
 close(){return this.enqueue(async()=>{if(!this.blocked)try{await this.restore();}catch(e){this.systemMessage='Откат не завершён; журнал сохранён.';}await this.priority.close();});}
}
module.exports={GamingOptimizer};
