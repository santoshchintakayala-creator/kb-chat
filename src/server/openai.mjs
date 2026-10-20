// Minimal streaming client for OpenAI's Chat Completions API (no SDK dependency).

const REASONING = /^(o\d|gpt-5)/i; // these models take only the default temperature

export async function* streamChat({ apiKey, baseUrl = 'https://api.openai.com/v1', model, messages, maxTokens = 350,
  temperature = 0.2, fetchImpl = fetch, signal }) {
  const body = { model, messages, stream: true, max_completion_tokens: maxTokens };
  if (!REASONING.test(model) && temperature != null) body.temperature = temperature;

  let res = await post(body);
  if (res.status === 400 && 'temperature' in body) {
    const text = await res.text();
    if (/temperature/i.test(text)) { delete body.temperature; res = await post(body); }
    else throw upstreamError(400, text);
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
  e.status = status; e.detail = detail;
  return e;
}
