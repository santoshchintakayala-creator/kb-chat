// Copy to api/chat.js in a Vercel project (with "type": "module" in package.json).
// Set OPENAI_API_KEY (and optionally OPENAI_MODEL, KB_CHAT_ALLOWED_ORIGINS) in the Vercel project's environment variables.
import { createChatHandler } from '../vendor/kb-chat/server/index.mjs';
import kb from '../chat/kb/my-client.mjs';

export default createChatHandler({ kb });
