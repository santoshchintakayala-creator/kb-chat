import { buildIndex, search, exactMatch, isSmallTalk } from './retrieval.mjs';
import { buildSystemPrompt, OUT_OF_SCOPE } from './prompt.mjs';
import { streamChat } from './openai.mjs';

const DEFAULTS = {
  model: 'gpt-4.1-mini',
  maxMessageChars: 500,
  maxTurns: 8,
  maxTokens: 350,
  temperature: 0.2,
  contextEntries: 10,
  fallbackMinScore: 2.5,
  rateLimit: { windowMs: 10 * 60 * 1000, max: 30 },
  timeoutMs: 25000,
};

/**
 * Create a Node-style (req, res) handler that answers chat messages from one knowledge base.
 *
 * GET  -> widget config (title, greeting, starter questions, contact links)
 * POST -> { messages: [{ role: 'user'|'assistant', content }] }  streams NDJSON events:
 *         {"t":"delta","v":"text"}  ...  {"t":"done","source":"ai|kb|refusal","suggestions":[...]}
 *
 * The OpenAI key is read from options.apiKey or process.env.OPENAI_API_KEY on the server only.
 * Without a key the handler still answers from the knowledge base (source "kb").
 */
export function createChatHandler(options = {}) {
  const kb = options.kb;
  if (!kb || !Array.isArray(kb.qa)) throw new Error('createChatHandler: options.kb with a qa array is required');
  const env = options.env || process.env;
  const cfg = { ...DEFAULTS, ...options, rateLimit: { ...DEFAULTS.rateLimit, ...(options.rateLimit || {}) } };
  const apiKey = () => options.apiKey ?? env.OPENAI_API_KEY ?? '';
  const model = () => options.model ?? env.OPENAI_MODEL ?? DEFAULTS.model;
  const baseUrl = options.baseUrl ?? env.OPENAI_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const allowed = parseOrigins(options.allowedOrigins ?? env.KB_CHAT_ALLOWED_ORIGINS);
  const index = buildIndex(kb);
  const hits = new Map();
  const log = options.log ?? console;

  const refusal = kb.refusal || 'Sorry, I can only help with questions about this business.';
  const starters = (kb.starters || kb.qa.slice(0, 4).map(e => e.q)).slice(0, 6);

  return async function handler(req, res) {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!originOk(req, allowed)) return json(res, 403, { error: 'origin_not_allowed' });

      if (req.method === 'GET') {
        return json(res, 200, {
          title: kb.widget?.title || kb.business?.shortName || kb.business?.name || 'Chat',
          subtitle: kb.widget?.subtitle || 'AI assistant',
          greeting: kb.greeting || `Hi! How can I help?`,
          placeholder: kb.widget?.placeholder || 'Type your question…',
          footnote: kb.widget?.footnote || '',
          starters,
          phone: kb.business?.phone || '',
          phoneHref: kb.business?.phoneHref || '',
          bookingUrl: kb.business?.bookingUrl || '',
          mode: apiKey() ? 'ai' : 'kb',
        }, { 'Cache-Control': 'no-store' });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });

      if (!rateOk(clientIp(req), hits, cfg.rateLimit)) {
        return json(res, 429, { error: 'rate_limited', message: `You’re sending messages quickly. Please wait a moment${kb.business?.phone ? `, or call ${kb.business.phone}` : ''}.` });
      }

      const body = await readBody(req);
      const history = cleanHistory(body?.messages, cfg);
      if (!history) return json(res, 400, { error: 'bad_request' });
      const question = history[history.length - 1].content;
      if (question.length > cfg.maxMessageChars) return json(res, 400, { error: 'message_too_long', max: cfg.maxMessageChars });

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });

      const related = search(index, question, cfg.contextEntries);
      const suggest = exclude => related.map(r => r.entry.q).filter(q => q !== exclude).slice(0, 3);

      // 1) A starter question or an exact knowledge-base question: answer directly, no model call.
      const exact = exactMatch(index, question);
      if (exact) return finish(res, exact.a, 'kb', suggest(exact.q));

      // 2) No key configured: best knowledge-base match, or the refusal.
      if (!apiKey()) return finish(res, ...fallback(question, related));

      // 3) Ask the model, constrained to the retrieved knowledge.
      const entries = pickContext(related, kb, cfg.contextEntries);
      const messages = [
        { role: 'system', content: buildSystemPrompt(kb, entries) },
        ...history.slice(-cfg.maxTurns * 2),
      ];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      let held = '';
      let streaming = false;
      let text = '';
      try {
        for await (const delta of streamChat({ apiKey: apiKey(), baseUrl, model: model(), messages, maxTokens: cfg.maxTokens,
          temperature: cfg.temperature, fetchImpl, signal: ctrl.signal })) {
          if (!streaming) {
            held += delta;
            if (held.trimStart().startsWith(OUT_OF_SCOPE) || OUT_OF_SCOPE.startsWith(held.trimStart())) {
              if (held.trimStart().length >= OUT_OF_SCOPE.length) break; // refusal confirmed
              continue; // could still be the token
            }
            streaming = true;
            text = held;
            write(res, { t: 'delta', v: held });
          } else {
            text += delta;
            write(res, { t: 'delta', v: delta });
          }
        }
      } catch (err) {
        log.warn?.('kb-chat: model call failed', err.status || '', err.message);
        if (!streaming) return finish(res, ...fallback(question, related, true));
        write(res, { t: 'delta', v: '\n\n' + (kb.errorText || 'Sorry, I lost my connection.') });
      } finally {
        clearTimeout(timer);
      }

      if (!streaming || text.includes(OUT_OF_SCOPE)) {
        if (streaming) write(res, { t: 'replace', v: refusal });
        else write(res, { t: 'delta', v: refusal });
        return done(res, 'refusal', starters.slice(0, 3));
      }
      return done(res, 'ai', suggest(null));
    } catch (err) {
      log.error?.('kb-chat: handler error', err.message);
      if (!res.headersSent) return json(res, 500, { error: 'server_error' });
      write(res, { t: 'error', message: kb.errorText || 'Something went wrong.' });
      res.end();
    }
  };

  function fallback(question, related, upstreamFailed = false) {
    if (isSmallTalk(question)) {
      return [/^(thanks|thank you|thx)/i.test(question.trim()) ? (kb.thanksText || 'You’re welcome! Anything else I can help with?') : (kb.greeting || 'Hi! How can I help?'), 'kb', starters.slice(0, 3)];
    }
    const best = related[0];
    if (best && best.score >= cfg.fallbackMinScore) return [best.entry.a, 'kb', related.slice(1, 4).map(r => r.entry.q)];
    if (upstreamFailed && kb.errorText) return [kb.errorText, 'kb', starters.slice(0, 3)];
    return [refusal, 'refusal', starters.slice(0, 3)];
  }
}

function pickContext(related, kb, n) {
  const picked = related.map(r => r.entry);
  if (picked.length < n) for (const e of kb.qa) { if (picked.length >= n) break; if (!picked.includes(e)) picked.push(e); }
  return picked;
}

function cleanHistory(messages, cfg) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) return null;
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, m.role === 'user' ? cfg.maxMessageChars + 1 : 2000);
    if (content) out.push({ role: m.role, content });
  }
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

function finish(res, text, source, suggestions) {
  write(res, { t: 'delta', v: text });
  return done(res, source, suggestions);
}
function done(res, source, suggestions) {
  write(res, { t: 'done', source, suggestions: suggestions || [] });
  res.end();
}
function write(res, event) { res.write(JSON.stringify(event) + '\n'); }

function json(res, status, data, headers = {}) {
  return send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function readBody(req) {
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

function parseOrigins(value) {
  if (!value) return null;
  const list = (Array.isArray(value) ? value : String(value).split(',')).map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.length ? new Set(list) : null;
}

function originOk(req, allowed) {
  const origin = header(req, 'origin');
  if (!origin) return true; // same-origin GETs and non-browser clients; rate limiting still applies
  if (allowed) return allowed.has(origin.replace(/\/$/, ''));
  try { return new URL(origin).host === header(req, 'x-forwarded-host') || new URL(origin).host === header(req, 'host'); }
  catch { return false; }
}

function header(req, name) {
  const h = req.headers || {};
  const v = typeof h.get === 'function' ? h.get(name) : h[name];
  return Array.isArray(v) ? v[0] : v || '';
}

function clientIp(req) {
  return (header(req, 'x-forwarded-for').split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
}

function rateOk(ip, hits, { windowMs, max }) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
