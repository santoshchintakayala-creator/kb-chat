#!/usr/bin/env node
// Copy kb-chat into a client site as a pinned, committed copy:
//   node scripts/vendor.mjs ../client-site            -> ../client-site/vendor/kb-chat/
// The copy is what the client site builds and deploys, so its build never needs access to this repo.
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('Usage: node scripts/vendor.mjs <client-site-dir>'); process.exit(1); }
const dest = resolve(target, 'vendor', 'kb-chat');

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
let commit = 'unknown';
try { commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(resolve(root, 'src', 'server'), resolve(dest, 'server'), { recursive: true });
await cp(resolve(root, 'src', 'widget'), resolve(dest, 'widget'), { recursive: true });
await cp(resolve(root, 'src', 'voice'), resolve(dest, 'voice'), { recursive: true });
await writeFile(resolve(dest, 'VERSION'), `kb-chat ${pkg.version} (${commit})\nDo not edit files here; change kb-chat and re-run scripts/vendor.mjs.\n`);
console.log(`Copied kb-chat ${pkg.version} (${commit}) to ${dest}`);
