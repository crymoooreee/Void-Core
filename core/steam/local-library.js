const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
function parseVDF(text) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('VDF too large');
  const tokens = []; let i = 0;
  while (i < text.length) {
    if (/\s|\uFEFF/.test(text[i])) { i++; continue; }
    if (text.slice(i, i + 2) === '//') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text[i] === '{' || text[i] === '}') { tokens.push(text[i++]); continue; }
    if (text[i] !== '"') throw Error('Invalid VDF');
    i++; let value = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\' && ['\\', '"'].includes(text[i + 1])) { value += text[i + 1]; i += 2; }
      else value += text[i++];
    }
    if (text[i++] !== '"') throw Error('Unterminated VDF'); tokens.push({ value });
  }
  let position = 0;
  function object(depth = 0) {
    if (depth > 16) throw Error('VDF nesting');
    const result = Object.create(null);
    while (position < tokens.length && tokens[position] !== '}') {
      const key = tokens[position++]; if (!key || typeof key.value !== 'string') throw Error('Invalid VDF key');
      const value = tokens[position++];
      if (value === '{') { result[key.value] = object(depth + 1); if (tokens[position++] !== '}') throw Error('Missing VDF brace'); }
      else if (value && typeof value.value === 'string') result[key.value] = value.value;
      else throw Error('Invalid VDF value');
    }
    return result;
  }
  const result = object(); if (position !== tokens.length) throw Error('Unexpected VDF brace'); return result;
}
async function readVDF(file) {
  const info = await fs.stat(file); if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error('Invalid VDF file');
  return parseVDF(await fs.readFile(file, 'utf8'));
}
async function windowsRoot() {
  if (process.platform !== 'win32') return null;
  const stdout = await new Promise(resolve => execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 4000 }, (error, output) => resolve(error ? '' : output)));
  const match = String(stdout).match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i);
  return match ? path.resolve(match[1].trim()) : null;
}
class LocalSteamLibrary {
  constructor({ roots = null, platform = process.platform, openExternal = async () => {} } = {}) { Object.assign(this, { roots, platform, openExternal }); }
  async scan() {
    let roots = this.roots;
    if (!roots) {
      if (this.platform !== 'win32') return { games: [], message: 'Автопоиск Steam пока поддерживается на Windows.' };
      const root = await windowsRoot();
      roots = [root, process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam')].filter(Boolean);
    }
    const libraries = new Set(); let foundSteam = false;
    for (const root of roots) {
      try { if (!(await fs.stat(path.join(root, 'steamapps'))).isDirectory()) continue; foundSteam = true; libraries.add(root);
        const config = (await readVDF(path.join(root, 'steamapps', 'libraryfolders.vdf'))).libraryfolders;
        for (const value of Object.values(config || {}).slice(0, 32)) {
          const folder = typeof value === 'string' ? value : value?.path;
          if (typeof folder === 'string' && path.isAbsolute(folder) && folder.length < 2048) libraries.add(path.resolve(folder));
        }
      } catch {}
    }
    const games = new Map();
    for (const folder of [...libraries].slice(0, 32)) {
      const directory = path.join(folder, 'steamapps'); let files;
      try { files = await fs.readdir(directory); } catch { continue; }
      for (const file of files.filter(f => /^appmanifest_\d+\.acf$/.test(f)).slice(0, 5000)) {
        try {
          const data = (await readVDF(path.join(directory, file))).AppState;
          const id = Number(data?.appid);
          if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295 || file !== `appmanifest_${id}.acf` || !(Number(data.StateFlags) & 4) || typeof data.installdir !== 'string' || !data.installdir || data.installdir === '.' || /[\\/]/.test(data.installdir) || data.installdir === '..') continue;
          if (!(await fs.stat(path.join(directory, 'common', data.installdir))).isDirectory()) continue;
          games.set(id, { appid: id, name: String(data.name || `Steam ${id}`).slice(0, 200), installed: true });
        } catch {}
      }
    }
    return { games: [...games.values()].sort((a, b) => a.name.localeCompare(b.name)), message: foundSteam ? 'Локальные Steam-манифесты прочитаны. Совместимость FPS-мониторинга зависит от распознавания игры.' : 'Steam не найден. Установите Steam или проверьте путь установки.' };
  }
  async launch(appid) {
    if (!Number.isInteger(appid) || appid < 1 || appid > 4294967295) throw Error('Invalid AppID');
    if (!(await this.scan()).games.some(g => g.appid === appid)) throw Error('Игра не найдена среди установленных.');
    await this.openExternal(`steam://rungameid/${appid}`); return { ok: true };
  }
}
module.exports = { parseVDF, LocalSteamLibrary };
