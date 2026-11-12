(() => {
  const key = 'studio-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  let theme = preference === 'dark' || preference === 'light' ? preference : system.matches ? 'dark' : 'light';
  const buttons = new Set();
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#161f1b' : '#f5f5ef');
    for (const button of buttons) {
      button.textContent = theme === 'dark' ? '☀ Light theme' : '☾ Dark theme';
      button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  function makeButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      preference = theme;
      try { localStorage.setItem(key, theme); } catch {}
      apply();
    });
    buttons.add(button);
    return button;
  }
  apply(); // Runs in the head before the first paint.
  system.addEventListener('change', event => {
    if (preference !== 'dark' && preference !== 'light') { theme = event.matches ? 'dark' : 'light'; apply(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue;
    theme = preference === 'dark' || preference === 'light' ? preference : system.matches ? 'dark' : 'light';
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'theme-bar';
    bar.setAttribute('aria-label', 'Appearance');
    bar.append(makeButton());
    document.body.prepend(bar);
    const dialog = document.querySelector('#dialog');
    if (dialog) new MutationObserver(() => {
      for (const button of buttons) if (!button.isConnected) buttons.delete(button);
      if (dialog.open && !dialog.querySelector('.theme-toggle')) {
        dialog.append(makeButton());
        apply();
      }
    }).observe(dialog, { childList: true, attributes: true, attributeFilter: ['open'] });
    apply();
  });
})();
