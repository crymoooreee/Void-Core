const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot({saved=null,os='en-US',fail=false}={}){
 const nodes={languageSelect:{value:'',addEventListener(){}},languageSaveMessage:{textContent:''}},listeners=[];
 const context={navigator:{language:os},localStorage:{getItem:()=>saved,setItem:(_key,value)=>{if(fail)throw Error('blocked');saved=value;}},document:{documentElement:{},querySelectorAll:()=>[],getElementById:id=>nodes[id]||null},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
 context.window=context;context.dispatchEvent=event=>listeners.push(event);vm.createContext(context);
 for(const file of ['locales.js','i18n.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/js',file),'utf8'),context);
 return {context,nodes,getSaved:()=>saved,listeners};
}
test('stored supported language, OS fallback and validation',()=>{
 const a=boot({saved:'ru'});assert.equal(a.context.VoidCoreI18n.getLanguage(),'ru');assert.equal(a.context.vcT('Settings'),'Настройки');
 assert.equal(a.context.VoidCoreI18n.setLanguage('en'),true);assert.equal(a.getSaved(),'en');assert.equal(a.context.document.documentElement.lang,'en');assert.equal(a.listeners.length,1);
 assert.equal(a.context.VoidCoreI18n.setLanguage('de'),false);assert.equal(a.getSaved(),'en');assert.equal(boot({saved:'unsafe',os:'ru-RU'}).context.VoidCoreI18n.getLanguage(),'ru');
});
test('parameterized messages, unknown text fallback and unavailable persistence',()=>{
 const b=boot({fail:true});b.context.VoidCoreI18n.setLanguage('ru');assert.match(b.nodes.languageSaveMessage.textContent,/Не удалось сохранить/);
 b.context.VoidCoreI18n.setLanguage('en');assert.equal(b.context.vcMsg('Новая версия: 0.5.1'),'New version: 0.5.1');assert.equal(b.context.vcMsg('Использовано 95% RAM. Windows может обращаться к более медленному файлу подкачки.'),'95% RAM used. Windows may access the slower page file.');
 assert.equal(b.context.vcMsg('Unknown custom error'),'Unknown custom error');assert.equal(b.context.vcT('__proto__'),'__proto__');
});
