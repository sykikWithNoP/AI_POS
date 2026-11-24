// node:os for the phone (see small.js).
import { os } from './small.js';
export default os;
export const { homedir, tmpdir, platform, userInfo, hostname, EOL } = os;
