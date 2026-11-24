// Device detection: phone, tablet or computer, the operating system, and whether it is a touch screen.
// The screens use it to pick the right words ("this phone" / "this computer"), turn on bigger touch
// buttons automatically, and hide things that need a keyboard or a second screen. Nothing is sent anywhere.
const ua = navigator.userAgent || '';
const touchPoints = navigator.maxTouchPoints || 0;
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);

const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
const os = /Android/.test(ua) ? 'Android' : /iPhone|iPod/.test(ua) ? 'iOS' : iPad ? 'iPadOS'
  : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
const app = globalThis.__POS_MOBILE__?.platform;

let kind;
if (/Android.+Mobile|iPhone|iPod/.test(ua)) kind = 'phone';
else if (iPad || (/Android/.test(ua) && !/Mobile/.test(ua))) kind = 'tablet';
else if (app && app !== 'web') kind = shortSide < 600 ? 'phone' : 'tablet';
else if (coarse && !fine) kind = shortSide < 600 ? 'phone' : 'tablet';
else kind = 'computer';

export const device = Object.freeze({
  kind,                                            // 'phone' | 'tablet' | 'computer'
  os,
  touch: coarse || (kind !== 'computer' && touchPoints > 0),
  keyboard: kind === 'computer',                   // show F-key hints only where there is a keyboard
  app: !!globalThis.__POS_MOBILE__,                // running inside the NINDITO POS Mobile app
  word: kind,                                      // "this phone" / "this tablet" / "this computer"
  label: `${os === 'Unknown' ? '' : `${os} `}${kind}${kind === 'computer' && coarse ? ' (touch screen)' : ''}`,
});

export const thisDevice = () => `this ${device.word}`;

/** Body classes for CSS: device-phone / device-tablet / device-computer, and has-touch. */
export function applyDeviceClasses() {
  document.body.classList.add(`device-${device.kind}`);
  document.body.classList.toggle('has-touch', device.touch);
}
