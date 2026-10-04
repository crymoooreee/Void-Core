(() => {
 const api=window.voidCore.optimizer;
 const automatic=document.getElementById('optimizerAutomatic'),raise=document.getElementById('optimizerRaiseGame'),lower=document.getElementById('optimizerLowerApp'),message=document.getElementById('optimizerMessage'),result=document.getElementById('optimizeResult');
 const power=document.getElementById('optimizerHighPerformance'),dvr=document.getElementById('optimizerDisableDvr');
 const buttons=['optimizeBtn','applyOptimizerBtn','revertOptimizerBtn'].map(id=>document.getElementById(id));
 if(!api||!automatic)return;let busy=false,current=null;
 function render(state){current=state;automatic.checked=state.settings.automatic;raise.checked=state.settings.raiseGame;lower.checked=state.settings.lowerApp;power.checked=Boolean(state.settings.highPerformance);dvr.checked=Boolean(state.settings.disableDvr);[automatic,raise,lower,power,dvr,...buttons].forEach(e=>e.disabled=busy||!state.supported);message.textContent=state.supported?state.message:'Оптимизация недоступна: требуется Windows и исправный журнал восстановления.';if(state.active){result.textContent=state.message;result.classList.remove('hidden');}}
 const options=()=>({automatic:automatic.checked,raiseGame:raise.checked,lowerApp:lower.checked,highPerformance:power.checked,disableDvr:dvr.checked});
 async function action(fn){if(busy)return;const selected=options();busy=true;if(current)render(current);try{const state=await fn(selected);render(state);result.textContent=state.message;result.classList.remove('hidden');}catch(e){message.textContent='Не удалось изменить профиль. Проверьте права доступа и возможность записи настроек.';}finally{busy=false;if(current)render(current);}}
 automatic.addEventListener('change',()=>{if(automatic.checked&&!confirm('Включить автоматический профиль? Все выбранные действия (приоритеты, план питания, Game DVR) будут применяться при обнаружении игры с последующим откатом. Возможны нагрев и отключение записи. Прирост FPS не гарантирован.')){automatic.checked=false;return;}action(selected=>api.configure(selected));});
 for(const toggle of [raise,lower,power,dvr])toggle.addEventListener('change',()=>{
  if((toggle===power||toggle===dvr)&&toggle.checked&&!confirm(toggle===power?'Разрешить план High Performance при питании от сети? Возможно увеличение нагрева и расхода энергии. Исходный план будет сохранён для отката.':'Разрешить отключение двух параметров Xbox Game DVR на время профиля? Запись и клипы могут стать недоступны; эффект может потребовать перезапуска игры. Исходные значения будут сохранены.')){toggle.checked=false;return;}
  action(selected=>api.configure(selected));
 });
 async function apply(){if(!confirm('Применить выбранный профиль? Он может изменить приоритеты, план питания и настройки записи Game DVR. Возможны нагрев и недоступность клипов. Исходные значения сохраняются для отката. Прирост FPS не гарантирован.'))return;await action(async selected=>{await api.configure(selected);return window.voidCore.core.optimize();});}
 buttons[0].addEventListener('click',apply);buttons[1].addEventListener('click',apply);buttons[2].addEventListener('click',()=>action(()=>api.revert()));
 let received=false;const unsubscribe=api.onState(state=>{received=true;render(state);});api.getState().then(state=>{if(!received)render(state);}).catch(()=>{message.textContent='Настройки недоступны.';});window.addEventListener('unload',unsubscribe,{once:true});
})();
