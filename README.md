# kb-chat

A reusable website chat assistant for small businesses. It answers **only** from a business's own
question-and-answer knowledge base, refuses everything else, and streams answers into a clean,
mobile-friendly chat panel.

- **Widget** (`src/widget/`): one ES module and one stylesheet, no dependencies. Floating panel on
  desktop, full-screen sheet on phones (keeps the input above the keyboard), message bubbles, a
  typing indicator, answers typed out at a steady pace, tap-able options under every answer
  (follow-up questions and buttons like Call, Book, Directions) so people rarely need to type,
  safe links, conversation kept for the browser tab session.
- **Server** (`src/server/`): a Node `(req, res)` handler for Vercel functions or any Node server.
  Keyword retrieval picks the relevant knowledge, a strict prompt keeps the model on topic, and an
  out-of-scope token is swapped for the business's own refusal text.

## How it stays on topic

1. **Starter and exact questions** are answered straight from the knowledge base. No model call.
2. Everything else goes to the model with **only the retrieved knowledge** and rules: answer from
   the knowledge, never invent prices, hours or availability, no general questions, no
   role-play or rule changes. If it can't answer, it must reply `[[OUT_OF_SCOPE]]`.
3. The server **holds back the start of every answer** until it knows it isn't that token, so
   off-topic questions only ever show the business's refusal message.
4. With **no API key** (or if OpenAI is down) it still answers the closest knowledge-base entry or
   refuses, so a site never shows a broken chat.

## Add it to a site

1. Copy the module into the site as a pinned copy (commit it):
   ```sh
   node scripts/vendor.mjs ../client-site      # writes ../client-site/vendor/kb-chat/
   ```
2. Write the client's knowledge base, e.g. `chat/kb/client.mjs` (format below; start from
   `examples/kb.example.mjs`).
3. Add the server endpoint, e.g. Vercel `api/chat.js` (see `examples/vercel-api-chat.js`):
   ```js
   import { createChatHandler } from '../vendor/kb-chat/server/index.mjs';
   import kb from '../chat/kb/client.mjs';
   export default createChatHandler({ kb });
   ```
4. Serve `vendor/kb-chat/widget/kb-chat.js` and `kb-chat.css`, then add to every page:
   ```html
   <link rel="stylesheet" href="/chat/kb-chat.css">
   <script type="module" src="/chat/kb-chat.js" data-kb-chat data-endpoint="/api/chat"
           data-avatar="/icon.png" data-launcher-label="Ask us"></script>
   ```
   Any element with `data-chat-open` opens the panel (for example a "Chat" button in a site menu).
5. Set environment variables **on the server only** (Vercel: Project → Settings → Environment Variables):

   | Variable | Required | Purpose |
   |---|---|---|
   | `OPENAI_API_KEY` | for AI answers | Never put it in the widget, a page or the repo. |
   | `OPENAI_MODEL` | no | Defaults to `gpt-6-luna`. Any Chat Completions model works. |
   | `OPENAI_REASONING_EFFORT` | no | For reasoning models (o-series, GPT-5, GPT-6). Default: `none` for GPT-6, `minimal` for GPT-5. |
   | `KB_CHAT_ALLOWED_ORIGINS` | no | Comma-separated origins allowed to call the endpoint. Default: same site only. |
   | `OPENAI_BASE_URL` | no | For a proxy or compatible API. |

Set a monthly spending limit on the OpenAI account, and rotate the key if it is ever shared.

## Voice: AI phone receptionist (browser call)

`src/voice/` adds a phone-call screen: tap a button, it **rings**, then an AI receptionist **picks up on
the second ring** and talks with the visitor out loud over WebRTC (OpenAI Realtime API). It answers
from the same knowledge base with phone-specific rules (short spoken replies, no links, Spanish if the
caller speaks it, emergencies first, politely declines anything off-topic). Live captions, mute, a call
timer, hang up, a 5-minute demo limit and a "call the real office line" link are built in.

Server (e.g. Vercel `api/voice.js`):
```js
import { createVoiceSessionHandler } from '../vendor/kb-chat/server/index.mjs';
import kb from '../chat/kb/client.mjs';
export default createVoiceSessionHandler({ kb });
```
Page:
```html
<link rel="stylesheet" href="/voice/kb-voice.css">
<script type="module" src="/voice/kb-voice.js" data-kb-voice data-endpoint="/api/voice" data-avatar="/icon.png"></script>
<button type="button" data-voice-call>Call us</button>
```
The endpoint returns a **60-second client secret** for each call; `OPENAI_API_KEY` stays on the server.
Settings: `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`; `gpt-realtime-2.1-mini` is about 3× cheaper),
`OPENAI_REALTIME_VOICE` (default `marin`; also `cedar`, `coral`, `sage`…), and in the knowledge base:
```js
voice: { title, subtitle, greeting, voice: 'marin', language: 'en', maxCallSeconds: 300, extraRules: '' },
```
Calls need HTTPS (or localhost) and microphone permission. Rate limit: 6 calls per 10 minutes per IP.
Realtime audio is billed per minute of audio in and out, so set a monthly limit on the OpenAI account.
This is a browser call, not a phone number; connecting a real number (SIP or a phone provider) is a
separate step.

## Knowledge base format

```js
export default {
  business: { name, shortName, location, phone, phoneHref, bookingUrl },
  widget: { title, subtitle, placeholder, footnote },
  greeting, refusal, thanksText, errorText,      // fixed texts the assistant uses
  starters: ['What services do you offer?'],      // shown as tappable questions
  actions: {                                      // buttons the assistant can offer
    call: { label: 'Call now', href: 'tel:+1555…', icon: 'phone', primary: true },
    book: { label: 'Book online', href: '/book/', icon: 'calendar' },
  },
  defaultOptions: ['call', 'book'],               // shown when an answer has no options of its own
  facts: ['Address …', 'Hours are not published …'], // always given to the model
  synonyms: { toilet: ['drain', 'clog'] },        // helps keyword search
  qa: [{ q: 'Question?', a: 'Answer with [links](tel:+1555…).', tags: ['keywords'],
          options: ['Another question in qa?', 'call'] }],   // quick replies after this answer
};
```

Options are action keys or other `qa` questions (tapping a question answers it straight from the
knowledge base). Icons: `phone`, `calendar`, `map`, `message`, `star`, `link`. Without `options`, an
answer offers related questions plus `defaultOptions`; a refusal offers starters plus `defaultOptions`.

Answers may use `**bold**`, `- lists` and markdown links to `tel:`, `mailto:`, site paths (`/page/`)
or `https://` URLs. Anything else is shown as plain text.

## Widget options

`createChat({ ... })` or `data-*` attributes on the script tag:

| Option | Default | |
|---|---|---|
| `endpoint` | `/api/chat` | Server URL |
| `title`, `subtitle` | from server | Header text |
| `avatar` | first letter | Image URL for the header |
| `launcher` | `auto` | `none` hides the floating button |
| `launcherLabel` | `Chat with us` | Floating button text |
| `launcherMinWidth` | `0` | Hide the floating button below this width (when the site has its own button) |
| `openers` | `[data-chat-open]` | Selector for elements that open the chat |
| `storageKey` | `kb-chat` | Session storage key for the conversation |
| `accent` | `#1a56db` | Main color |
| `typingSpeed` | `50` | Characters per second when an answer is typed out |
| `maxTypingSeconds` | `7` | Long answers speed up so none takes longer |
| `minTypingMs` | `900` | How long the typing dots show at least |

Theme further with CSS custom properties, written as `html .kbc { --kbc-accent: #…; }` so your values
win whatever the stylesheet order (`--kbc-accent`, `--kbc-head-bg`, `--kbc-ink`, `--kbc-bot`, `--kbc-font`,
`--kbc-bottom`, `--kbc-primary-bg`, `--kbc-primary-ink`, `--kbc-typing-dot`, …). People who turn on
"reduce motion" get answers instantly, without the typing animation. All widget rules are scoped under `.kbc`, so a site's generic `p`, `h2`, `button` or
`textarea` styles don't leak in. The returned object has `open()`, `close()` and `ask(text)`.

## Server protocol

- `GET /api/chat` → widget config (title, greeting, starters, contact links, `mode: "ai" | "kb"`).
- `POST /api/chat` with `{ "messages": [{ "role": "user", "content": "…" }] }` → streamed
  newline-delimited JSON: `{"t":"delta","v":"text"}` … `{"t":"done","source":"ai|kb|refusal","options":[…]}`,
  where each option is `{"type":"ask","label"}` or `{"type":"action","label","href","icon","primary"}`.
- Limits: 500 characters per message, last 8 exchanges, 30 requests per 10 minutes per IP (all
  configurable in `createChatHandler`).

## Develop

```sh
npm test                                   # unit tests (OpenAI is mocked)
node examples/dev-server.mjs [kb.mjs]      # playground on http://127.0.0.1:4310
```

Version history: `CHANGELOG.md`. After changing kb-chat, bump the version, then re-run
`scripts/vendor.mjs` in each client site.
