(() => {
  'use strict';
  const dictionary = window.VoidCoreTranslations || {}, key = 'voidcore.language';
  let language = navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  let storageFailed = false;
  try { const saved = localStorage.getItem(key); if (saved === 'ru' || saved === 'en') language = saved; } catch {}
  const patterns = Object.keys(dictionary).filter(s => /\{\w+\}/.test(s)).map(source => {
    const names = []; let pattern = '', position = 0;
    for (const match of source.matchAll(/\{(\w+)\}/g)) {
      pattern += source.slice(position, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.+?)';
      names.push(match[1]); position = match.index + match[0].length;
    }
    pattern += source.slice(position).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { source, names, regex: new RegExp('^' + pattern + '$') };
  });
  function t(source, parameters = {}) {
    const value = Object.hasOwn(dictionary, source) ? dictionary[source][language] : String(source ?? '');
    return value.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(parameters, name) ? String(parameters[name]) : match);
  }
  function message(source) {
    if (typeof source !== 'string') return String(source ?? '');
    if (Object.hasOwn(dictionary, source)) return t(source);
    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (match) return t(pattern.source, Object.fromEntries(pattern.names.map((name, i) => [name, match[i+1]])));
    }
    // Optimizer status combines independently localized sentences. Unknown messages remain intact.
    return source.split(/(?<=\.)\s+/).map(part => Object.hasOwn(dictionary, part) ? t(part) : part).join(' ');
  }
  function apply() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    for (const attribute of ['aria-label','title','placeholder','alt']) {
      document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(node => { node.setAttribute(attribute,t(node.getAttribute(`data-i18n-${attribute}`))); });
    }
    const select = document.getElementById('languageSelect'); if (select) select.value = language;
    const notice = document.getElementById('languageSaveMessage'); if (notice) notice.textContent = storageFailed ? t('Не удалось сохранить язык. Он изменён только для текущего запуска.') : '';
  }
  function setLanguage(value) {
    if (value !== 'ru' && value !== 'en') return false;
    language = value; storageFailed = false;
    try { localStorage.setItem(key,value); } catch { storageFailed = true; }
    apply(); window.dispatchEvent(new CustomEvent('voidcore:language-changed',{detail:{language}}));
    return true;
  }
  window.VoidCoreI18n = Object.freeze({t,message,setLanguage,getLanguage:()=>language,locale:()=>language === 'ru' ? 'ru-RU' : 'en-US'});
  window.vcT = t; window.vcMsg = message;
  apply(); document.getElementById('languageSelect')?.addEventListener('change',event=>setLanguage(event.target.value));
})();
