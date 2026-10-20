import { buildIndex, search, exactMatch, isSmallTalk } from './retrieval.mjs';
import { buildSystemPrompt, OUT_OF_SCOPE } from './prompt.mjs';
import { streamChat, isReasoningModel, defaultReasoningEffort } from './openai.mjs';
import { json, send, readBody, parseOrigins, originOk, clientIp, rateOk } from './http.mjs';

const DEFAULTS = {
  model: 'gpt-6-luna',
  maxMessageChars: 500,
  maxTurns: 8,
  maxTokens: 400,
  reasoningMaxTokens: 1600,
  temperature: 0.2,
  contextEntries: 10,
  fallbackMinScore: 2.5,
  fallbackMinCoverage: 0.5,
  maxOptions: 4,
  rateLimit: { windowMs: 10 * 60 * 1000, max: 30 },
  timeoutMs: 25000,
};

/**
 * Create a Node-style (req, res) handler that answers chat messages from one knowledge base.
 *
 * GET  -> widget config (title, greeting, starter options, contact links)
 * POST -> { messages: [{ role: 'user'|'assistant', content }] }  streams NDJSON events:
 *         {"t":"delta","v":"text"}  ...  {"t":"done","source":"ai|kb|refusal","options":[...],"suggestions":[...]}
 *         options: [{ type: 'ask', label }] (tap to ask) or [{ type: 'action', label, href, icon, primary }]
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
  const model = () => options.model ?? env.OPENAI_MODEL ?? options.defaultModel ?? DEFAULTS.model;
  const effortFor = m => options.reasoningEffort ?? env.OPENAI_REASONING_EFFORT ?? defaultReasoningEffort(m);
  const baseUrl = options.baseUrl ?? env.OPENAI_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const allowed = parseOrigins(options.allowedOrigins ?? env.KB_CHAT_ALLOWED_ORIGINS);
  const index = buildIndex(kb);
  const hits = new Map();
  const log = options.log ?? console;

  const refusal = kb.refusal || 'Sorry, I can only help with questions about this business.';
  const starters = (kb.starters || kb.qa.slice(0, 4).map(e => e.q)).slice(0, 6);
  const actions = kb.actions || {};
  const defaultOptions = kb.defaultOptions || (actions.call ? ['call'] : []);

  /** Turn option keys/questions into option objects: action keys -> buttons, anything else -> a question to ask. */
  function toOptions(list, exclude = '') {
    const out = [], seen = new Set([String(exclude).toLowerCase()]);
    for (const item of list || []) {
      if (out.length >= cfg.maxOptions) break;
      const key = typeof item === 'string' ? item : item?.label;
      if (!key || seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      const a = typeof item === 'string' ? actions[item] : item.href ? item : null;
      if (a?.href) out.push({ type: 'action', label: a.label, href: a.href, icon: a.icon || 'link', primary: !!a.primary });
      else out.push({ type: 'ask', label: key });
    }
    return out;
  }
  /** Options after an answer: the entry's own options, else related questions plus the default actions. */
  function optionsFor(entry, related, asked) {
    if (entry?.options?.length) return toOptions(entry.options, asked);
    const follow = related.map(r => r.entry.q).filter(q => q !== entry?.q);
    return toOptions([...follow.slice(0, cfg.maxOptions - defaultOptions.length), ...defaultOptions], asked);
  }
  const startOptions = () => toOptions(kb.startOptions || starters);
  const refusalOptions = () => toOptions([...starters.slice(0, Math.max(1, cfg.maxOptions - defaultOptions.length)), ...defaultOptions]);

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
          startOptions: startOptions(),
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

      // 1) A starter question or an exact knowledge-base question: answer directly, no model call.
      const exact = exactMatch(index, question);
      if (exact) return finish(res, exact.a, 'kb', optionsFor(exact, related, question));

      // 2) No key configured: best knowledge-base match, or the refusal.
      if (!apiKey()) return finish(res, ...fallback(question, related));

      // 3) Ask the model, constrained to the retrieved knowledge.
      const entries = pickContext(related, kb, cfg.contextEntries);
      const messages = [
        { role: 'system', content: buildSystemPrompt(kb, entries) },
        ...history.slice(-cfg.maxTurns * 2),
      ];
      const m = model();
      const effort = isReasoningModel(m) ? effortFor(m) : null;
      const maxTokens = effort && effort !== 'none' ? Math.max(cfg.maxTokens, cfg.reasoningMaxTokens) : cfg.maxTokens;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      let held = '';
      let streaming = false;
      let text = '';
      try {
        for await (const delta of streamChat({ apiKey: apiKey(), baseUrl, model: m, messages, maxTokens,
          temperature: cfg.temperature, reasoningEffort: effort, fetchImpl, signal: ctrl.signal })) {
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
        log.warn?.('kb-chat: model call failed', err.status || '', err.message, err.detail || '');
        if (!streaming) return finish(res, ...fallback(question, related, true));
        write(res, { t: 'delta', v: '\n\n' + (kb.errorText || 'Sorry, I lost my connection.') });
      } finally {
        clearTimeout(timer);
      }

      if (!streaming || text.includes(OUT_OF_SCOPE)) {
        if (streaming) write(res, { t: 'replace', v: refusal });
        else write(res, { t: 'delta', v: refusal });
        return done(res, 'refusal', refusalOptions());
      }
      const ref = search(index, `${question} ${text}`, 4);
      return done(res, 'ai', optionsFor(ref[0]?.entry, ref.length ? ref : related, question));
    } catch (err) {
      log.error?.('kb-chat: handler error', err.message);
      if (!res.headersSent) return json(res, 500, { error: 'server_error' });
      write(res, { t: 'error', message: kb.errorText || 'Something went wrong.' });
      res.end();
    }
  };

  function fallback(question, related, upstreamFailed = false) {
    if (isSmallTalk(question)) {
      const thanks = /^(thanks|thank you|thx)/i.test(question.trim());
      return [thanks ? (kb.thanksText || 'You’re welcome! Anything else I can help with?') : (kb.greeting || 'Hi! How can I help?'), 'kb', startOptions()];
    }
    const best = related[0];
    if (best && best.score >= cfg.fallbackMinScore && best.coverage >= cfg.fallbackMinCoverage) {
      return [best.entry.a, 'kb', optionsFor(best.entry, related.slice(1), question)];
    }
    if (upstreamFailed && kb.errorText) return [kb.errorText, 'kb', toOptions(defaultOptions.length ? [...defaultOptions, ...(actions.book ? ['book'] : [])] : starters)];
    return [refusal, 'refusal', refusalOptions()];
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

function finish(res, text, source, options) {
  write(res, { t: 'delta', v: text });
  return done(res, source, options);
}
function done(res, source, options = []) {
  const suggestions = options.filter(o => o.type === 'ask').map(o => o.label);
  write(res, { t: 'done', source, options, suggestions });
  res.end();
}
function write(res, event) { res.write(JSON.stringify(event) + '\n'); }
