// Product name. Fixed by design: it is not a setting, it is sealed into release builds (any change is
// detected by the integrity check), and the LICENSE forbids changing or removing it.
// Each shop's own name (Settings › Business) is separate and is what customers see first on bills.
export const BRAND = Object.freeze({ name: 'NINDITO POS', tagline: 'Powered by NINDITO POS' });
