// Small HTTP helpers shared by the chat and voice handlers (Node req/res, Vercel functions).

export function json(res, status, data, headers = {}) {
  return send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}
export function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => { data += c; if (data.length > 64 * 1024) reject(new Error('body_too_large')); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}

export function parseOrigins(value) {
  if (!value) return null;
  const list = (Array.isArray(value) ? value : String(value).split(',')).map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.length ? new Set(list) : null;
}

export function originOk(req, allowed) {
  const origin = header(req, 'origin');
  if (!origin) return true; // same-origin GETs and non-browser clients; rate limiting still applies
  if (allowed) return allowed.has(origin.replace(/\/$/, ''));
  try { return new URL(origin).host === header(req, 'x-forwarded-host') || new URL(origin).host === header(req, 'host'); }
  catch { return false; }
}

export function header(req, name) {
  const h = req.headers || {};
  const v = typeof h.get === 'function' ? h.get(name) : h[name];
  return Array.isArray(v) ? v[0] : v || '';
}

export function clientIp(req) {
  return (header(req, 'x-forwarded-for').split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
}

export function rateOk(ip, hits, { windowMs, max }) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
