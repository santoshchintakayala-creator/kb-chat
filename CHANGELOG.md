# Changelog

## 0.3.2 (2026-10-20)

- Echo fix: half-duplex by default. The caller's mic is muted while the receptionist talks (detected from
  the incoming RTP audio level, with OpenAI's output_audio_buffer events as a fallback), so a phone speaker
  can't feed the receptionist's own voice back in. Tap the picture to interrupt. `data-duplex="full"` opts out.
- Caller captions appear only for turns the receptionist answers; noise turns it ignores (wait_for_user)
  never show, even if the transcriber "heard" words in the noise.
- Default speech threshold raised to 0.7.

## 0.3.1 (2026-10-20)

- More natural voice: phone instructions rewritten in OpenAI's recommended sections (personality and
  tone, pacing, verbosity, variety, unclear audio, language, reading numbers); the greeting is spoken
  naturally instead of read verbatim.
- Background noise: server VAD with a higher threshold (0.65, `OPENAI_REALTIME_VAD_THRESHOLD`), a
  silent `wait_for_user` tool for noise, voice isolation on supported phones, noise transcripts hidden
  from captions, transcription keywords for better captions.
- Voice choice: `[data-voice-option]` buttons; server accepts only allowed voices.

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
