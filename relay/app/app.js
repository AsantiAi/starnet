/* StarNet Remote — the phone app.

   Three places: STATION (the picture of your station, what needs you, your crew, your latest sessions),
   SESSIONS (every conversation, the same ones the desk shows) and FILES (what the crew delivered).

   Everything here comes from the station over the sealed channel: status, approvals, sessions, files, routines,
   live run events, and the station picture, which the desk's own renderer drew (nothing is drawn or staged on the
   phone). When the link is down the app says so and shows when it last heard from the station. A run is only
   shown as working when the station said so, and the picture always carries its age: an old one is never
   called live. All station text is rendered with textContent, never as HTML. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: 'M10 3L5 8l5 5', close: 'M3.5 3.5l9 9M12.5 3.5l-9 9', send: 'M3 8h9M8.5 4l4 4-4 4', caret: 'M3 5.5l5 5 5-5',
    expand: 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9',
    gear: 'M2 5h7M12 5h2M2 11h2M7 11h7M9 3.5h3v3H9zM4 9.5h3v3H4z',
    station: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M5.5 9.5h5', sessions: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z', files: 'M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12'
  };
  function icon(name) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.4'); s.setAttribute('stroke-linecap', 'square'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
    return s;
  }

  const S = {
    rec: null, client: null, linkState: 'connecting', lastOkAt: 0, latency: null,
    status: null, approvals: [], threads: [], files: [], routines: [],
    tab: 'station', page: null, thread: null, file: null, target: null, query: '',
    live: new Map(),            // runId -> { streamId, agentId, text, steps:[], ended }
    view: null, viewNone: false, viewBusy: false,   // the station picture: { at, w, h, bodies, url, age0, seenAt }
    portraits: new Map(), portraitBusy: false,      // skin -> image URL (null = none)
    scroll: {}, seen: new Set(), retryMs: 1000, retryTimer: null, arrivedAt: new Map()
  };
  const LIVE_VIEW_MS = 15000;   // a picture younger than this is "live"

  /* ---------- helpers ---------- */
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    const m = Math.round(s / 60); if (m < 60) return m + 'm';
    const h = Math.round(m / 60); if (h < 48) return h + 'h';
    return Math.round(h / 24) + 'd';
  }
  function clock(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  const agents = () => (S.status && S.status.agents) || [];
  const agentOf = (id) => agents().find(x => x.agentId === id) || null;
  function agentName(id) { const a = agentOf(id); return (a && a.name) || id || 'AGENT'; }
  const isWorking = (a) => !!a && a.state === 'working' && S.linkState === 'open';
  // a one-line label from text that may carry markdown marks
  const plain = (t) => String(t == null ? '' : t).replace(/`{1,3}|\*\*|^\s{0,3}#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
  const streamLive = (streamId) => { for (const [, L] of S.live) if (L.streamId === streamId && !L.ended) return true; return false; };
  let toastT = null;
  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function b64uDecode(s) { const str = String(s).replace(/-/g, '+').replace(/_/g, '/'); return atob(str + '==='.slice((str.length + 3) % 4)); }
  function bytesOf(b64) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); return u8; }

  /* ---------- a little markdown, built as DOM nodes (never innerHTML) ---------- */
  function inline(node, s) {
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g; let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) node.appendChild(document.createTextNode(s.slice(last, m.index)));
      const tok = m[0];
      node.appendChild(tok[0] === '`' ? el('code', null, tok.slice(1, -1)) : el('b', null, tok.slice(2, -2)));
      last = m.index + tok.length;
    }
    if (last < s.length) node.appendChild(document.createTextNode(s.slice(last)));
  }
  function mdNode(text) {
    const root = el('div', 'md');
    String(text).split('```').forEach((part, i) => {
      if (i % 2 === 1) { root.appendChild(el('pre', null, part.replace(/^[A-Za-z0-9_+-]*\n/, '').replace(/\n$/, ''))); return; }
      for (const blk of part.split(/\n{2,}/)) {
        if (!blk.trim()) continue;
        let buf = [];
        const flush = () => { if (buf.length) { const p = el('p'); inline(p, buf.join('\n')); root.appendChild(p); buf = []; } };
        for (const ln of blk.split('\n')) {
          let m;
          if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(ln))) { flush(); const h = el('p', 'h'); inline(h, m[1]); root.appendChild(h); }
          else if ((m = /^\s*[-*•]\s+(.*)$/.exec(ln))) { flush(); const li = el('div', 'li'); const s = el('span'); inline(s, m[1]); li.appendChild(s); root.appendChild(li); }
          else buf.push(ln);
        }
        flush();
      }
    });
    return root;
  }

  /* ---------- portraits: each agent's own sprite, from the station ---------- */
  const skinKey = (a) => (a && a.skin) || '_';
  function well(agentId, cls) {
    const a = agentOf(agentId), w = el('span', 'well' + (cls ? ' ' + cls : ''));
    const url = a && S.portraits.get(skinKey(a));
    if (url) { const img = el('img'); img.src = url; img.alt = ''; w.appendChild(img); }
    else w.textContent = (agentName(agentId) || '?').slice(0, 1).toUpperCase();
    return w;
  }
  // the sprite sits in a padded square; trim the empty margin so it fills the well
  async function cropSprite(mime, b64) {
    const img = new Image(); img.src = 'data:' + mime + ';base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return img.src;
    const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
  async function ensurePortraits() {
    if (S.portraitBusy || S.linkState !== 'open') return;
    S.portraitBusy = true;
    try {
      let got = 0;
      for (const a of agents()) {
        const k = skinKey(a);
        if (S.portraits.has(k)) continue;
        S.portraits.set(k, null);
        try { const r = await call('portrait', { agentId: a.agentId }); if (r.ok && r.data && r.data.data) { S.portraits.set(k, await cropSprite(r.data.mime || 'image/png', r.data.data)); got++; } }
        catch (_) { S.portraits.delete(k); break; }
        if (got) render(true);
      }
      if (got) render(true);
    } finally { S.portraitBusy = false; }
  }

  /* ---------- the link lamp ---------- */
  function paintLamp() {
    const lamp = $('lamp'), label = lamp.querySelector('span');
    lamp.className = 'lamp';
    if (S.linkState === 'open') { lamp.classList.add('ok'); label.textContent = 'LINKED'; }
    else if (S.linkState === 'offline') { lamp.classList.add('down'); label.textContent = 'OFFLINE' + (S.lastOkAt ? ' · ' + ago(Date.now() - S.lastOkAt).toUpperCase() : ''); }
    else if (S.linkState === 'removed') { lamp.classList.add('down'); label.textContent = 'NOT PAIRED'; }
    else { lamp.classList.add('busy'); label.textContent = 'CONNECTING'; }
  }

  /* ---------- connection ---------- */
  function connect() {
    clearTimeout(S.retryTimer);
    if (S.client) { try { S.client.close(); } catch (_) {} }
    const r = S.rec;
    const c = PhoneClient.connectRelay({ relay: r.station.relay, stationPub: r.station.stationPub, deviceId: r.station.deviceId, relayToken: r.station.relayToken, key: r.key });
    S.client = c;
    c.onEvent(onEvent);
    c.onStatus((s, detail) => {
      if (c !== S.client) return;
      if (s === 'open') { S.linkState = 'open'; S.retryMs = 1000; }
      else if (s === 'closed') {
        const code = detail && detail.code;
        S.linkState = code === 4401 ? 'removed' : (code === 4404 ? 'offline' : (S.lastOkAt ? 'offline' : 'connecting'));
        S.latency = null;
        if (S.linkState !== 'removed') scheduleReconnect();
      } else if (S.linkState !== 'offline' && S.linkState !== 'removed') S.linkState = 'connecting';   // a retry never un-says "offline"
      paintLamp(); render(true);
    });
    c.open().then(() => { S.lastOkAt = Date.now(); refreshAll(); }).catch(() => {});
  }
  function scheduleReconnect() {
    clearTimeout(S.retryTimer);
    S.retryTimer = setTimeout(connect, S.retryMs);
    S.retryMs = Math.min(S.retryMs * 2, 30000);
  }
  async function call(verb, args) {
    const r = await S.client.call(verb, args);
    S.lastOkAt = Date.now();
    return r;
  }
  async function ping() {
    if (S.linkState !== 'open') return;
    const t = performance.now();
    try { await call('ping'); S.latency = Math.round(performance.now() - t); } catch (_) {}
    paintLamp();
  }

  async function refreshStatus() { try { const r = await call('status'); if (r.ok) S.status = r.data; } catch (_) {} }
  async function refreshApprovals() { try { const r = await call('approvals'); if (r.ok) { S.approvals = r.data; for (const a of S.approvals) if (!S.arrivedAt.has(a.promptId)) S.arrivedAt.set(a.promptId, Date.now()); } } catch (_) {} }
  async function refreshThreads() { try { const r = await call('threads', { limit: 50 }); if (r.ok) S.threads = r.data; } catch (_) {} }
  async function refreshFiles() { try { const r = await call('files', { limit: 40 }); if (r.ok) S.files = r.data; } catch (_) {} }
  async function refreshRoutines() { try { const r = await call('routines'); if (r.ok) S.routines = r.data; } catch (_) {} }
  async function refreshAll() {
    await refreshStatus(); await refreshApprovals();
    if ((!S.target || !agentOf(S.target)) && agents().length) S.target = agents()[0].agentId;
    render(true);
    refreshView(); ensurePortraits(); refreshPush().then(() => render(true));
    await refreshThreads();
    render(true);
  }

  let statusSoon = null;
  function statusSoonish() { clearTimeout(statusSoon); statusSoon = setTimeout(() => refreshStatus().then(() => render(true)), 400); }

  function onEvent(e) {
    if (!e || !e.type) return;
    if (e.type === 'approval.opened') {
      if (!S.approvals.some(a => a.promptId === e.approval.promptId)) { S.approvals.push(e.approval); S.arrivedAt.set(e.approval.promptId, Date.now()); }
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) {}
      render(true); return;
    }
    if (e.type === 'approval.closed') { S.approvals = S.approvals.filter(a => a.promptId !== e.promptId); render(true); return; }
    if (e.type === 'run.started') { S.live.set(e.runId, { streamId: e.streamId, agentId: e.agentId, text: '', steps: [], ended: null }); statusSoonish(); render(true); return; }
    const L = e.runId && S.live.get(e.runId);
    const showing = L && S.thread && S.thread.streamId === L.streamId;
    if (e.type === 'run.text' && L) { L.text = e.text; if (showing) renderLive(); return; }
    if (e.type === 'run.tool' && L) { L.steps.push({ callId: e.callId, name: e.name, ok: null }); if (showing) renderLive(); return; }
    if (e.type === 'run.step' && L) { const s = L.steps.find(x => x.callId === e.callId && x.ok === null); if (s) s.ok = e.ok; if (showing) renderLive(); return; }
    if (e.type === 'run.ended') {
      if (L) L.ended = e;
      statusSoonish();
      if (e.error) toast(agentName(e.agentId) + ': ' + e.error, true);
      if (showing) openThread(S.thread.streamId, S.thread.agentId, true);
      refreshThreads().then(() => render(true));
      return;
    }
    if (e.type === 'station' && (e.name === 'agent.run.start' || e.name === 'agent.run.end')) statusSoonish();
  }

  /* ---------- the station picture ---------- */
  const hero = (() => {
    const root = el('div', 'hero'), frame = el('div', 'hero-frame'), img = el('img'), marks = el('div'), chip = el('span', 'chip'), dot = el('i'), chipText = el('span');
    const expand = el('button', 'icon-btn expand'); expand.type = 'button'; expand.setAttribute('aria-label', 'Open the station view'); expand.appendChild(icon('expand'));
    const empty = el('div', 'hero-empty'), eb = el('b'), es = el('span');
    img.alt = 'Your station'; chip.appendChild(dot); chip.appendChild(chipText); empty.appendChild(eb); empty.appendChild(es);
    frame.appendChild(img); frame.appendChild(marks); root.appendChild(frame); root.appendChild(empty); root.appendChild(chip); root.appendChild(expand);
    return { root, frame, img, marks, chip, chipText, expand, empty, eb, es, shown: '' };
  })();
  const viewAge = () => (S.view ? S.view.age0 + (Date.now() - S.view.seenAt) : Infinity);
  const viewLive = () => S.linkState === 'open' && viewAge() < LIVE_VIEW_MS;
  function stampText() { return viewLive() ? 'LIVE' : 'AS OF ' + ago(viewAge()).toUpperCase() + ' AGO'; }

  function markNodes(selId) {
    const out = [];
    if (!S.view) return out;
    for (const b of S.view.bodies || []) {
      const a = agentOf(b.agentId), working = isWorking(a), sel = b.agentId === selId;
      if (!working && !sel) continue;
      const m = el('div', 'mark' + (working ? ' work' : '') + (sel ? ' sel' : ''));
      m.style.left = (b.x / S.view.w * 100) + '%'; m.style.top = (b.y / S.view.h * 100) + '%';
      m.appendChild(el('span', null, agentName(b.agentId).toUpperCase()));
      out.push(m);
    }
    return out;
  }
  function paintHero() {
    const v = S.view;
    hero.frame.hidden = !v; hero.chip.hidden = !v; hero.expand.hidden = !v; hero.empty.hidden = !!v;
    if (!v) {
      hero.shown = '';
      if (S.viewNone) { hero.eb.textContent = 'NO PICTURE YET'; hero.es.textContent = 'Open StarNet on your computer and your station appears here.'; }
      else if (S.linkState === 'open') { hero.eb.textContent = 'LOADING YOUR STATION'; hero.es.textContent = ''; }
      else { hero.eb.textContent = 'STATION OFFLINE'; hero.es.textContent = 'The picture appears when your station is reachable.'; }
      return;
    }
    if (hero.shown !== v.url) { hero.shown = v.url; hero.img.src = v.url; viewer.img.src = v.url; viewer.img.style.width = v.w + 'px'; viewer.img.style.height = v.h + 'px'; }
    hero.frame.style.aspectRatio = v.w + ' / ' + v.h;
    const live = viewLive();
    hero.root.classList.toggle('stale', !live);
    hero.chip.className = 'chip' + (live ? ' live' : ''); hero.chipText.textContent = stampText();
    hero.marks.replaceChildren(...markNodes(S.target));
    if (!$('viewer').hidden) paintViewer();
  }
  async function refreshView() {
    if (S.viewBusy || S.linkState !== 'open') return;
    S.viewBusy = true;
    try {
      const r = await call('view', { have: S.view ? S.view.at : 0 });
      if (!r.ok) return;
      let d = r.data;
      if (d.none) { S.viewNone = true; return; }
      S.viewNone = false;
      if (d.same && S.view) { S.view.age0 = Math.max(0, d.now - d.at); S.view.seenAt = Date.now(); return; }
      const first = d, parts = [];
      for (let i = 0; i < 12; i++) {
        parts.push(bytesOf(d.data));
        if (d.eof) break;
        const n = await call('view', { at: first.at, offset: d.offset + d.bytes });
        if (!n.ok || n.data.changed || n.data.none) return;   // the desk drew a newer one mid-read: the next pass takes it
        d = n.data;
      }
      const url = URL.createObjectURL(new Blob(parts, { type: first.mime }));
      const pre = new Image(); pre.src = url;
      try { await pre.decode(); } catch (_) { URL.revokeObjectURL(url); return; }
      const old = S.view && S.view.url;
      S.view = { at: first.at, w: first.w, h: first.h, bodies: first.bodies || [], url, age0: Math.max(0, first.now - first.at), seenAt: Date.now() };
      paintHero();
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1500);
    } catch (_) { /* the link lamp reports a dead link; the picture keeps its age */ }
    finally { S.viewBusy = false; paintHero(); }
  }
  // nearest crew member to a point in picture pixels, within `reach` picture pixels
  function bodyNear(px, py, reach) {
    let best = null, bd = reach;
    for (const b of (S.view && S.view.bodies) || []) { const d = Math.hypot(b.x - px, (b.y - 10) - py); if (d < bd) { bd = d; best = b; } }
    return best && agentOf(best.agentId) ? best : null;
  }
  hero.root.addEventListener('click', (ev) => {
    if (!S.view) return;
    const r = hero.frame.getBoundingClientRect(), k = S.view.w / r.width;
    const b = ev.target.closest('.expand') ? null : bodyNear((ev.clientX - r.left) * k, (ev.clientY - r.top) * k, 30 * k);
    if (b) { S.target = b.agentId; render(); return; }
    openViewer();
  });

  /* ---------- the station, full screen ---------- */
  const viewer = (() => {
    const stage = $('viewer-stage'), img = el('img'), marks = el('div');
    img.alt = 'Your station'; stage.appendChild(img); stage.appendChild(marks);
    return { stage, img, marks, k: 1, x: 0, y: 0, fit: 1, pts: new Map(), sel: null, tap: null, pinch: null, lastTap: 0 };
  })();
  function viewerFit() {
    const W = window.innerWidth, H = window.innerHeight;
    viewer.fit = Math.min(W / S.view.w, H / S.view.h);
    viewer.k = viewer.fit; viewer.x = (W - S.view.w * viewer.k) / 2; viewer.y = (H - S.view.h * viewer.k) / 2;
  }
  function viewerClamp() {
    const W = window.innerWidth, H = window.innerHeight, w = S.view.w * viewer.k, h = S.view.h * viewer.k;
    viewer.k = Math.max(viewer.fit, Math.min(Math.max(viewer.fit * 8, 3), viewer.k));
    viewer.x = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, viewer.x));
    viewer.y = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, viewer.y));
  }
  function paintViewer() {
    if (!S.view) return;
    viewerClamp();
    viewer.stage.style.width = S.view.w + 'px'; viewer.stage.style.height = S.view.h + 'px';
    viewer.stage.style.transform = 'translate(' + viewer.x + 'px,' + viewer.y + 'px) scale(' + viewer.k + ')';
    viewer.marks.replaceChildren(...markNodes(viewer.sel));
    for (const m of viewer.marks.children) m.style.transform = 'scale(' + (1 / viewer.k) + ')';
    const st = $('viewer-stamp'); st.className = 'chip' + (viewLive() ? ' live' : ''); st.replaceChildren(el('i'), el('span', null, stampText()));
    const plate = $('viewer-plate'), a = viewer.sel && agentOf(viewer.sel);
    plate.hidden = !a;
    // rebuilt only when what it says changes: a button must never be swapped out from under a finger
    const line = a ? (isWorking(a) ? 'working' + (a.since ? ' · ' + ago(Date.now() - a.since) : '') : S.linkState === 'open' ? 'idle' : 'last seen ' + (a.state || 'idle')) : '';
    const plateKey = a ? a.agentId + '|' + a.name + '|' + line + '|' + (S.portraits.get(skinKey(a)) ? 1 : 0) : '';
    if (a && plate.dataset.key !== plateKey) {
      plate.dataset.key = plateKey;
      const t = el('span', 't'); t.appendChild(el('b', null, a.name || a.agentId));
      t.appendChild(el('span', null, line));
      const b = el('button', 'btn', 'Message'); b.type = 'button';
      b.onclick = () => { S.target = a.agentId; closeViewer(); S.tab = 'station'; S.thread = null; S.file = null; S.page = null; render(); $('compose-text').focus(); };
      plate.replaceChildren(well(a.agentId, 'sm'), t, b);
    }
  }
  function openViewer() { if (!S.view) return; viewer.sel = null; $('viewer-plate').dataset.key = ''; $('viewer').hidden = false; viewerFit(); paintViewer(); refreshView(); }
  function closeViewer() { $('viewer').hidden = true; viewer.pts.clear(); viewer.pinch = null; }
  (function wireViewer() {
    const v = $('viewer');
    $('viewer-close').appendChild(icon('close'));
    $('viewer-close').onclick = closeViewer;
    const zoomAt = (cx, cy, k) => { const nk = Math.max(viewer.fit, Math.min(Math.max(viewer.fit * 8, 3), k)); viewer.x = cx - (cx - viewer.x) * (nk / viewer.k); viewer.y = cy - (cy - viewer.y) * (nk / viewer.k); viewer.k = nk; };
    v.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.viewer-top > *, .viewer-plate')) return;
      try { v.setPointerCapture(e.pointerId); } catch (_) {}
      viewer.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (viewer.pts.size === 1) viewer.tap = { x: e.clientX, y: e.clientY, at: Date.now(), moved: false };
      if (viewer.pts.size === 2) { const [a, b] = [...viewer.pts.values()]; viewer.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: viewer.k }; if (viewer.tap) viewer.tap.moved = true; }
    });
    v.addEventListener('pointermove', (e) => {
      const p = viewer.pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (viewer.pts.size === 1) { viewer.x += dx; viewer.y += dy; if (viewer.tap && Math.hypot(e.clientX - viewer.tap.x, e.clientY - viewer.tap.y) > 8) viewer.tap.moved = true; }
      else if (viewer.pts.size === 2 && viewer.pinch) { const [a, b] = [...viewer.pts.values()]; zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, viewer.pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / viewer.pinch.d)); }
      paintViewer();
    });
    const up = (e) => {
      if (!viewer.pts.has(e.pointerId)) return;
      viewer.pts.delete(e.pointerId);
      if (viewer.pts.size < 2) viewer.pinch = null;
      const t = viewer.tap;
      if (viewer.pts.size === 0 && t && !t.moved && Date.now() - t.at < 350) {
        const px = (t.x - viewer.x) / viewer.k, py = (t.y - viewer.y) / viewer.k;
        const b = bodyNear(px, py, 30 / viewer.k);
        if (b) viewer.sel = b.agentId;
        else if (Date.now() - viewer.lastTap < 320) { if (viewer.k > viewer.fit * 1.05) viewerFit(); else zoomAt(t.x, t.y, viewer.k * 2.5); viewer.lastTap = 0; }
        else { viewer.sel = null; viewer.lastTap = Date.now(); }
        paintViewer();
      }
      if (viewer.pts.size === 0) viewer.tap = null;
    };
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, viewer.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); paintViewer(); }, { passive: false });
    window.addEventListener('resize', () => { if (!v.hidden && S.view) { viewerFit(); paintViewer(); } });
  })();

  /* ---------- notifications (Web Push, sent by the station itself) ---------- */
  // what this phone can do: 'ok' | 'install' (iPhone Safari tab: only a Home Screen app may get pushes) | 'no'
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function pushSupport() {
    if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
    if (/iPhone|iPad/.test(navigator.userAgent) && !isStandalone()) return 'install';
    return 'no';
  }
  S.push = { on: null, busy: false };   // on = the station holds a subscription for THIS phone (null until asked)
  function keyBytes(b64) { const bin = b64uDecode(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  async function refreshPush() {
    if (S.linkState !== 'open') return;
    try { const r = await call('pushKey'); if (r.ok) { S.push.on = !!r.data.on; S.push.key = r.data.key; } } catch (_) {}
  }
  async function pushOn() {
    if (S.push.busy) return;
    S.push.busy = true; render();
    try {
      const perm = await Notification.requestPermission();   // must run inside the tap that asked for it
      if (perm !== 'granted') { toast(perm === 'denied' ? 'Notifications are blocked for this app in your phone settings' : 'Notifications were not allowed', true); return; }
      if (!S.push.key) await refreshPush();
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      // a subscription made for another station's key (paired elsewhere before) would be refused by the push service
      const want = keyBytes(S.push.key), have = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (sub && (!have || have.length !== want.length || have.some((x, i) => x !== want[i]))) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
      const j = sub.toJSON();
      const r = await call('pushOn', { endpoint: j.endpoint, keys: j.keys });
      if (!r.ok) { toast(r.error, true); return; }
      S.push.on = true;
      toast('Notifications on');
      // the first one proves the whole path; if the push service refuses it, say so rather than leave a silent switch
      call('pushTest').then((t) => { if (!t.ok) toast(t.error, true); }).catch(() => {});
    } catch (e) { toast('Could not turn notifications on: ' + ((e && e.message) || e), true); }
    finally { S.push.busy = false; render(); }
  }
  async function pushOff() {
    S.push.busy = true; render();
    try {
      await call('pushOff');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      S.push.on = false; toast('Notifications off');
    } catch (e) { toast(e.message, true); }
    finally { S.push.busy = false; render(); }
  }
  const nudgeKey = 'starnet.remote.pushNudge';
  function nudgeDismissed() { try { return localStorage.getItem(nudgeKey) === '1'; } catch (_) { return false; } }
  function pushCard(compact) {
    const sup = pushSupport();
    const box = el('div', 'glass pad push-card');
    if (sup === 'install') {
      box.appendChild(el('div', 'push-h', 'Get a tap when your crew needs you'));
      box.appendChild(el('div', 'note-line', 'On iPhone, notifications work once StarNet is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.'));
    } else if (sup === 'no') {
      box.appendChild(el('div', 'note-line', 'This browser cannot receive notifications.'));
    } else {
      box.appendChild(el('div', 'push-h', S.push.on ? 'Notifications are on' : 'Get a tap when your crew needs you'));
      box.appendChild(el('div', 'note-line', S.push.on
        ? 'Your station taps this phone when an agent needs your OK or has a question, and when a task you sent finishes.'
        : 'When an agent needs your OK, has a question, or finishes a task you sent, your station taps this phone, even with the app closed.'));
      const row = el('div', 'btns');
      const b = el('button', 'btn' + (S.push.on ? ' no' : ' go'), S.push.busy ? '…' : S.push.on ? 'Turn off' : 'Turn on'); b.type = 'button';
      b.disabled = S.push.busy || S.linkState !== 'open' || S.push.on === null;
      b.onclick = () => (S.push.on ? pushOff() : pushOn());
      row.appendChild(b);
      if (compact && !S.push.on) { const x = el('button', 'btn quiet', 'Not now'); x.type = 'button'; x.onclick = () => { try { localStorage.setItem(nudgeKey, '1'); } catch (_) {} render(); }; row.appendChild(x); }
      box.appendChild(row);
    }
    return box;
  }
  // a notification tap: '#needs' opens STATION, '#thread=<id>' opens that conversation
  function openFromPush(url) {
    const m = /^#thread=([A-Za-z0-9_-]{1,64})$/.exec(String(url || ''));
    if (m) { const t = S.threads.find(x => x.streamId === m[1]); openThread(m[1], (t && t.agentId) || S.target); return; }
    if (url === '#needs') { closeViewer(); setTab('station'); }
  }

  /* ---------- rendering ---------- */
  const viewKey = () => (S.thread ? 'thread' : S.file ? 'file' : S.page ? S.page : S.tab);
  function setTab(t) {
    S.tab = t; S.thread = null; S.file = null; S.page = null;
    if (t === 'sessions') refreshThreads().then(() => render(true));
    if (t === 'files') refreshFiles().then(() => render(true));
    if (t === 'station') { refreshView(); refreshThreads().then(() => render(true)); }
    render();
  }

  // soft = a background refresh: never rebuild the screen under someone who is typing in it or has a finger on it
  let touching = false, softOwed = false;
  document.addEventListener('pointerdown', () => { touching = true; }, true);
  for (const n of ['pointerup', 'pointercancel']) document.addEventListener(n, () => { touching = false; if (softOwed) { softOwed = false; setTimeout(() => render(true), 60); } }, true);
  function render(soft) {
    const v = $('view');
    if (soft && v.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) return;
    if (soft && touching) { softOwed = true; return; }
    const key = viewKey(), prevKey = v.dataset.key || '';
    S.scroll[prevKey] = v.scrollTop;
    const crewEl = v.querySelector('.crew'); const crewX = crewEl ? crewEl.scrollLeft : 0;
    const pushed = !!(S.thread || S.file || S.page);
    const needs = S.approvals.length;
    $('n-needs').hidden = !needs; $('n-needs').textContent = needs || '';
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
    $('back').hidden = !pushed; $('gear').hidden = pushed; $('tabs').hidden = pushed || S.linkState === 'removed';
    const openRow = S.thread && S.threads.find(x => x.streamId === S.thread.streamId);
    const bw = $('bar-well'); bw.hidden = !S.thread; if (S.thread) bw.replaceChildren(well(S.thread.agentId, 'sm'));
    const firstSaid = S.thread && (S.thread.turns || []).find(t => t.role === 'user');
    $('bar-title').textContent = S.thread ? ((openRow && (plain(openRow.title) || plain(openRow.preview))) || (firstSaid && plain(firstSaid.content).slice(0, 80)) || agentName(S.thread.agentId)) : S.file ? (S.file.name || 'FILE') : S.page === 'settings' ? 'SETTINGS'
      : S.tab === 'sessions' ? 'SESSIONS' : S.tab === 'files' ? 'FILES' : ((S.status && S.status.station) || 'STATION');
    const sub = $('bar-sub'); sub.hidden = !S.thread;
    if (S.thread) sub.textContent = agentName(S.thread.agentId) + (streamLive(S.thread.streamId) ? ' · working' : '');
    const target = S.thread ? S.thread.agentId : S.target;
    $('compose').hidden = !(S.thread || (!pushed && S.tab !== 'files')) || S.linkState === 'removed';
    const to = $('compose-to'); to.replaceChildren(document.createTextNode('TO '), el('b', null, target ? agentName(target) : '—'));
    if (!S.thread && agents().length > 1) to.appendChild(icon('caret'));
    to.disabled = !!S.thread || agents().length < 2;
    $('compose-text').placeholder = S.thread ? 'Reply…' : target ? 'Give ' + agentName(target) + ' a task…' : 'Give your crew a task…';
    $('compose-send').disabled = S.linkState !== 'open' || !target;
    v.dataset.key = key;
    v.replaceChildren();
    if (S.linkState === 'removed') v.appendChild(removedCard());
    else if (S.file) renderFile(v);
    else if (S.thread) renderThread(v);
    else if (S.page === 'settings') renderSettings(v);
    else if (S.tab === 'station') renderStation(v);
    else if (S.tab === 'sessions') renderSessions(v);
    else renderFiles(v);
    if (key === prevKey) { v.scrollTop = S.scroll[key] || 0; const c = v.querySelector('.crew'); if (c) c.scrollLeft = crewX; }
    else v.scrollTop = key === 'thread' ? v.scrollHeight : (S.scroll[key] || 0);
  }

  function section(title, gold, more) {
    const s = el('div', 'sect'), h = el('div', 'label' + (gold ? ' gold' : ''), title);
    if (more) { const b = el('button', 'more', more.text); b.type = 'button'; b.onclick = more.go; h.appendChild(b); }
    s.appendChild(h);
    return s;
  }

  function removedCard() {
    const box = el('div', 'ask');
    box.appendChild(el('div', 'who', 'This phone was removed'));
    box.appendChild(el('div', 'what', 'The station no longer knows this phone. Pair it again from SETTINGS → DEVICES on your desktop.'));
    const b = el('button', 'btn', 'Pair again'); b.type = 'button';
    b.onclick = async () => { await RemoteStore.forget(); location.reload(); };
    const row = el('div', 'btns'); row.appendChild(b); box.appendChild(row);
    return box;
  }

  function askCard(a) {
    const box = el('div', 'ask');
    const isQ = a.kind === 'question';
    box.appendChild(el('div', 'who', agentName(a.agentId) + (isQ ? ' · QUESTION' : ' · ' + (a.scope || 'write').toUpperCase() + ' CHECK') + (a.surface === 'desk' ? ' · DESK RUN' : a.surface === 'channel' ? ' · CHANNEL' : '')));
    const arrived = S.arrivedAt.get(a.promptId) || Date.now();
    if (isQ) {
      let q = {}; try { q = JSON.parse(a.argsSummary || '{}'); } catch (_) {}
      box.appendChild(el('div', 'what', q.question || 'Your agent has a question.'));
      const opts = el('div', 'btns');
      for (const o of (q.options || []).slice(0, 6)) {
        const b = el('button', 'btn', o); b.type = 'button';
        b.onclick = () => replyQ(a, o, box);
        opts.appendChild(b);
      }
      if (opts.childNodes.length) box.appendChild(opts);
      const ta = el('textarea'); ta.rows = 2; ta.placeholder = 'Or type an answer…'; box.appendChild(ta);
      const row = el('div', 'btns'); const send = el('button', 'btn go', 'Answer'); send.type = 'button';
      send.onclick = () => { if (ta.value.trim()) replyQ(a, ta.value, box); };
      row.appendChild(send); box.appendChild(row);
    } else {
      box.appendChild(el('div', 'what', agentName(a.agentId) + ' wants to use ' + a.tool));
      if (a.argsSummary) box.appendChild(el('pre', null, a.argsSummary));
      const row = el('div', 'btns fill');
      const mk = (label, cls, decision) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.onclick = () => decide(a, decision, box); row.appendChild(b); };
      mk('Once', 'go', 'once'); mk('This session', '', 'session'); mk('Deny', 'no', 'deny');
      box.appendChild(row);
      box.appendChild(el('div', 'note', 'Arrived ' + clock(Date.now() - arrived) + ' ago. "Always" and full access are set at the desk.'));
    }
    if (S.linkState !== 'open') { for (const b of box.querySelectorAll('button')) b.disabled = true; box.appendChild(el('div', 'note', 'Reconnect to answer. If the station stays unreachable, it denies this on its own after a short wait.')); }
    // it is on a screen a person is looking at: earn the one bounded extension, once
    if (document.visibilityState === 'visible' && !S.seen.has(a.promptId)) { S.seen.add(a.promptId); call('seen', { runId: a.runId, promptId: a.promptId }).catch(() => {}); }
    return box;
  }
  async function decide(a, decision, box) {
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try {
      const r = await call('decide', { runId: a.runId, promptId: a.promptId, decision });
      if (!r.ok) { toast(r.error, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
      S.approvals = S.approvals.filter(x => x.promptId !== a.promptId);
      toast(decision === 'deny' ? 'Denied' : 'Approved');
    } catch (e) { toast(e.message, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
    render();
  }
  async function replyQ(a, text, box) {
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try {
      const r = await call('reply', { runId: a.runId, promptId: a.promptId, text: String(text) });
      if (!r.ok) { toast(r.error, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
      S.approvals = S.approvals.filter(x => x.promptId !== a.promptId);
      toast('Answered');
    } catch (e) { toast(e.message, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
    render();
  }

  // When the link is down, everything below is what the station LAST said. Say so, never pass it off as live.
  function staleNote(v) {
    if (S.linkState === 'open' || !S.lastOkAt) return;
    v.appendChild(el('div', 'note-line', 'Station offline. Showing what it last reported, ' + ago(Date.now() - S.lastOkAt) + ' ago.'));
  }

  function sessionRow(t) {
    const row = el('button', 'row'); row.type = 'button';
    row.appendChild(well(t.agentId, 'sm'));
    const tt = el('span', 't');
    tt.appendChild(el('b', null, plain(t.title) || plain(t.preview) || agentName(t.agentId)));
    tt.appendChild(el('span', null, agentName(t.agentId) + (t.title && t.preview ? ' · ' + plain(t.preview) : '')));
    row.appendChild(tt);
    const live = streamLive(t.streamId) && S.linkState === 'open';
    row.appendChild(el('span', 'd' + (live ? ' work' : ''), live ? 'WORKING' : t.lastAt ? ago(Date.now() - t.lastAt) : ''));
    row.onclick = () => openThread(t.streamId, t.agentId);
    return row;
  }

  function renderStation(v) {
    staleNote(v);
    paintHero();
    v.appendChild(hero.root);
    if (S.push.on === false && pushSupport() !== 'no' && !nudgeDismissed()) v.appendChild(pushCard(true));
    if (S.approvals.length) {
      const s = section('Needs you · ' + S.approvals.length, true);
      for (const a of S.approvals) s.appendChild(askCard(a));
      v.appendChild(s);
    }
    const list = agents();
    const working = list.filter(isWorking).length;
    const cs = section('Crew' + (list.length ? ' · ' + (working ? working + ' working' : list.length) : ''));
    if (!list.length) cs.appendChild(el('div', 'empty', S.linkState === 'open' ? 'No agents on this station yet.' : 'Waiting for the station…'));
    else {
      const strip = el('div', 'crew');
      for (const a of list) {
        const w = isWorking(a);
        const m = el('button', 'mate' + (S.target === a.agentId ? ' sel' : '') + (w ? ' work' : '')); m.type = 'button';
        const pw = well(a.agentId); if (w) pw.appendChild(el('i', 'dot work'));
        m.appendChild(pw);
        m.appendChild(el('b', null, a.name || a.agentId));
        m.appendChild(el('em', null, S.linkState !== 'open' ? (a.state || 'idle') : w ? (a.since ? clock(Date.now() - a.since) : 'working') : 'idle'));
        m.onclick = () => { S.target = a.agentId; render(); };
        strip.appendChild(m);
      }
      cs.appendChild(strip);
    }
    v.appendChild(cs);
    const ss = section('Sessions', false, S.threads.length > 5 ? { text: 'ALL ' + S.threads.length + ' ›', go: () => setTab('sessions') } : null);
    if (!S.threads.length) ss.appendChild(el('div', 'empty', S.linkState === 'open' ? 'No sessions yet. Write a task below to start one.' : 'Waiting for the station…'));
    else { const l = el('div', 'list'); for (const t of S.threads.slice(0, 5)) l.appendChild(sessionRow(t)); ss.appendChild(l); }
    v.appendChild(ss);
  }

  function renderSessions(v) {
    staleNote(v);
    const q = el('input', 'search'); q.type = 'search'; q.placeholder = 'Search sessions'; q.value = S.query; q.autocapitalize = 'off'; q.setAttribute('aria-label', 'Search sessions');
    const l = el('div', 'list');
    const fill = () => {
      const needle = S.query.trim().toLowerCase();
      const rows = needle ? S.threads.filter(t => [t.title, t.preview, agentName(t.agentId)].join(' ').toLowerCase().indexOf(needle) >= 0) : S.threads;
      l.replaceChildren();
      if (!rows.length) l.appendChild(el('div', 'empty', needle ? 'Nothing matches that.' : S.linkState === 'open' ? 'No sessions yet. Write a task below to start one.' : 'Waiting for the station…'));
      for (const t of rows) l.appendChild(sessionRow(t));
    };
    q.addEventListener('input', () => { S.query = q.value; fill(); });
    if (S.threads.length > 6 || S.query) v.appendChild(q);
    fill();
    v.appendChild(l);
  }

  async function openThread(streamId, agentId, keepScroll) {
    const same = S.thread && S.thread.streamId === streamId;
    S.thread = { streamId, agentId, turns: same ? S.thread.turns : null };
    S.file = null; S.page = null; S.target = agentId;
    const v = $('view'), atEnd = v.scrollHeight - v.scrollTop - v.clientHeight < 80;
    render();
    try { const r = await call('thread', { streamId, limit: 80 }); if (r.ok && S.thread && S.thread.streamId === streamId) S.thread.turns = r.data; } catch (e) { toast(e.message, true); }
    render();
    if (!keepScroll || atEnd) v.scrollTop = v.scrollHeight;
  }

  function renderThread(v) {
    const log = el('div', 'log');
    const turns = S.thread.turns;
    if (!turns) log.appendChild(el('div', 'empty', 'Loading…'));
    else for (const t of turns) {
      if (t.role !== 'user' && t.role !== 'assistant') continue;
      if (!t.content || t.content === 'null') continue;
      const m = el('div', 'msg ' + (t.role === 'user' ? 'user' : 'agent'));
      m.appendChild(el('span', 'who', t.role === 'user' ? 'YOU' : agentName(t.agentId || S.thread.agentId).toUpperCase()));
      m.appendChild(mdNode(t.content));
      log.appendChild(m);
    }
    const mine = S.approvals.filter(a => [...S.live.entries()].some(([rid, L]) => rid === a.runId && L.streamId === S.thread.streamId));
    for (const a of mine) log.appendChild(askCard(a));
    const liveBox = el('div', 'log'); liveBox.id = 'live'; log.appendChild(liveBox);
    v.appendChild(log);
    renderLive();
  }

  function renderLive() {
    const box = $('live'); if (!box || !S.thread) return;
    const v = $('view'), atEnd = v.scrollHeight - v.scrollTop - v.clientHeight < 80;
    box.replaceChildren();
    for (const [runId, L] of S.live) {
      if (L.streamId !== S.thread.streamId || L.ended) continue;
      for (const s of L.steps.slice(-6)) {
        const d = el('div', 'step');
        d.appendChild(el('b', s.ok === false ? 'x' : s.ok === null ? 'w' : null, s.ok === null ? '…' : s.ok ? '✓' : '✕'));
        d.appendChild(el('span', null, s.name)); box.appendChild(d);
      }
      if (L.text) { const m = el('div', 'msg agent'); m.appendChild(el('span', 'who', agentName(L.agentId).toUpperCase())); m.appendChild(mdNode(L.text)); box.appendChild(m); }
      const w = el('div', 'working'); w.appendChild(el('i')); w.appendChild(el('span', null, agentName(L.agentId) + ' is working'));
      box.appendChild(w);
      const stop = el('button', 'btn no', 'Stop'); stop.type = 'button';
      stop.onclick = async () => { stop.disabled = true; try { const r = await call('stop', { runId }); toast(r.ok ? 'Stopped' : r.error, !r.ok); } catch (e) { toast(e.message, true); } };
      const row = el('div', 'btns'); row.appendChild(stop); box.appendChild(row);
    }
    if (atEnd) v.scrollTop = v.scrollHeight;
  }

  function renderFiles(v) {
    staleNote(v);
    const l = el('div', 'list');
    let n = 0;
    for (const d of S.files) {
      for (const f of (d.files || []).slice(0, 4)) {
        n++;
        const row = el('button', 'row'); row.type = 'button';
        row.appendChild(el('span', 'well file', (f.path.split('.').pop() || '').slice(0, 4).toUpperCase()));
        const t = el('span', 't'); t.appendChild(el('b', null, f.path.split('/').pop())); t.appendChild(el('span', null, (d.agentId ? agentName(d.agentId) : '') + (d.title ? ' · ' + d.title : '')));
        row.appendChild(t);
        row.appendChild(el('span', 'd', d.createdAt ? ago(Date.now() - d.createdAt) : ''));
        row.onclick = () => openFile(d.agentId, f.path);
        l.appendChild(row);
      }
    }
    if (!n) l.appendChild(el('div', 'empty', S.linkState === 'open' ? 'Nothing delivered yet. Files your crew hands in show up here.' : 'Waiting for the station…'));
    v.appendChild(l);
  }

  async function openFile(agentId, filePath) {
    S.file = { agentId, path: filePath, name: filePath.split('/').pop(), loading: true };
    render();
    const parts = []; let meta = null, offset = 0;
    try {
      for (let i = 0; i < 80; i++) {   // 80 × 256 KB = 20 MB ceiling on a phone
        const r = await call('fetch', { agentId, path: filePath, offset });
        if (!r.ok) throw new Error(r.error);
        meta = r.data; parts.push(bytesOf(meta.data)); offset += meta.bytes;
        if (meta.eof || !meta.bytes) break;
      }
      if (!S.file || S.file.path !== filePath) return;
      S.file = Object.assign(S.file, { loading: false, mime: meta.mime, active: meta.active, blob: new Blob(parts, { type: meta.active ? 'application/octet-stream' : meta.mime }), size: meta.size, name: meta.name || S.file.name });
    } catch (e) { S.file.loading = false; S.file.error = e.message; }
    render();
  }

  function renderFile(v) {
    const f = S.file, box = el('div', 'viewer-file');
    if (f.loading) { box.appendChild(el('div', 'empty', 'Fetching ' + f.name + '…')); v.appendChild(box); return; }
    if (f.error) { box.appendChild(el('div', 'err-line', f.error)); v.appendChild(box); return; }
    const url = URL.createObjectURL(f.blob);
    if (!f.active && /^image\//.test(f.mime)) { const img = el('img'); img.src = url; img.alt = f.name; box.appendChild(img); }
    else if (!f.active && /^(text\/|application\/json)/.test(f.mime)) { const pre = el('pre'); f.blob.text().then(t => { pre.textContent = t.slice(0, 200000); }); box.appendChild(pre); }
    else box.appendChild(el('div', 'empty', f.active ? 'This file can run code, so it is not opened here. Save it and open it yourself if you trust it.' : 'No preview for this type.'));
    const a = el('a', 'btn', 'Save to phone'); a.href = url; a.download = f.name;
    const row = el('div', 'btns fill'); row.appendChild(a); box.appendChild(row);
    box.appendChild(el('div', 'hint', Math.round(f.size / 1024) + ' KB · ' + f.mime));
    v.appendChild(box);
  }

  function renderSettings(v) {
    const ns = section('Notifications'); ns.appendChild(pushCard(false)); v.appendChild(ns);
    if (S.routines.length) {
      const rs = section('Routines'), l = el('div', 'list');
      for (const j of S.routines) {
        const row = el('div', 'row');
        row.appendChild(el('i', 'dot' + (j.inFlight ? ' work' : j.enabled ? ' ok' : '')));
        const t = el('span', 't');
        t.appendChild(el('b', null, j.name || j.prompt || j.id));
        t.appendChild(el('span', null, (j.enabled ? (j.schedule || 'scheduled') : 'paused') + (j.agentId ? ' · ' + agentName(j.agentId) : '')));
        row.appendChild(t);
        const b = el('button', 'btn', j.enabled ? 'Pause' : 'Resume'); b.type = 'button';
        b.onclick = async () => {
          b.disabled = true;
          try { const res = await call('routine', { jobId: j.id, enabled: !j.enabled }); if (!res.ok) toast(res.error, true); else toast(res.data.enabled ? 'Resumed' : 'Paused'); } catch (e) { toast(e.message, true); }
          await refreshRoutines(); render();
        };
        row.appendChild(b);
        l.appendChild(row);
      }
      rs.appendChild(l); v.appendChild(rs);
    }
    const s = section('This phone'), card = el('div', 'glass pad');
    const r = S.rec && S.rec.station;
    const lines = [
      ['Station', (S.status && S.status.station) || (r && r.stationId) || '—'],
      ['Phone name', (r && r.name) || '—'],
      ['Phone code', (r && r.fingerprint) || '—'],
      ['Relay', (r && r.relay) || '—'],
      ['Link', S.linkState === 'open' ? 'linked' + (S.latency != null ? ', ' + S.latency + ' ms' : '') : S.linkState]
    ];
    const kvs = el('div');
    for (const [k, val] of lines) { const row = el('div', 'kv'); row.appendChild(el('span', null, k)); row.appendChild(el('b', null, val)); kvs.appendChild(row); }
    card.appendChild(kvs);
    card.appendChild(el('div', 'note-line', 'Everything between this phone and your station is sealed end to end. The relay only passes it along.'));
    s.appendChild(card); v.appendChild(s);
    const fs = section('Forget this station');
    fs.appendChild(el('div', 'note-line', 'Removes the pairing from this phone. You can pair again from the desk.'));
    const b = el('button', 'btn no', 'Forget station'); b.type = 'button';
    let armed = false;
    b.onclick = async () => {
      if (!armed) { armed = true; b.textContent = 'Tap again to forget'; setTimeout(() => { armed = false; b.textContent = 'Forget station'; }, 4000); return; }
      try { S.client && S.client.close(); } catch (_) {}
      await RemoteStore.forget(); location.replace(location.pathname);
    };
    const row = el('div', 'btns'); row.appendChild(b); fs.appendChild(row); v.appendChild(fs);
  }

  /* ---------- the agent picker (a sheet from the bottom) ---------- */
  function openSheet() {
    const body = $('sheet-body'), l = el('div', 'list');
    for (const a of agents()) {
      const row = el('button', 'row' + (S.target === a.agentId ? ' sel' : '')); row.type = 'button';
      const pw = well(a.agentId, 'sm'); if (isWorking(a)) pw.appendChild(el('i', 'dot work'));
      row.appendChild(pw);
      const t = el('span', 't'); t.appendChild(el('b', null, a.name || a.agentId));
      t.appendChild(el('span', null, isWorking(a) ? 'working' : 'idle' + (a.model ? ' · ' + a.model : '')));
      row.appendChild(t);
      row.onclick = () => { S.target = a.agentId; closeSheet(); render(); };
      l.appendChild(row);
    }
    body.replaceChildren(l);
    $('sheet').hidden = false; $('sheet-scrim').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-scrim').hidden = true; }

  /* ---------- composer ---------- */
  async function send() {
    const ta = $('compose-text'); const text = ta.value.trim();
    const agentId = S.thread ? S.thread.agentId : S.target;
    if (!text || !agentId) return;
    $('compose-send').disabled = true;
    try {
      const r = await call('send', { agentId, text, streamId: S.thread ? S.thread.streamId : undefined });
      if (!r.ok) { toast(r.error, true); return; }
      ta.value = ''; autosize();
      S.live.set(r.data.runId, S.live.get(r.data.runId) || { streamId: r.data.streamId, agentId, text: '', steps: [], ended: null });
      await openThread(r.data.streamId, agentId);
      refreshThreads();   // so the new session is in the list when you go back
    } catch (e) { toast(e.message, true); }
    finally { $('compose-send').disabled = S.linkState !== 'open'; }
  }
  function autosize() { const ta = $('compose-text'); ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }

  /* ---------- pairing ---------- */
  const DECK = ['bar', 'view', 'tabs'];
  function showSetup(pairing) { $('setup').hidden = false; $('setup-pairing').hidden = !pairing; $('setup-howto').hidden = !!pairing; for (const id of DECK.concat('compose')) $(id).hidden = true; }
  function showDeck() { $('setup').hidden = true; for (const id of DECK) $(id).hidden = false; }

  async function pairFrom(blob) {
    let p; try { p = JSON.parse(b64uDecode(blob)); } catch (_) { throw new Error('That pairing link is damaged. Make a new one on the desktop.'); }
    if (!p || p.v !== PhoneClient.VERSION || !p.s || !p.p || !p.c) throw new Error('That pairing link is from a different version of StarNet.');
    const relay = p.r || location.origin;
    showSetup(true);
    $('setup-fp').textContent = await PhoneClient.fingerprint(p.s);
    const key = await PhoneClient.makeDeviceKey();
    const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone';
    const res = await PhoneClient.pairRelay({ relay, stationPub: p.s, pairingId: p.p, code: p.c, name, key });
    const rec = { key, station: { stationId: res.stationId || p.i, stationPub: p.s, deviceId: res.deviceId, relayToken: res.relayToken, relay, name, fingerprint: res.fingerprint, pairedAt: Date.now() } };
    await RemoteStore.save(rec);
    return rec;
  }

  const looking = () => document.visibilityState === 'visible' && S.linkState === 'open';
  async function boot() {
    const m = /[#&]pair=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (m) {
      history.replaceState(null, '', location.pathname);   // the one-time code leaves the address bar at once
      try { S.rec = await pairFrom(m[1]); toast('Paired'); }
      catch (e) { showSetup(true); $('setup-err').textContent = e.message; $('setup-err').hidden = false; $('setup-retry').hidden = false; return; }
    } else {
      try { S.rec = await RemoteStore.load(); } catch (_) { S.rec = null; }
    }
    if (!S.rec) return showSetup(false);
    showDeck(); paintLamp(); render(); connect();
    const openHash = /^#(needs|thread=[A-Za-z0-9_-]{1,64})$/.test(location.hash) ? location.hash : '';
    if (openHash) { history.replaceState(null, '', location.pathname); setTimeout(() => openFromPush(openHash), 2500); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open') openFromPush(e.data.url); });
    setInterval(ping, 20000);
    setInterval(() => { if (looking()) refreshStatus().then(() => { render(true); ensurePortraits(); }); paintLamp(); }, 10000);
    // the station picture: asked for only while it is on screen, which is also what keeps the desk drawing it
    setInterval(() => {
      const onScreen = !$('viewer').hidden || (S.tab === 'station' && !S.thread && !S.file && !S.page);
      if (looking() && onScreen) refreshView(); else if (S.view) paintHero();
    }, 4000);
  }

  $('back').appendChild(icon('back')); $('gear').appendChild(icon('gear')); $('compose-send').appendChild(icon('send'));
  for (const s of document.querySelectorAll('[data-ico]')) s.appendChild(icon(s.dataset.ico));
  $('setup-go').onclick = () => { const v = $('setup-link').value.trim(); const m = /#pair=([A-Za-z0-9_-]+)/.exec(v); if (!m) { toast('Paste the whole pairing link from the desktop', true); return; } location.hash = 'pair=' + m[1]; location.reload(); };
  $('setup-retry').onclick = () => location.replace(location.pathname);
  $('compose-send').onclick = send;
  $('compose-to').onclick = openSheet;
  $('sheet-scrim').onclick = closeSheet;
  $('compose-text').addEventListener('input', autosize);
  $('compose-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); } });
  $('back').onclick = () => {
    const wasThread = !!S.thread;
    S.thread = null; S.file = null; S.page = null; render();
    if (S.tab === 'station') refreshView();
    if (wasThread) refreshThreads().then(() => render(true));
  };
  $('gear').onclick = () => { S.page = 'settings'; refreshRoutines().then(() => render(true)); render(); };
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => setTab(b.dataset.tab);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.rec) { if (S.linkState !== 'open') connect(); else refreshAll(); } });

  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!window.isSecureContext || !(window.crypto && crypto.subtle)) {
    showSetup(false);
    $('setup-howto').replaceChildren(el('p', 'err-line', 'This page must be opened over HTTPS. Open the pairing link your desktop shows.'));
    return;
  }
  boot();
})();
