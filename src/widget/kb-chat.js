/*!
 * kb-chat widget: a dependency-free chat panel that talks to a kb-chat server endpoint.
 * Usage:
 *   <link rel="stylesheet" href="/chat/kb-chat.css">
 *   <script type="module" src="/chat/kb-chat.js" data-kb-chat data-endpoint="/api/chat"></script>
 * or: import { createChat } from './kb-chat.js'; createChat({ endpoint: '/api/chat' });
 * Any element with [data-chat-open] opens the panel.
 */

const ICONS = {
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M5 12h12M12 5l7 7-7 7"/>',
  phone: '<path d="m7 3 3 5-3 2c1 3 4 6 7 7l2-3 5 3-1 4C10 22 2 14 3 4Z"/>',
  restart: '<path d="M4 4v6h6"/><path d="M20 12a8 8 0 1 1-2.4-5.7L20 9M4 10a8 8 0 0 1 1-2"/>',
};
const svg = (name, cls = '') => `<svg class="kbc-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAFE_URL = /^(tel:\+?[\d-]{7,}|mailto:[^\s"'<>]+|\/[\w\-./#?=&%]*|https:\/\/[^\s"'<>]+)$/;

/** Render a small, safe subset of markdown: links, **bold**, lists, paragraphs, phone numbers. */
export function renderText(text) {
  const links = [];
  let s = esc(text).replace(/\[([^\]\n]{1,80})\]\(([^)\s]{1,300})\)/g, (m, label, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(u)) return label;
    const ext = u.startsWith('https://');
    links.push(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/(^|[^\d-])(\d{3}-\d{3}-\d{4})(?![\d-])/g, (m, pre, num) => {
    links.push(`<a href="tel:+1${num.replace(/-/g, '')}">${num}</a>`);
    return `${pre}\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*\n]{1,120})\*\*/g, '<strong>$1</strong>');
  const blocks = s.split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
      return '<ul>' + lines.map(l => `<li>${l.replace(/^\s*([-•*]|\d+\.)\s+/, '')}</li>`).join('') + '</ul>';
    }
    return `<p>${lines.join('<br>')}</p>`;
  });
  return blocks.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => links[+i]);
}

export function createChat(options = {}) {
  const opt = {
    endpoint: '/api/chat',
    title: '',
    subtitle: '',
    avatar: '',
    launcher: 'auto', // 'auto' | 'none'
    launcherLabel: 'Chat with us',
    launcherMinWidth: 0, // hide the floating launcher below this viewport width (e.g. when a site has its own button)
    openers: '[data-chat-open]',
    storageKey: 'kb-chat',
    accent: '',
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== '')),
  };
  if (typeof opt.launcherMinWidth === 'string') opt.launcherMinWidth = parseInt(opt.launcherMinWidth, 10) || 0;

  let config = { title: opt.title || 'Chat', subtitle: opt.subtitle || '', greeting: 'Hi! How can I help?', starters: [], placeholder: 'Type your question…', footnote: '', phone: '', phoneHref: '' };
  let messages = load();
  let busy = false;
  let lastOpener = null;
  let configLoaded = null;

  const root = document.createElement('div');
  root.className = 'kbc';
  if (opt.accent) root.style.setProperty('--kbc-accent', opt.accent);
  const uid = 'kbc-' + Math.random().toString(36).slice(2, 8);
  root.innerHTML = `
    <button type="button" class="kbc-launcher" aria-haspopup="dialog" aria-expanded="false" aria-controls="${uid}">${svg('chat')}<span class="kbc-launcher-label">${esc(opt.launcherLabel)}</span></button>
    <section class="kbc-panel" id="${uid}" role="dialog" aria-modal="false" aria-labelledby="${uid}-t" hidden>
      <header class="kbc-head">
        <span class="kbc-avatar" aria-hidden="true"></span>
        <div class="kbc-head-text"><h2 id="${uid}-t" class="kbc-title"></h2><p class="kbc-sub"><span class="kbc-dot" aria-hidden="true"></span><span class="kbc-sub-text"></span></p></div>
        <a class="kbc-icon-btn kbc-call" hidden>${svg('phone')}<span class="kbc-sr">Call</span></a>
        <button type="button" class="kbc-icon-btn kbc-restart" title="Start over">${svg('restart')}<span class="kbc-sr">Start over</span></button>
        <button type="button" class="kbc-icon-btn kbc-close" title="Close">${svg('close')}<span class="kbc-sr">Close chat</span></button>
      </header>
      <div class="kbc-log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
      <form class="kbc-form" novalidate>
        <label class="kbc-sr" for="${uid}-in">Your message</label>
        <textarea id="${uid}-in" class="kbc-input" rows="1" maxlength="500" enterkeyhint="send" autocomplete="off"></textarea>
        <button type="submit" class="kbc-send" disabled>${svg('send')}<span class="kbc-sr">Send</span></button>
      </form>
      <p class="kbc-foot"></p>
    </section>`;
  document.body.appendChild(root);

  const $ = sel => root.querySelector(sel);
  const launcher = $('.kbc-launcher'), panel = $('.kbc-panel'), log = $('.kbc-log');
  const form = $('.kbc-form'), input = $('.kbc-input'), sendBtn = $('.kbc-send');
  if (opt.launcher === 'none') launcher.hidden = true;

  // Hide the floating launcher on narrow screens when the site provides its own opener.
  if (opt.launcherMinWidth) {
    const mq = window.matchMedia(`(min-width: ${opt.launcherMinWidth}px)`);
    const sync = () => root.classList.toggle('kbc-no-launcher', !mq.matches);
    sync(); mq.addEventListener?.('change', sync);
  }

  applyConfig();
  launcher.addEventListener('click', () => toggle(true, launcher));
  $('.kbc-close').addEventListener('click', () => toggle(false));
  $('.kbc-restart').addEventListener('click', restart);
  document.addEventListener('click', e => {
    const el = e.target.closest?.(opt.openers);
    if (el && !root.contains(el)) { e.preventDefault(); toggle(true, el); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  input.addEventListener('input', () => { autosize(); sendBtn.disabled = busy || !input.value.trim(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  log.addEventListener('click', e => {
    const chip = e.target.closest('.kbc-chip');
    if (chip) ask(chip.dataset.q);
  });

  // Keep the panel above the on-screen keyboard on phones.
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv || panel.hidden) return;
    root.style.setProperty('--kbc-vh', `${vv.height}px`);
    root.style.setProperty('--kbc-vt', `${vv.offsetTop}px`);
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);

  function loadConfig() {
    if (configLoaded) return configLoaded;
    configLoaded = fetch(opt.endpoint, { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (c) { config = { ...config, ...c, title: opt.title || c.title, subtitle: opt.subtitle || c.subtitle }; applyConfig(); } })
      .catch(() => {});
    return configLoaded;
  }

  function applyConfig() {
    $('.kbc-title').textContent = config.title;
    $('.kbc-sub-text').textContent = config.subtitle;
    $('.kbc-foot').textContent = config.footnote || '';
    input.placeholder = config.placeholder;
    const av = $('.kbc-avatar');
    av.innerHTML = opt.avatar ? `<img src="${esc(opt.avatar)}" alt="">` : esc((config.title || 'C').trim()[0] || 'C');
    const call = $('.kbc-call');
    if (config.phoneHref) { call.href = config.phoneHref; call.hidden = false; call.title = `Call ${config.phone}`; }
    if (!panel.hidden) renderAll();
  }

  async function toggle(open, opener) {
    if (open === !panel.hidden) return;
    if (open) {
      lastOpener = opener || null;
      panel.hidden = false;
      root.classList.add('kbc-open');
      document.documentElement.classList.add('kbc-locked');
      launcher.setAttribute('aria-expanded', 'true');
      document.querySelectorAll(opt.openers).forEach(el => el.setAttribute('aria-expanded', 'true'));
      fit();
      renderAll();
      await loadConfig();
      if (!window.matchMedia('(pointer: coarse)').matches) input.focus();
    } else {
      panel.hidden = true;
      root.classList.remove('kbc-open');
      document.documentElement.classList.remove('kbc-locked');
      launcher.setAttribute('aria-expanded', 'false');
      document.querySelectorAll(opt.openers).forEach(el => el.setAttribute('aria-expanded', 'false'));
      (lastOpener || launcher).focus?.();
    }
  }

  function renderAll() {
    log.innerHTML = '';
    addBot(config.greeting);
    for (const m of messages) m.role === 'user' ? addUser(m.content) : addBot(m.content);
    const last = messages[messages.length - 1];
    addChips(last?.role === 'assistant' ? (last.suggestions || []) : config.starters);
    scroll(true);
  }

  function addUser(text) {
    const row = el('div', 'kbc-row kbc-user');
    row.innerHTML = `<div class="kbc-bubble">${esc(text)}</div>`;
    log.appendChild(row);
  }
  function addBot(text) {
    const row = el('div', 'kbc-row kbc-bot');
    row.innerHTML = `<div class="kbc-bubble">${renderText(text)}</div>`;
    log.appendChild(row);
    return row.firstElementChild;
  }
  function addChips(list) {
    log.querySelectorAll('.kbc-chips').forEach(c => c.remove());
    if (!list?.length) return;
    const wrap = el('div', 'kbc-chips');
    wrap.setAttribute('aria-label', 'Suggested questions');
    wrap.innerHTML = list.slice(0, 4).map(q => `<button type="button" class="kbc-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
    log.appendChild(wrap);
  }
  function thinking() {
    const row = el('div', 'kbc-row kbc-bot kbc-thinking');
    row.innerHTML = '<div class="kbc-bubble"><span class="kbc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="kbc-thinking-label">Thinking</span></div>';
    log.appendChild(row);
    return row;
  }

  async function ask(raw) {
    const text = String(raw || '').trim().slice(0, 500);
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    input.value = ''; autosize();
    log.querySelectorAll('.kbc-chips').forEach(c => c.remove());
    messages.push({ role: 'user', content: text });
    addUser(text);
    const wait = thinking();
    log.setAttribute('aria-busy', 'true');
    scroll(true);

    let answer = '', bubble = null, suggestions = [], frame = 0;
    const paint = () => { frame = 0; if (bubble) bubble.innerHTML = renderText(answer); scroll(); };
    try {
      const res = await fetch(opt.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })).slice(-16) }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || '');
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === 'delta' || ev.t === 'replace') {
            if (!bubble) { wait.remove(); bubble = addBot(''); }
            answer = ev.t === 'replace' ? ev.v : answer + ev.v;
            if (!frame) frame = requestAnimationFrame(paint);
          } else if (ev.t === 'done') {
            suggestions = ev.suggestions || [];
          } else if (ev.t === 'error') {
            throw new Error(ev.message || '');
          }
        }
      }
      if (frame) cancelAnimationFrame(frame);
      paint();
      if (!answer) throw new Error('');
    } catch (err) {
      wait.remove();
      const fallback = err.message || `Sorry, something went wrong.${config.phone ? ` Please call us at ${config.phone}.` : ''}`;
      if (!bubble) bubble = addBot('');
      answer = answer ? `${answer}\n\n${fallback}` : fallback;
      bubble.innerHTML = renderText(answer);
    } finally {
      log.removeAttribute('aria-busy');
      messages.push({ role: 'assistant', content: answer, suggestions });
      messages = messages.slice(-30);
      save();
      addChips(suggestions);
      busy = false;
      sendBtn.disabled = !input.value.trim();
      scroll();
    }
  }

  function restart() {
    if (busy) return;
    messages = []; save(); renderAll();
    if (!window.matchMedia('(pointer: coarse)').matches) input.focus();
  }

  function scroll(force) {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (force || near) log.scrollTop = log.scrollHeight;
  }
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(opt.storageKey) || '[]').filter(m => m && typeof m.content === 'string'); }
    catch { return []; }
  }
  function save() {
    try { sessionStorage.setItem(opt.storageKey, JSON.stringify(messages)); } catch { /* storage unavailable */ }
  }
  function el(tag, cls) { const n = document.createElement(tag); n.className = cls; return n; }

  return { open: () => toggle(true), close: () => toggle(false), ask: q => { toggle(true); ask(q); }, element: root };
}

// Auto-init from <script type="module" src=".../kb-chat.js" data-kb-chat data-...>
const tag = typeof document !== 'undefined' && document.querySelector('script[data-kb-chat]');
if (tag) {
  const d = tag.dataset;
  const start = () => createChat({
    endpoint: d.endpoint, title: d.title, subtitle: d.subtitle, avatar: d.avatar, launcher: d.launcher,
    launcherLabel: d.launcherLabel, launcherMinWidth: d.launcherMinWidth, storageKey: d.storageKey, accent: d.accent,
    ...(d.openers ? { openers: d.openers } : {}),
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
