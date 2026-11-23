// Applies the saved theme before the app loads (no flash). Plain script, no imports.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('pos.themeState') || 'null');
    if (!s || !s.theme || s.theme === 'system') return;
    var r = document.documentElement;
    if (s.theme.indexOf('custom:') === 0 && s.vars) {
      r.setAttribute('data-theme', 'custom-' + (s.mode === 'dark' ? 'dark' : 'light'));
      for (var k in s.vars) if (/^#[0-9a-f]{6}$/i.test(s.vars[k])) r.style.setProperty('--' + k, s.vars[k]);
      r.style.colorScheme = s.mode === 'dark' ? 'dark' : 'light';
      if (s.image && /^url\("\/api\/themes\/\d+\/image"\)$/.test(s.image)) {
        var veil = 100 - Math.max(0, Math.min(80, s.strength || 25));
        r.setAttribute('data-bg-image', '');
        r.style.setProperty('--bg-image', s.image);
        r.style.setProperty('--bg-veil', 'color-mix(in srgb, ' + s.vars.bg + ' ' + veil + '%, transparent)');
        r.style.setProperty('--nav-veil', 'color-mix(in srgb, ' + s.vars['nav-bg'] + ' ' + Math.min(96, veil + 8) + '%, transparent)');
      }
    } else if (/^[a-z]+$/.test(s.theme)) {
      r.setAttribute('data-theme', s.theme);
    }
  } catch (e) { /* ignore */ }
})();
