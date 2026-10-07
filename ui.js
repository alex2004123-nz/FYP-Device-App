// Purely visual: mirrors the text that script.js writes into the page as
// classes on <body>, so the stylesheet can react to connection, phase and link state.
// (textContent, not innerText: innerText returns the CSS-uppercased text, e.g. "INSPIRATORY")
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const RING_MAX_CM_H2O = 20;

  function sync() {
    const status = $('connect_status').textContent.trim();
    const phase = $('phaseDisplay').textContent.trim();
    const link = $('linkDisplay').textContent.trim();

    body.classList.toggle('is-connected', status.startsWith('Connected to'));
    body.classList.toggle('is-error', status.startsWith('Error') || status.startsWith('Disconnected'));
    body.classList.toggle('is-busy', !status.startsWith('Connected to') &&
      ['Connecting', 'Device found', 'GATT connected', 'Service found', 'Characteristics found'].includes(status));
    body.classList.toggle('phase-insp', phase === 'Inspiratory');
    body.classList.toggle('phase-exp', phase === 'Expiratory');
    body.classList.toggle('link-ok', link === 'OK');
    body.classList.toggle('link-lost', link === 'LOST');

    // Gauge ring fills with the pressure, 0 to RING_MAX_CM_H2O
    const pressure = parseFloat($('pressureDisplay').textContent);
    const fill = body.classList.contains('is-connected') && Number.isFinite(pressure)
      ? Math.min(Math.max(pressure / RING_MAX_CM_H2O, 0), 1) : 0;
    body.style.setProperty('--fill', fill);
  }

  const observer = new MutationObserver(sync);
  ['connect_status', 'phaseDisplay', 'linkDisplay', 'pressureDisplay'].forEach((id) =>
    observer.observe($(id), { childList: true, characterData: true, subtree: true })
  );
  sync();
})();
