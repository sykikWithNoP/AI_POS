// Create the update-signing key pair (Ed25519). The PRIVATE key stays with you, outside the repo
// (default ~/.nindito-pos/update-signing.pem). The PUBLIC key is written into the app so installed
// copies accept only update packages you signed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privFile = process.env.POS_SIGNING_KEY_FILE || (fs.existsSync(path.join(os.homedir(), '.free-ai-pos', 'update-signing.pem')) && !fs.existsSync(path.join(os.homedir(), '.nindito-pos', 'update-signing.pem')) ? path.join(os.homedir(), '.free-ai-pos', 'update-signing.pem') : path.join(os.homedir(), '.nindito-pos', 'update-signing.pem'));
if (fs.existsSync(privFile) && !process.argv.includes('--force')) {
  console.log(`A signing key already exists at ${privFile}. Use --force to replace it (old update files will stop installing).`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(privFile), { recursive: true });
fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(path.join(root, 'server/security/update-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Private signing key: ${privFile}  (back it up offline; never commit it)`);
console.log('Public key written to server/security/update-public.pem (commit this).');
