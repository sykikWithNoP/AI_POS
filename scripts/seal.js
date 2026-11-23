// Write integrity.json for the current source tree (run after intentional changes).
import { seal } from '../server/security/integrity.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = seal(root);
console.log(`Sealed ${Object.keys(m.files).length} files · root ${m.root.slice(0, 16)}…`);
