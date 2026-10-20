// Minimal streaming client for OpenAI's Chat Completions API (no SDK dependency).

/** Reasoning models (o-series, GPT-5 and GPT-6 families) take reasoning_effort and only the default temperature. */
export function isReasoningModel(model) {
  return /^(o\d|gpt-5|gpt-6)/i.test(String(model || ''));
}

/** Fastest sensible effort per family, so short chat answers are not spent on hidden reasoning. */
export function defaultReasoningEffort(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('gpt-6')) return 'none';
  if (m.startsWith('gpt-5')) return 'minimal';
  if (/^o\d/.test(m)) return 'low';
  return null;
}

export async function* streamChat({ apiKey, baseUrl = 'https://api.openai.com/v1', model, messages, maxTokens = 400,
  temperature = 0.2, reasoningEffort = null, fetchImpl = fetch, signal }) {
  const body = { model, messages, stream: true, max_completion_tokens: maxTokens };
  if (isReasoningModel(model)) {
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  } else if (temperature != null) {
    body.temperature = temperature;
  }

  // Retry once per optional parameter a model rejects (temperature, reasoning_effort).
  let res = await post(body);
  for (let i = 0; i < 2 && res.status === 400; i++) {
    const text = await res.text();
    const bad = ['reasoning_effort', 'temperature'].find(k => k in body && text.includes(k));
    if (!bad) throw upstreamError(400, text);
    delete body[bad];
    res = await post(body);
  }
  if (!res.ok) throw upstreamError(res.status, await safeText(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* ignore keep-alive or partial lines */ }
    }
  }

  function post(payload) {
    return fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    });
  }
}

async function safeText(res) { try { return (await res.text()).slice(0, 300); } catch { return ''; } }
function upstreamError(status, detail) {
  const e = new Error(`OpenAI request failed (${status})`);
  e.status = status; e.detail = String(detail || '').slice(0, 300);
  return e;
}
