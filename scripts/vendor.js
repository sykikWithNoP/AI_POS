// Re-create the committed runtime modules (node_modules) from package-lock.json, minus files that are
// never loaded at runtime (source maps, TypeScript types, TS sources, docs). Run after changing dependencies:
//   npm run vendor
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
fs.rmSync(nm, { recursive: true, force: true });
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'inherit' });

const DROP_FILE = /(\.map|\.d\.ts|\.d\.mts|\.d\.cts|\.tsbuildinfo|\.md|\.markdown)$/i;
const KEEP_FILE = /^(license|licence|notice|copying)(\..*)?$/i; // always keep licence files
const DROP_DIR = new Set(['.github', 'docs', 'doc', 'test', 'tests', '__tests__', 'example', 'examples', 'benchmark', 'benchmarks', 'coverage', '.bin']);
let files = 0, bytes = 0;
const walk = (dir, depth) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // TypeScript source copies shipped next to compiled JS (e.g. @anthropic-ai/sdk/src) are never imported.
      const isTsSrc = e.name === 'src' && fs.existsSync(path.join(dir, 'package.json')) && fs.readdirSync(p).some((f) => f.endsWith('.ts'));
      if (DROP_DIR.has(e.name) || isTsSrc) { bytes += size(p); fs.rmSync(p, { recursive: true, force: true }); continue; }
      walk(p, depth + 1);
    } else if (DROP_FILE.test(e.name) && !KEEP_FILE.test(e.name)) { bytes += fs.statSync(p).size; fs.rmSync(p); files++; }
  }
};
const size = (p) => { let t = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); t += e.isDirectory() ? size(q) : fs.statSync(q).size; } return t; };
walk(nm, 0);
console.log(`Vendored runtime modules ready (removed ${files} files / ${(bytes / 1048576).toFixed(1)} MB not needed at runtime).`);
