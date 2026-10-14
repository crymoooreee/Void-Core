(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.VoidCoreSteamLibrary = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function validID(id) { return Number.isInteger(id) && id > 0 && id <= 4294967295; }
  function covers(id) {
    if (!validID(id)) return [];
    const base = 'https://' + 'cdn.akamai.steamstatic.com/steam/apps/' + id + '/';
    return [base + 'library_600x900.jpg', base + 'header.jpg'];
  }
  function merge(local, remote) {
    const games = new Map();
    for (const game of Array.isArray(remote) ? remote : []) {
      if (!validID(game?.appid)) continue;
      games.set(game.appid, { appid: game.appid, name: String(game.name || `Steam ${game.appid}`).slice(0, 200), installed: false, owned: true, playtimeMinutes: Math.max(0, Number(game.playtimeMinutes) || 0) });
    }
    for (const game of Array.isArray(local) ? local : []) {
      if (!validID(game?.appid)) continue;
      const previous = games.get(game.appid);
      games.set(game.appid, { appid: game.appid, name: previous?.name || String(game.name || `Steam ${game.appid}`).slice(0, 200), installed: true, owned: Boolean(previous?.owned), playtimeMinutes: previous?.playtimeMinutes || 0 });
    }
    return [...games.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function page(games, { query = '', filter = 'all', index = 1, size = 48 } = {}) {
    const search = String(query).trim().toLocaleLowerCase();
    const found = games.filter(game => (!search || game.name.toLocaleLowerCase().includes(search) || String(game.appid).includes(search)) && (filter !== 'installed' || game.installed) && (filter !== 'owned' || game.owned));
    size = Math.max(1, Math.min(100, Number(size) || 48));
    const pages = Math.max(1, Math.ceil(found.length / size));
    index = Math.max(1, Math.min(pages, Math.floor(Number(index) || 1)));
    return { items: found.slice((index - 1) * size, index * size), total: found.length, pages, index };
  }
  return { validID, covers, merge, page };
});
