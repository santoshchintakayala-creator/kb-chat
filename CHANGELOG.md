# Changelog

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
