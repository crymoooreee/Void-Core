const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
class PriorityOptimizer {
  constructor({file,getGames,platform=process.platform,system=os,ownPid=process.pid,onChange=()=>{}}){
    Object.assign(this,{file,getGames,platform,system,ownPid,onChange});
    this.settings={automatic:false,raiseGame:true,lowerApp:true};this.records=[];this.manual=false;this.key=null;this.blocked=false;this.queue=Promise.resolve();
    this.state={supported:platform==='win32',active:false,message:'Оптимизация не применена.'};
  }
  snapshot(){return {...this.state,settings:{...this.settings}};}
  publish(message){this.state.active=this.records.length>0;this.state.message=message;this.onChange(this.snapshot());return this.snapshot();}
  enqueue(task){const next=this.queue.then(task);this.queue=next.catch(()=>{});return next;}
  async save(){await fs.mkdir(path.dirname(this.file),{recursive:true});const f=await fs.open(this.file+'.tmp','w');try{await f.writeFile(JSON.stringify({schemaVersion:1,settings:this.settings,records:this.records}));await f.sync();}finally{await f.close();}await fs.rename(this.file+'.tmp',this.file);}
  matches(r,g){return r.pid===g.pid&&r.name===g.name&&r.startedAt&&r.startedAt===g.startedAt;}
  identity(g){return g?`${g.pid}:${g.startedAt||''}:${g.name}`:null;}
  async init(){
    try{
      const data=JSON.parse(await fs.readFile(this.file,'utf8'));const p=this.system.constants.priority;
      if(data.schemaVersion!==1||!Array.isArray(data.records)||data.records.length>2||!data.settings||['automatic','raiseGame','lowerApp'].some(k=>typeof data.settings[k]!=='boolean')||data.records.some(r=>!['game','app'].includes(r.kind)||!Number.isInteger(r.pid)||r.pid<=0||!Number.isInteger(r.original)||r.original < -20||r.original > 19||(r.kind==='game'&&(r.applied!==p.PRIORITY_ABOVE_NORMAL||r.original<=r.applied||!r.startedAt||typeof r.name!=='string'))||(r.kind==='app'&&(r.applied!==p.PRIORITY_BELOW_NORMAL||r.original>=r.applied))))throw Error('Invalid journal');
      this.settings=data.settings;this.records=data.records.filter(r=>r.kind==='game');
      if(this.platform==='win32')await this.restore();else{this.records=[];await this.save();}
    }catch(e){if(e.code==='ENOENT')return this.publish('Автоматический режим выключен.');this.blocked=true;this.state.supported=false;this.settings.automatic=false;return this.publish('Ошибка журнала восстановления: изменения заблокированы, исходный файл сохранён.');}
    return this.publish('Настройки загружены; профиль предыдущего запуска восстановлен или пропущен при смене процесса/приоритета.');
  }
  async restore(){
    this.key=null;const games=this.records.some(r=>r.kind==='game')?await this.getGames():[];const remaining=[];
    for(const r of this.records){if(r.kind==='game'&&!games.some(g=>this.matches(r,g)))continue;if(r.kind==='app'&&r.pid!==this.ownPid)continue;
      try{if(this.system.getPriority(r.pid)===r.applied)this.system.setPriority(r.pid,r.original);}catch(e){if(e.code!=='ESRCH')remaining.push(r);}}
    this.records=remaining;await this.save();if(remaining.length)throw Error('Restore failed');
  }
  async apply(game){
    if(this.blocked||this.platform!=='win32')return this.snapshot();
    const games=await this.getGames();const verified=games.find(g=>this.identity(g)===this.identity(game));if(!verified)return this.publish('Запустите поддерживаемую игру.');
    const targets=[];const p=this.system.constants.priority;
    if(this.settings.raiseGame){if(!verified.startedAt){this.key=this.identity(verified);return this.publish('Время запуска игры недоступно: её приоритет не изменён для защиты от повторного использования PID.');}targets.push({kind:'game',pid:verified.pid,name:verified.name,startedAt:verified.startedAt,desired:p.PRIORITY_ABOVE_NORMAL});}
    if(this.settings.lowerApp)targets.push({kind:'app',pid:this.ownPid,desired:p.PRIORITY_BELOW_NORMAL});
    for(const t of targets){if(this.records.some(r=>r.kind===t.kind&&r.pid===t.pid))continue;const original=this.system.getPriority(t.pid);
      if((t.kind==='game'&&original<=t.desired)||(t.kind==='app'&&original>=t.desired))continue;
      const r={kind:t.kind,pid:t.pid,name:t.name||null,startedAt:t.startedAt||null,original,applied:t.desired};this.records.push(r);
      try{await this.save();}catch(e){this.records.pop();throw e;}
      try{this.system.setPriority(t.pid,t.desired);}catch(e){this.records.pop();await this.save();throw e;}}
    this.key=this.identity(verified);return this.publish(this.records.length?'Применён профиль выбранных приоритетов.':'Изменения не нужны: приоритеты уже подходят или действия выключены.');
  }
  configure(options){return this.enqueue(async()=>{if(this.blocked)return this.snapshot();if(!options||Object.keys(options).some(k=>!['automatic','raiseGame','lowerApp'].includes(k)||typeof options[k]!=='boolean'))throw Error('Invalid options');const old={...this.settings};await this.restore();this.manual=false;this.settings={...this.settings,...options};try{await this.save();}catch(e){this.settings=old;throw e;}return this.publish(this.settings.automatic?'Автоматический профиль включён.':'Автоматический профиль выключен; приоритеты восстановлены.');});}
  optimize(){return this.enqueue(async()=>{if(this.blocked||this.platform!=='win32')return this.snapshot();try{const games=await this.getGames();if(!games.length)return this.publish('Запустите поддерживаемую игру.');this.manual=true;return await this.apply(games[0]);}catch(e){return this.publish('Не удалось применить профиль. Проверьте права; частичные изменения можно отменить кнопкой «Восстановить».');}});}
  update(game){
    if(this.blocked||this.platform!=='win32'||(!this.settings.automatic&&!this.manual&&!this.records.length))return Promise.resolve(this.snapshot());
    const key=this.identity(game);if(key&&key===this.key)return Promise.resolve(this.snapshot());if(!game&&!this.records.length&&!this.key){this.manual=false;return Promise.resolve(this.snapshot());}
    return this.enqueue(async()=>{try{if(!game||(this.key&&this.key!==key)){await this.restore();if(!game)this.manual=false;}if(game&&(this.settings.automatic||this.manual))return await this.apply(game);return this.publish('Приоритеты восстановлены.');}catch(e){return this.publish('Ошибка применения/восстановления приоритетов. Проверьте права доступа.');}});
  }
  revert(){return this.enqueue(async()=>{if(this.blocked)return this.snapshot();this.settings.automatic=false;this.manual=false;await this.restore();return this.publish('Приоритеты восстановлены, автоматический режим выключен.');});}
  close(){return this.enqueue(async()=>{if(this.blocked)return;try{await this.restore();}catch(e){this.publish('Восстановление не завершено; журнал сохранён для следующего запуска.');}});}
}
module.exports={PriorityOptimizer};
