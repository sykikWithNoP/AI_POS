// node:child_process for the phone (see small.js).
import { childProcess } from './small.js';
export default childProcess;
export const { execFile, spawn, spawnSync } = childProcess;
