// Local playground: node examples/dev-server.mjs [path/to/kb.mjs]
// Opens http://127.0.0.1:4310 with the widget wired to the handler.
// Set OPENAI_API_KEY in your shell to use the model; without it the handler answers from the knowledge base only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChatHandler } from '../src/server/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const kbPath = resolve(process.argv[2] || resolve(here, 'kb.example.mjs'));
const kb = (await import(pathToFileURL(kbPath).href)).default;
const chat = createChatHandler({ kb });
const files = {
  '/': [resolve(here, 'index.html'), 'text/html; charset=utf-8'],
  '/kb-chat.js': [resolve(here, '../src/widget/kb-chat.js'), 'application/javascript'],
  '/kb-chat.css': [resolve(here, '../src/widget/kb-chat.css'), 'text/css'],
};

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/chat') return chat(req, res);
  const file = files[path];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': file[1] || 'application/octet-stream' });
  res.end(await readFile(file[0]));
}).listen(4310, '127.0.0.1', () => {
  console.log(`kb-chat playground: http://127.0.0.1:4310  (knowledge base: ${kbPath}, mode: ${process.env.OPENAI_API_KEY ? 'ai' : 'kb only'})`);
});
