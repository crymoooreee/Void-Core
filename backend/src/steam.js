const PROVIDER = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';
const SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
function loginURL(returnTo, origin) {
  const url = new URL(PROVIDER);
  const fields = { ns: NS, mode: 'checkid_setup', return_to: returnTo, realm: origin + '/', identity: SELECT, claimed_id: SELECT };
  for (const [key, value] of Object.entries(fields)) url.searchParams.set('openid.' + key, value);
  return url.href;
}
async function verifyAssertion(params, returnTo, now = Date.now(), request = fetch) {
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new Error('Duplicate assertion');
  const get = name => params.get('openid.' + name);
  const signed = new Set((get('signed') || '').split(','));
  for (const name of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']) if (!signed.has(name)) throw new Error('Unsigned assertion');
  const identity = get('claimed_id');
  if (get('ns') !== NS || get('mode') !== 'id_res' || get('op_endpoint') !== PROVIDER || get('return_to') !== returnTo || get('identity') !== identity || !/^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/.test(identity || '')) throw new Error('Invalid assertion');
  const nonce = get('response_nonce') || '';
  const time = Date.parse(nonce.slice(0, 20));
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ.+$/.test(nonce) || nonce.length > 200 || !Number.isFinite(time) || Math.abs(now - time) > 5 * 60 * 1000) throw new Error('Expired assertion');
  const body = new URLSearchParams();
  for (const [key, value] of params) if (key.startsWith('openid.')) body.set(key, value);
  body.set('openid.mode', 'check_authentication');
  const result = await request(PROVIDER, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error('Steam unavailable');
  const text = await result.text();
  if (text.length > 4096 || !/^is_valid:true\r?$/m.test(text)) throw new Error('Steam rejected assertion');
  return { steamId: identity.split('/').pop(), nonce };
}
async function steamAPI(method, steamId, key, request = fetch) {
  if (!key) throw Object.assign(new Error('Steam API is not configured'), { status: 503 });
  if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid SteamID');
  const route = method === 'profile' ? 'ISteamUser/GetPlayerSummaries/v2/' : 'IPlayerService/GetOwnedGames/v1/';
  const url = new URL('https://api.steampowered.com/' + route);
  url.searchParams.set('key', key);
  url.searchParams.set(method === 'profile' ? 'steamids' : 'steamid', steamId);
  if (method === 'library') { url.searchParams.set('include_appinfo', '1'); url.searchParams.set('include_played_free_games', '1'); }
  const result = await request(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw Object.assign(new Error('Steam unavailable'), { status: 503 });
  const data = await result.json();
  if (method === 'profile') {
    const user = data.response?.players?.find(p => p.steamid === steamId);
    const avatar = user?.avatarfull;
    let safeAvatar = null;
    try { const u = new URL(avatar); if (u.protocol === 'https:' && ['avatars.steamstatic.com', 'avatars.cloudflare.steamstatic.com', 'avatars.akamai.steamstatic.com'].includes(u.hostname)) safeAvatar = u.href; } catch {}
    return { name: typeof user?.personaname === 'string' ? user.personaname.slice(0, 128) : null, avatar: safeAvatar };
  }
  const games = data.response?.games;
  return { privateOrUnavailable: !Array.isArray(games), games: Array.isArray(games) ? games.slice(0, 10000).filter(g => Number.isSafeInteger(g.appid) && g.appid > 0).map(g => ({ appid: g.appid, name: String(g.name || 'Steam game').slice(0, 200), playtimeMinutes: Math.max(0, Number(g.playtime_forever) || 0) })) : [] };
}
module.exports = { PROVIDER, loginURL, verifyAssertion, steamAPI };
