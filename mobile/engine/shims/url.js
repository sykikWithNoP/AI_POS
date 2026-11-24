// node:url for the phone (see small.js).
import { url, fileURLToPath, pathToFileURL } from './small.js';
export default url;
export { fileURLToPath, pathToFileURL };
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
