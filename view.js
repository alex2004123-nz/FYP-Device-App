// Gauge / live graph switch for the main card. The initial view is applied by the inline script in <head>.
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById('viewToggle');

  function apply(view) {
    root.dataset.view = view;
    const graph = view === 'graph';
    toggle.setAttribute('aria-pressed', String(graph));
    // Label the view you'd switch to
    toggle.setAttribute('aria-label', graph ? 'Show pressure gauge' : 'Show live graph');
  }

  toggle.addEventListener('click', () => {
    const next = root.dataset.view === 'graph' ? 'gauge' : 'graph';
    apply(next);
    try { localStorage.setItem('view', next); } catch (e) {}
  });

  apply(root.dataset.view === 'graph' ? 'graph' : 'gauge');
})();
