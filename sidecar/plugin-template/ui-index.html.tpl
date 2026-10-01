<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{{NAME_HTML}}</title>
<!-- The station kit (sn-* classes, glass tokens, VT323, the `starnet` bridge) is added to this page automatically.
     Your own CSS always wins over it — restyle anything you like. -->
<style>
  .note-time { color: var(--ph); font-size: 15px; white-space: nowrap; }
  .add-row { display: flex; gap: 8px; }
  .add-row .sn-input { flex: 1; }
</style>
</head>
<body>
<div class="sn-stack">
  <div class="sn-stats">
    <div class="sn-stat"><b id="stat-notes">0</b><span>Notes</span></div>
    <div class="sn-stat ok"><b id="stat-saved">—</b><span>Last saved</span></div>
    <div class="sn-stat"><b id="stat-calls">—</b><span>Crew tool calls</span></div>
    <div class="sn-stat"><b id="stat-theme">—</b><span>Phosphor</span></div>
  </div>

  <div class="sn-tabs" role="tablist">
    <button class="sn-tab on" role="tab" aria-selected="true" data-tab="notes">NOTES</button>
    <button class="sn-tab" role="tab" aria-selected="false" data-tab="kit">KIT</button>
  </div>

  <section data-pane="notes" class="sn-stack">
    <form class="add-row" id="add">
      <input class="sn-input" id="note" placeholder="Write a note and press Enter" autocomplete="off" maxlength="200">
      <button class="sn-btn primary" type="submit">ADD</button>
    </form>
    <div>
      <h4 class="sn-sect">▮ Saved notes</h4>
      <ul class="sn-list" id="list"><li class="sn-empty">No notes yet. They are saved by the station, so they survive a restart.</li></ul>
    </div>
  </section>

  <section data-pane="kit" class="sn-stack" hidden>
    <p class="sn-hint">Every class the kit gives you, drawn in your station's live colours. Change the phosphor in SETTINGS and watch this repaint.</p>
    <div class="sn-row-flex">
      <button class="sn-btn">sn-btn</button>
      <button class="sn-btn primary">primary</button>
      <button class="sn-btn danger">danger</button>
      <button class="sn-btn xs">xs</button>
      <span class="sn-badge">sn-badge</span><span class="sn-badge ok">ok</span><span class="sn-badge gold">gold</span><span class="sn-badge bad">bad</span>
    </div>
    <div class="sn-grid">
      <label class="sn-field"><span class="sn-label">sn-input</span><input class="sn-input" value="Typed text"></label>
      <label class="sn-field"><span class="sn-label">sn-select</span><select class="sn-select"><option>Amber</option><option>Green</option></select></label>
    </div>
    <label class="sn-check"><input type="checkbox" checked> sn-check</label>
    <div>
      <h4 class="sn-sect">▮ sn-sect + sn-list + sn-item</h4>
      <ul class="sn-list">
        <li class="sn-item" tabindex="0"><span class="dot ok"></span><span class="t">dot ok · hover me</span><span class="note-time">now</span></li>
        <li class="sn-item" tabindex="0"><span class="dot warn"></span><span class="t">dot warn</span><span class="note-time">2m</span></li>
        <li class="sn-item sel" tabindex="0"><span class="dot bad"></span><span class="t">dot bad · .sel</span><span class="note-time">1h</span></li>
      </ul>
    </div>
    <table class="sn-table"><thead><tr><th>sn-table</th><th>Value</th></tr></thead>
      <tbody><tr><td>Rows</td><td>3</td></tr><tr><td>Status</td><td><span class="sn-badge ok">OK</span></td></tr></tbody></table>
    <div class="sn-card"><div class="sn-label">sn-card</div><p>A lit glass card for grouped content.</p><div class="sn-progress"><i style="width:62%"></i></div></div>
    <div class="sn-well sn-hint">sn-well — a recessed slot for readouts.</div>
    <div class="sn-error">sn-error — say what went wrong and how to fix it.</div>
  </section>
</div>

<script>
(async () => {
  const listEl = document.getElementById('list');
  const input = document.getElementById('note');
  let notes = [];
  let writing = 0;   // a local write in flight: the poll must not paint a list older than it

  function render() {
    document.getElementById('stat-notes').textContent = notes.length;
    listEl.innerHTML = '';
    if (!notes.length) {
      listEl.innerHTML = '<li class="sn-empty">No notes yet. They are saved by the station, so they survive a restart.</li>';
      return;
    }
    notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'sn-item';
      // a note the crew added (the add_note tool in index.js) gets the gold lamp
      li.innerHTML = '<span class="dot ' + (n.by === 'crew' ? 'warn' : 'ok') + '"></span><span class="t"></span><span class="note-time"></span><button class="sn-btn xs danger">DELETE</button>';
      li.querySelector('.t').textContent = n.text;
      li.querySelector('.note-time').textContent = new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.querySelector('button').onclick = () => change((list) => list.filter((x) => !(x.at === n.at && x.text === n.text)), 'Could not delete');
      listEl.appendChild(li);
    });
  }

  // Every change RE-READS the stored list first: the crew may have added a note (add_note) since this window last
  // looked, and writing back a stale copy would erase it.
  async function change(edit, failText) {
    writing++;
    try {
      const fresh = (await starnet.store.get('notes')) || [];
      notes = edit(fresh);
      await starnet.store.set('notes', notes);
      document.getElementById('stat-saved').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      render();
      return true;
    } catch (err) {
      starnet.ui.toast(failText + ': ' + err.message, 'bad').catch(() => {});
      return false;
    } finally { writing--; }
  }

  document.getElementById('add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (await change((list) => [{ text, at: Date.now() }].concat(list), 'Could not save')) starnet.ui.toast('Note saved').catch(() => {});
  });

  document.querySelectorAll('.sn-tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.sn-tab').forEach((t) => { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
  }));

  const showTheme = (v) => { document.getElementById('stat-theme').textContent = (v['--ph'] || '').toUpperCase() || '—'; };
  starnet.theme.onChange(showTheme);

  await starnet.ready;
  showTheme(starnet.theme.vars);
  notes = (await starnet.store.get('notes')) || [];
  render();

  // Stay live: notes the crew adds (add_note) and the backend's own count (api.handle('stats') in index.js).
  // A timeout CHAIN, not setInterval: a slow station never stacks up overlapping polls.
  async function poll() {
    try {
      const fresh = (await starnet.store.get('notes')) || [];
      if (!writing && JSON.stringify(fresh) !== JSON.stringify(notes)) { notes = fresh; render(); }
      const s = await starnet.backend.call('stats');
      document.getElementById('stat-calls').textContent = s.toolCalls;
    } catch (_) { /* a window-only copy of this starter has no backend: the stat stays — */ }
    setTimeout(poll, 4000);
  }
  poll();
})();
</script>
</body>
</html>
