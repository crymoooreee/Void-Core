(() => {
  const api = window.voidCore.sessions;
  const page = document.getElementById('sessionsPage');
  const list = document.getElementById('sessionsList');
  const message = document.getElementById('sessionsMessage');
  const details = document.getElementById('sessionDetails');
  const previous = document.getElementById('previousSessionsBtn');
  const next = document.getElementById('nextSessionsBtn');
  let offset = 0;
  const limit = 20;
  let pending = false;
  let detailRequest = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
  const date = value => Number.isFinite(value) ? new Date(value).toLocaleString('ru-RU') : '—';
  function duration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 3600)}ч ${Math.floor(seconds % 3600 / 60)}м ${seconds % 60}с`;
  }
  const status = value => ({active:'В процессе',completed:'Завершена',interrupted:'Прервана'}[value] || value);
  async function refresh() {
    if (pending || document.hidden || !page.classList.contains('active')) return;
    pending = true;
    try {
      const result = await api.list({offset,limit});
      message.textContent = result.error || (result.total ? `Сессий: ${result.total}. Статистика по периодическим замерам, не по всем кадрам.` : 'Пока нет сессий. Запустите поддерживаемую игру вместе с VoidCore.');
      list.innerHTML = result.items.map(item => `
        <article class="session-card">
          <div class="session-card-header"><div><h2>${escape(item.game.name)}</h2><p>${escape(date(item.startedAt))} · ${escape(status(item.status))} · ${escape(duration(item.durationMs))}</p></div>
          <button class="primary-btn" type="button" data-session-id="${escape(item.id)}">Подробнее</button></div>
          <div class="session-stats"><span>Средний FPS по замерам <strong>${number(item.averageSampledFps)}</strong></span><span>Frame Time по замерам <strong>${number(item.averageSampledFrameTime)} мс</strong></span><span>Просадки <strong>${item.drops}</strong></span><span>Отфильтровано <strong>${item.suppressed}</strong></span></div>
        </article>`).join('');
      previous.disabled = offset === 0;
      next.disabled = offset + limit >= result.total;
      document.getElementById('sessionsPageNumber').textContent = result.total ? `${Math.floor(offset/limit)+1} / ${Math.ceil(result.total/limit)}` : '0 / 0';
    } catch (error) { message.textContent = 'Не удалось загрузить историю сессий.'; }
    finally { pending = false; }
  }
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-session-id]');
    if (!button) return;
    const request = ++detailRequest;
    try {
      const data = await api.get(button.dataset.sessionId);
      if (request !== detailRequest) return;
      const cpu = data.computer?.cpu?.brand || '—';
      const gpus = (data.computer?.gpus || []).map(gpu => gpu.name).filter(Boolean).join(', ') || '—';
      const events = [...data.events].sort((a,b)=>b.timestamp-a.timestamp);
      details.innerHTML = `<h2>${escape(data.game.name)}</h2>
        <p>${escape(date(data.startedAt))} — ${data.endedAt ? escape(date(data.endedAt)) : 'сессия продолжается'} · ${escape(status(data.status))}</p>
        <p>Версия: ${escape(data.appVersion)} · CPU: ${escape(cpu)} · GPU: ${escape(gpus)} · RAM: ${number(data.computer?.memory?.totalGB)} ГБ</p>
        <p>Замеров для статистики: ${data.stats.validSamples}. Сохранено снимков: ${data.samples.length}. Диапазон FPS по замерам: ${number(data.summary.minSampledFps)}–${number(data.summary.maxSampledFps)}.</p>
        <p>Завершение: ${escape(({ 'game-closed':'игра закрыта', 'game-switched':'смена игры', 'app-closed':'VoidCore закрыт', 'unexpected-exit':'нештатный выход — конец по последнему сохранённому замеру' })[data.endReason] || '—')}</p>
        <h3>События сессии</h3>${events.length ? events.map(item=>`<div class="session-event"><strong>${escape(date(item.timestamp))} · ${escape(item.title || item.reason)}</strong><p>${escape(item.beforeFps)} → ${escape(item.fps)} FPS · ${item.type==='suppressed'?'Отфильтровано':'Вероятная причина'}</p>${item.explanation?`<p>${escape(item.explanation)}</p>`:''}${item.recommendations?.length?`<ul>${item.recommendations.map(text=>`<li>${escape(text)}</li>`).join('')}</ul>`:''}</div>`).join('') : '<p>Нет событий.</p>'}`;
      details.classList.remove('hidden');
    } catch (error) { message.textContent = 'Не удалось прочитать выбранную сессию.'; }
  });
  document.getElementById('refreshSessionsBtn').addEventListener('click', refresh);
  previous.addEventListener('click',()=>{offset=Math.max(0,offset-limit);refresh();});
  next.addEventListener('click',()=>{offset+=limit;refresh();});
  document.querySelector('.nav-item[data-page="sessions"]').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  // Only the visible history page requests summaries; nothing is polled while gaming.
  setInterval(()=>{if(document.hasFocus())refresh();},10000);
})();
