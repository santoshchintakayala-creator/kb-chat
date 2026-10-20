/*!
 * kb-voice: a phone-call screen that rings, then connects the visitor to an AI receptionist over
 * WebRTC (OpenAI Realtime API). The server endpoint (createVoiceSessionHandler) hands out a
 * short-lived client secret; the real API key never reaches the browser.
 * Usage:
 *   <link rel="stylesheet" href="/voice/kb-voice.css">
 *   <script type="module" src="/voice/kb-voice.js" data-kb-voice data-endpoint="/api/voice"></script>
 * Any element with [data-voice-call] starts a call.
 */

const ICONS = {
  phone: '<path d="m7 3 3 5-3 2c1 3 4 6 7 7l2-3 5 3-1 4C10 22 2 14 3 4Z"/>',
  hang: '<path d="M3.5 14.5c4.7-4.6 12.3-4.6 17 0l-2.2 2.6-3.6-1.4V13a10 10 0 0 0-5.4 0v2.7l-3.6 1.4Z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const formatDuration = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createVoiceCall(options = {}) {
  const opt = {
    endpoint: '/api/voice',
    realtimeUrl: 'https://api.openai.com/v1/realtime/calls',
    title: '',
    subtitle: '',
    avatar: '',
    openers: '[data-voice-call]',
    minRingMs: 5000, // pick up on the second ring
    connectTimeoutMs: 20000,
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== '')),
  };
  for (const k of ['minRingMs', 'connectTimeoutMs']) if (typeof opt[k] === 'string') opt[k] = parseFloat(opt[k]) || 0;

  let config = { enabled: true, title: opt.title || 'Call', subtitle: opt.subtitle || 'AI receptionist', phone: '', phoneHref: '', maxCallSeconds: 300 };
  let call = null; // the active call's state
  let lastOpener = null;

  const root = document.createElement('div');
  root.className = 'kbv';
  root.hidden = true;
  root.innerHTML = `
    <div class="kbv-backdrop"></div>
    <section class="kbv-screen" role="dialog" aria-modal="true" aria-labelledby="kbv-name" aria-describedby="kbv-status">
      <div class="kbv-top"><span class="kbv-badge">AI receptionist · demo</span><button type="button" class="kbv-x" aria-label="Close">${svg('close')}</button></div>
      <div class="kbv-who">
        <div class="kbv-avatar-wrap"><span class="kbv-ring"></span><span class="kbv-ring kbv-ring2"></span><span class="kbv-avatar"></span></div>
        <h2 class="kbv-name" id="kbv-name"></h2>
        <p class="kbv-status" id="kbv-status" role="status" aria-live="polite"></p>
      </div>
      <div class="kbv-captions" aria-live="off"></div>
      <div class="kbv-note" hidden></div>
      <div class="kbv-controls">
        <button type="button" class="kbv-btn kbv-mute" aria-pressed="false">${svg('mic')}<span>Mute</span></button>
        <button type="button" class="kbv-btn kbv-end">${svg('hang')}<span>End</span></button>
        <button type="button" class="kbv-btn kbv-cc" aria-pressed="true">${svg('cc')}<span>Captions</span></button>
      </div>
      <div class="kbv-after" hidden>
        <button type="button" class="kbv-again">${svg('phone')}<span>Call again</span></button>
        <button type="button" class="kbv-close">Close</button>
      </div>
      <a class="kbv-real" hidden></a>
    </section>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const statusEl = $('.kbv-status'), captions = $('.kbv-captions'), note = $('.kbv-note');

  $('.kbv-end').addEventListener('click', () => hangUp('You ended the call'));
  $('.kbv-x').addEventListener('click', () => (call?.live ? hangUp('You ended the call') : close()));
  $('.kbv-close').addEventListener('click', close);
  $('.kbv-again').addEventListener('click', () => start(lastOpener));
  $('.kbv-mute').addEventListener('click', toggleMute);
  $('.kbv-cc').addEventListener('click', () => {
    const on = $('.kbv-cc').getAttribute('aria-pressed') !== 'true';
    $('.kbv-cc').setAttribute('aria-pressed', String(on));
    root.classList.toggle('kbv-no-cc', !on);
  });
  document.addEventListener('click', e => {
    const el = e.target.closest?.(opt.openers);
    if (el && !root.contains(el)) { e.preventDefault(); start(el); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) (call?.live ? hangUp('You ended the call') : close());
  });

  fetch(opt.endpoint, { headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(c => { if (c) config = { ...config, ...c, title: opt.title || c.title, subtitle: opt.subtitle || c.subtitle }; paintHeader(); })
    .catch(() => {});
  paintHeader();

  function paintHeader() {
    $('.kbv-name').textContent = config.title;
    $('.kbv-avatar').innerHTML = opt.avatar ? `<img src="${esc(opt.avatar)}" alt="">` : esc((config.title || 'C').trim()[0] || 'C');
    const real = $('.kbv-real');
    if (config.phoneHref && /^tel:\+?[\d-]{7,}$/.test(config.phoneHref)) {
      real.href = config.phoneHref; real.hidden = false;
      real.innerHTML = `${svg('phone')}<span>Call the real office line · ${esc(config.phone)}</span>`;
    }
  }

  function setState(state, text) {
    root.dataset.state = state;
    statusEl.textContent = text;
  }

  async function start(opener) {
    if (call?.live) return;
    lastOpener = opener || null;
    open();
    captions.innerHTML = '';
    note.hidden = true;
    $('.kbv-after').hidden = true;
    $('.kbv-controls').hidden = false;
    $('.kbv-mute').setAttribute('aria-pressed', 'false');
    $('.kbv-mute').innerHTML = `${svg('mic')}<span>Mute</span>`;
    const c = call = { live: true, startedAt: performance.now(), answered: false, muted: false, assistantLine: null };
    const gone = () => c !== call || !c.live;
    setState('calling', 'Calling…');

    // Audio context must start inside the tap: used for the ringback tone and the voice meter.
    try { c.ctx = new (window.AudioContext || window.webkitAudioContext)(); c.ctx.resume?.(); } catch { c.ctx = null; }
    c.audio = new Audio();
    c.audio.autoplay = true;
    c.audio.setAttribute('playsinline', '');
    c.audio.muted = true; // stays silent until we "pick up"

    const timeout = setTimeout(() => { if (!gone() && !c.answered) fail(c, 'No answer. The AI line didn’t connect in time.'); }, opt.connectTimeoutMs);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw Object.assign(new Error('This browser can’t place calls. Try Chrome or Safari.'), { user: true });
      const micPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .catch(() => { throw Object.assign(new Error('Please allow the microphone to talk to the receptionist.'), { user: true }); });
      const tokenPromise = fetch(opt.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(async r => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.value) throw Object.assign(new Error(d.message || 'The AI line isn’t available right now.'), { user: true });
          return d;
        });

      c.mic = await micPromise;
      if (gone()) return stopMedia(c);
      startRingback(c);
      setState('ringing', 'Ringing…');
      const session = await tokenPromise;
      if (gone()) return stopMedia(c);
      c.greeting = session.greeting || config.greeting;
      c.maxCallSeconds = session.maxCallSeconds || config.maxCallSeconds || 300;

      const pc = c.pc = new RTCPeerConnection();
      pc.ontrack = e => {
        c.audio.srcObject = e.streams[0];
        c.audio.play?.().catch(() => {});
        meter(c, e.streams[0]);
      };
      c.micTrack = c.mic.getAudioTracks()[0];
      c.micTrack.enabled = false; // nothing is heard until the call is answered
      pc.addTrack(c.micTrack, c.mic);
      const dc = c.dc = pc.createDataChannel('oai-events');
      dc.addEventListener('message', e => { try { onEvent(c, JSON.parse(e.data)); } catch { /* ignore */ } });
      const opened = new Promise((resolve, reject) => {
        dc.addEventListener('open', resolve, { once: true });
        dc.addEventListener('error', () => reject(new Error('The connection dropped.')), { once: true });
      });
      pc.addEventListener('connectionstatechange', () => {
        if (!gone() && c.answered && pc.connectionState === 'failed') hangUp('Call dropped');
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = await fetch(opt.realtimeUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.value}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdp.ok) throw Object.assign(new Error('The AI line couldn’t connect. Please try again.'), { user: true });
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() });
      await opened;
      if (gone()) return;

      // Let it ring until the second ring, then pick up.
      const wait = opt.minRingMs - (performance.now() - (c.ringStartedAt || c.startedAt));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (gone()) return;
      answer(c);
    } catch (err) {
      if (!gone()) fail(c, err.user ? err.message : 'The AI line couldn’t connect. Please try again.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function answer(c) {
    stopRingback(c);
    c.answered = true;
    c.answeredAt = performance.now();
    c.audio.muted = false;
    c.audio.play?.().catch(() => {});
    if (c.micTrack) c.micTrack.enabled = !c.muted;
    setState('live', '0:00');
    send(c, { type: 'response.create', response: { instructions: `Greet the caller now, warmly and briefly, with: "${c.greeting}"` } });
    c.tick = setInterval(() => {
      const secs = (performance.now() - c.answeredAt) / 1000;
      if (root.dataset.state === 'live') statusEl.textContent = formatDuration(secs);
      if (secs >= c.maxCallSeconds - 20 && !c.warned) { c.warned = true; showNote('This demo call ends in 20 seconds.'); }
      if (secs >= c.maxCallSeconds) hangUp('Demo calls are limited to ' + Math.round(c.maxCallSeconds / 60) + ' minutes');
    }, 500);
  }

  function onEvent(c, ev) {
    switch (ev.type) {
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (!c.assistantLine) c.assistantLine = caption('them', '');
        c.assistantLine.text += ev.delta || '';
        c.assistantLine.el.querySelector('span').textContent = c.assistantLine.text;
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (c.assistantLine && ev.transcript) c.assistantLine.el.querySelector('span').textContent = ev.transcript;
        c.assistantLine = null;
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) caption('you', ev.transcript.trim(), true);
        break;
      case 'input_audio_buffer.speech_started':
        root.classList.add('kbv-user-talking');
        break;
      case 'input_audio_buffer.speech_stopped':
        root.classList.remove('kbv-user-talking');
        break;
      case 'error':
        console.warn('kb-voice:', ev.error?.message || ev);
        break;
    }
  }

  function caption(who, text, beforeAssistant = false) {
    const el = document.createElement('p');
    el.className = `kbv-line kbv-${who}`;
    el.innerHTML = `<b>${who === 'you' ? 'You' : esc(config.title)}</b><span>${esc(text)}</span>`;
    // A caller's words are transcribed after the reply has started; keep them in spoken order.
    if (beforeAssistant && call?.assistantLine?.el?.parentNode === captions) captions.insertBefore(el, call.assistantLine.el);
    else captions.appendChild(el);
    while (captions.children.length > 6) captions.firstElementChild.remove();
    captions.scrollTop = captions.scrollHeight;
    return { el, text };
  }

  function toggleMute() {
    if (!call?.live) return;
    call.muted = !call.muted;
    if (call.micTrack && call.answered) call.micTrack.enabled = !call.muted;
    const b = $('.kbv-mute');
    b.setAttribute('aria-pressed', String(call.muted));
    b.innerHTML = `${svg(call.muted ? 'micOff' : 'mic')}<span>${call.muted ? 'Unmute' : 'Mute'}</span>`;
  }

  function send(c, event) {
    if (c.dc?.readyState === 'open') c.dc.send(JSON.stringify(event));
  }

  function hangUp(reason) {
    const c = call;
    if (!c?.live) return;
    const secs = c.answeredAt ? (performance.now() - c.answeredAt) / 1000 : 0;
    end(c);
    setState('ended', c.answered ? `Call ended · ${formatDuration(secs)}` : 'Call cancelled');
    if (reason && c.answered && !/You ended/.test(reason)) showNote(reason);
  }

  function fail(c, message) {
    end(c);
    setState('failed', 'Call failed');
    showNote(message);
  }

  function end(c) {
    c.live = false;
    clearInterval(c.tick);
    stopRingback(c);
    stopMedia(c);
    try { c.dc?.close(); } catch { /* already closed */ }
    try { c.pc?.close(); } catch { /* already closed */ }
    try { c.audio.pause(); c.audio.srcObject = null; } catch { /* no audio */ }
    cancelAnimationFrame(c.raf);
    try { c.ctx?.close(); } catch { /* closed */ }
    root.classList.remove('kbv-user-talking', 'kbv-speaking');
    $('.kbv-controls').hidden = true;
    $('.kbv-after').hidden = false;
  }

  function stopMedia(c) { c.mic?.getTracks().forEach(t => t.stop()); }
  function showNote(text) { note.textContent = text; note.hidden = false; }

  // US-style ringback: 440 + 480 Hz, 2 s on, 2.5 s off.
  function startRingback(c) {
    if (!c.ctx) return;
    const gain = c.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(c.ctx.destination);
    const oscs = [440, 480].map(f => { const o = c.ctx.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(); return o; });
    const t0 = c.ctx.currentTime + 0.05;
    for (let i = 0; i < 6; i++) {
      const on = t0 + i * 4.5;
      gain.gain.setValueAtTime(0, on);
      gain.gain.linearRampToValueAtTime(0.07, on + 0.03);
      gain.gain.setValueAtTime(0.07, on + 2);
      gain.gain.linearRampToValueAtTime(0, on + 2.03);
    }
    c.ring = { gain, oscs };
    c.ringStartedAt = performance.now();
  }
  function stopRingback(c) {
    if (!c.ring) return;
    try { c.ring.gain.gain.cancelScheduledValues(0); c.ring.gain.gain.value = 0; c.ring.oscs.forEach(o => o.stop()); } catch { /* stopped */ }
    c.ring = null;
  }

  // Pulse the avatar while the receptionist is speaking.
  function meter(c, stream) {
    // Safari can silence a remote WebRTC stream that is also routed into Web Audio, so skip the meter there.
    if (!c.ctx || /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent)) return;
    try {
      const src = c.ctx.createMediaStreamSource(stream);
      const an = c.ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        const level = Math.min(1, peak / 48);
        root.style.setProperty('--kbv-level', c.answered ? level.toFixed(2) : '0');
        root.classList.toggle('kbv-speaking', c.answered && level > 0.08);
        c.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* metering is decorative */ }
  }

  function open() {
    root.hidden = false;
    document.documentElement.classList.add('kbv-locked');
    requestAnimationFrame(() => $('.kbv-end').focus());
  }
  function close() {
    if (call?.live) return;
    root.hidden = true;
    document.documentElement.classList.remove('kbv-locked');
    lastOpener?.focus?.();
  }

  return { start: () => start(), hangUp: () => hangUp('You ended the call'), element: root };
}

const tag = typeof document !== 'undefined' && document.querySelector('script[data-kb-voice]');
if (tag) {
  const d = tag.dataset;
  const go = () => createVoiceCall({
    endpoint: d.endpoint, title: d.title, subtitle: d.subtitle, avatar: d.avatar, minRingMs: d.minRingMs,
    ...(d.openers ? { openers: d.openers } : {}), ...(d.realtimeUrl ? { realtimeUrl: d.realtimeUrl } : {}),
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}
