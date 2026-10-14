const { openStore } = require('./store');
const { createApplication } = require('./app');
const path = require('node:path');
const fs = require('node:fs');
const production = process.env.NODE_ENV !== 'development';
const publicURL = process.env.PUBLIC_API_URL || 'https://api.crymoooreee.ru';
const url = new URL(publicURL);
if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (production && url.protocol !== 'https:') || (!production && !['https:', 'http:'].includes(url.protocol))) throw Error('PUBLIC_API_URL must be an HTTPS origin');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid PORT');
const file = path.resolve(process.env.DATABASE_PATH || './data/voidcore.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
process.umask(0o077);
const store = openStore(file);
let sendMail = null;
if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
  const nodemailer = require('nodemailer');
  const secure = process.env.SMTP_SECURE === 'true';
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure,
    requireTLS: !secure, tls: { rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
  });
  sendMail = async message => transport.sendMail({ from: process.env.SMTP_FROM, ...message });
}
const server = createApplication({ store, config: { publicURL: url.origin, steamKey: process.env.STEAM_API_KEY || '', trustProxy: process.env.TRUST_PROXY === 'true' }, sendMail });
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('VoidCore API listening; mail configured:', Boolean(sendMail)));
const cleanup = setInterval(() => store.cleanup(Date.now()), 60000); cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return; closing = true; clearInterval(cleanup);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
