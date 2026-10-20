# Changelog

## 0.3.0 (2026-10-20)

- Voice: `createVoiceSessionHandler` mints 60-second OpenAI Realtime client secrets (default
  `gpt-realtime-2.1`, voice `marin`, semantic VAD, transcription) with phone instructions built from the
  knowledge base; `src/voice/kb-voice.js` call screen with ringback, pickup on the second ring, greeting,
  captions, mute, timer, hang up, demo time limit and failure states. Shared HTTP helpers moved to
  `src/server/http.mjs`.

## 0.2.0 (2026-10-20)

- Default model `gpt-6-luna` with `reasoning_effort: none`; GPT-5/GPT-6/o-series get a reasoning effort
  instead of temperature (`OPENAI_REASONING_EFFORT` to override); a rejected optional parameter is
  dropped and the request retried once.
- Answers come with options: per-answer `options` in the knowledge base, `actions` (Call, Book,
  Directions…) as buttons, `defaultOptions`, `startOptions`. Done events carry `options`.
- Widget: typing dots for at least `minTypingMs`, then the answer is typed out at a steady
  `typingSpeed` with a caret; half-written links and bold never show; the greeting is typed on first
  open; options animate in; reduced-motion users get answers instantly.

## 0.1.2 (2026-10-20)

- Widget styles are scoped under `.kbc` and shielded from host-page element styles; default font is
  now a system font stack (the old `inherit` default made font rules invalid). Theme with `html .kbc`.

## 0.1.1 (2026-10-20)

- Knowledge-base fallback now needs the answer to match at least half of the question’s meaningful
  words, and filler words like “help” no longer count, so unrelated questions are refused.

## 0.1.0 (2026-10-20)

- First release: widget (floating panel / full-screen on phones, bubbles, thinking indicator,
  streaming, suggested questions, safe links, session memory) and server handler (keyword
  retrieval, strict knowledge-only prompt, out-of-scope refusal, OpenAI streaming without an SDK,
  knowledge-base fallback without a key, validation, origin check, rate limit).
- First client: Pace Plumbing & Supply (Houston).
