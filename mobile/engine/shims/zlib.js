// node:zlib for the phone (see small.js).
import { zlib } from './small.js';
export default zlib;
export const { inflateRawSync, deflateRawSync } = zlib;
