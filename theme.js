// Light / dark theme switch. The initial theme is applied by the inline script in <head>.
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const label = toggle.querySelector('.switch_label');
  const meta = document.querySelector('meta[name="theme-color"]');
  const COLORS = { dark: '#000000', light: '#f2f2f7' };

  function apply(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute('aria-checked', String(theme === 'light'));
    // Show the current mode
    if (label) label.textContent = theme === 'light' ? 'Light' : 'Dark';
    if (meta) meta.setAttribute('content', COLORS[theme]);
  }

  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  apply(root.dataset.theme === 'dark' ? 'dark' : 'light');
})();
