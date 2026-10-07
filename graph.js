// Live pressure trend: the last 30 s of valve pressure (orange while inspiratory,
// teal while expiratory) with the target as a dashed blue line. Shown in the Valve card
// in place of the ring when "Graph" is picked; the choice is remembered.
// script.js feeds it with Trend.add(); colours come from the stylesheet so it follows the theme.
const Trend = (() => {
  const WINDOW_MS = 30000;
  const GAP_MS = 1500;        // longer than this between samples breaks the line
  const MIN_TOP = 20;         // y-axis always shows at least 0-20 cm H2O
  const PAD = { top: 8, right: 26, bottom: 6, left: 2 };

  const card = document.getElementById('valveCard');
  const canvas = document.getElementById('trendCanvas');
  const ctx = canvas.getContext('2d');
  let samples = [];           // { t, p, sp, insp }
  let running = false;
  let frame = null;

  function add(p, sp, insp, t = performance.now()) {
    samples.push({ t, p, sp, insp });
    while (samples.length && t - samples[0].t > WINDOW_MS + 2000) samples.shift();
    card.classList.add('has-data');
    if (!running) draw();
  }

  function clear() {
    samples = [];
    card.classList.remove('has-data');
    draw();
  }

  // Scroll smoothly while live; freeze on the last reading otherwise
  function setLive(on) {
    running = on;
    if (on && frame === null) loop();
    if (!on) draw();
  }

  function loop() {
    draw();
    frame = running ? requestAnimationFrame(loop) : null;
  }

  function color(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // ring view: graph is hidden
    resize();
    ctx.clearRect(0, 0, w, h);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const now = running || !samples.length ? performance.now() : samples[samples.length - 1].t;
    const visible = samples.filter((s) => now - s.t <= WINDOW_MS + 500);

    // Y range in steps of 5, never below 0-20
    const peak = visible.reduce((m, s) => Math.max(m, s.p, s.sp), 0);
    const top = Math.max(MIN_TOP, Math.ceil(peak / 5) * 5);
    const x = (t) => PAD.left + plotW - ((now - t) / WINDOW_MS) * plotW;
    const y = (v) => PAD.top + plotH - (Math.min(Math.max(v, 0), top) / top) * plotH;

    // Grid + labels
    const separator = color('--separator');
    ctx.font = `500 10px ${color('--font') || 'sans-serif'}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= top; v += 5) {
      const gy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = separator;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, gy);
      ctx.lineTo(PAD.left + plotW, gy);
      ctx.stroke();
      if (v % 10 === 0 || top <= 20) {
        ctx.fillStyle = color('--label-2');
        ctx.fillText(String(v), w - 2, gy);
      }
    }
    if (visible.length < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, 0, plotW, h);
    ctx.clip();

    // Split into runs of the same phase (and break at gaps)
    const runs = [];
    let run = null;
    for (let i = 0; i < visible.length; i++) {
      const s = visible[i], prev = visible[i - 1];
      const gap = prev && s.t - prev.t > GAP_MS;
      if (!run || gap || s.insp !== run.insp) {
        // Start the new run at the previous point so the line stays joined
        run = { insp: s.insp, pts: prev && !gap ? [prev] : [] };
        runs.push(run);
      }
      run.pts.push(s);
    }

    const orange = color('--orange'), teal = color('--teal'), neutral = color('--label-2');
    const tone = (insp) => insp === true ? orange : insp === false ? teal : neutral;

    // Soft area under the pressure line
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      const first = r.pts[0], last = r.pts[r.pts.length - 1];
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
      grad.addColorStop(0, withAlpha(tone(r.insp), 0.22));
      grad.addColorStop(1, withAlpha(tone(r.insp), 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x(first.t), y(0));
      r.pts.forEach((s) => ctx.lineTo(x(s.t), y(s.p)));
      ctx.lineTo(x(last.t), y(0));
      ctx.closePath();
      ctx.fill();
    }

    // Target: dashed step line
    ctx.strokeStyle = color('--blue');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    visible.forEach((s, i) => {
      const prev = visible[i - 1];
      if (!prev || s.t - prev.t > GAP_MS) ctx.moveTo(x(s.t), y(s.sp));
      else { ctx.lineTo(x(s.t), y(prev.sp)); ctx.lineTo(x(s.t), y(s.sp)); }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Pressure line
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      ctx.strokeStyle = tone(r.insp);
      ctx.beginPath();
      r.pts.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.p)) : ctx.moveTo(x(s.t), y(s.p))));
      ctx.stroke();
    }
    ctx.restore();

    // Current reading: dot with a soft halo
    const last = visible[visible.length - 1];
    const lx = Math.min(x(last.t), PAD.left + plotW), ly = y(last.p);
    ctx.fillStyle = withAlpha(tone(last.insp), 0.2);
    ctx.beginPath();
    ctx.arc(lx, ly, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tone(last.insp);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // "#ff9500" -> "rgba(255,149,0,a)"
  function withAlpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // Redraw on resize and theme change
  new ResizeObserver(() => { if (!running) draw(); }).observe(canvas);
  new MutationObserver(() => { if (!running) draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Don't animate in the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running && frame === null) loop();
    if (document.visibilityState === 'hidden' && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  });

  // Ring / Graph switch
  const viewButtons = card.querySelectorAll('.view_btn');
  function setView(view) {
    card.classList.toggle('view-graph', view === 'graph');
    viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    draw();
  }
  viewButtons.forEach((b) => b.addEventListener('click', () => {
    if (typeof buzz === 'function') buzz(10);
    setView(b.dataset.view);
    try { localStorage.setItem('view', b.dataset.view); } catch (e) {}
  }));
  let saved = null;
  try { saved = localStorage.getItem('view'); } catch (e) {}
  setView(saved === 'graph' ? 'graph' : 'ring');

  return { add, clear, setLive };
})();
