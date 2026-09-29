/* sidecar/plugin-template.js — the files "Create a plugin" writes (plugin extensions phase 1, 2026-09-29).

   A WORKING plugin, not a stub: one hook in index.js (the original starter) and one window (ui/index.html) built
   from the station kit, with a note list saved through starnet.store and a KIT tab that shows every component in the
   live theme. The author's first sight is proof both sockets work; their job is to edit, never to guess the shape.

   templateFiles({ id, name, description }) -> { 'plugin.json': text, 'index.js': text, 'ui/index.html': text, ... } */
'use strict';

function jsString(s) { return JSON.stringify(String(s)); }
function htmlText(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function templateFiles(spec) {
  const id = String(spec.id);
  const name = String(spec.name || id);
  const description = String(spec.description || 'A StarNet plugin.');
  const title = name.replace(/[&<>"'`\u0000-\u001f\u007f]/g, '').toUpperCase().slice(0, 40) || 'PLUGIN';

  const manifest = JSON.stringify({
    name, version: '1.0.0', description, main: 'index.js',
    screens: [{ id: 'main', title, entry: 'ui/index.html', size: 'panel' }]
  }, null, 2) + '\n';

  const index = [
    '/* ' + name.replace(/\*\//g, '* /') + ' — a StarNet plugin.',
    ' *',
    ' * TWO SOCKETS, both live the moment you approve it in ABILITIES → EXTENSIONS:',
    ' *',
    ' * 1. THIS FILE runs inside the station. register(api) runs once at boot; api.on(event, handler) hooks the run:',
    ' *      pre_tool_call    before a tool runs — return {decision:"block", reason:"…"} to stop it',
    ' *      post_tool_call   after it ran (observe only)',
    ' *      pre_llm_call     before a model call — return {context:"…"} to add a standing note',
    ' *      post_llm_call / on_session_start / on_session_end / on_pre_compress / on_memory_write',
    ' *    It runs with your computer\'s permissions. Delete this file (and "main" in plugin.json) for a window-only plugin.',
    ' *',
    ' * 2. ui/index.html is the plugin\'s WINDOW (plugin.json "screens"). It is any HTML/JS you like, opened inside a',
    ' *    real StarNet window, sandboxed, with the station kit already loaded: glass classes (sn-*) and `starnet`.',
    ' *    See docs/PLUGINS.md in the StarNet repo for every class and call.',
    ' *',
    ' * Any edit to any file here turns the plugin off until you approve the new code.',
    ' */',
    "'use strict';",
    '',
    'module.exports = {',
    '  register(api) {',
    '    let toolCalls = 0;',
    '',
    '    api.on(\'post_tool_call\', (p) => {',
    '      toolCalls++;',
    '      console.log(\'[\' + ' + jsString(id) + ' + \'] \' + p.tool_name + \' (\' + toolCalls + \' this run)\');',
    '    });',
    '',
    '    api.on(\'on_session_end\', () => {',
    '      console.log(\'[\' + ' + jsString(id) + ' + \'] run finished after \' + toolCalls + \' tool calls\');',
    '      toolCalls = 0;',
    '    });',
    '  }',
    '};',
    ''
  ].join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${htmlText(name)}</title>
<!-- The station kit (sn-* classes, glass tokens, VT323, the \`starnet\` bridge) is added to this page automatically.
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

  function render() {
    document.getElementById('stat-notes').textContent = notes.length;
    listEl.innerHTML = '';
    if (!notes.length) {
      listEl.innerHTML = '<li class="sn-empty">No notes yet. They are saved by the station, so they survive a restart.</li>';
      return;
    }
    notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = 'sn-item';
      li.innerHTML = '<span class="dot ok"></span><span class="t"></span><span class="note-time"></span><button class="sn-btn xs danger">DELETE</button>';
      li.querySelector('.t').textContent = n.text;
      li.querySelector('.note-time').textContent = new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.querySelector('button').onclick = async () => { notes.splice(i, 1); await save(); };
      listEl.appendChild(li);
    });
  }
  async function save() {
    await starnet.store.set('notes', notes);
    document.getElementById('stat-saved').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    render();
  }

  document.getElementById('add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    notes.unshift({ text, at: Date.now() });
    input.value = '';
    try { await save(); starnet.ui.toast('Note saved'); }
    catch (err) { starnet.ui.toast('Could not save: ' + err.message, 'bad'); }
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
})();
</script>
</body>
</html>
`;

  return { 'plugin.json': manifest, 'index.js': index, 'ui/index.html': html };
}

module.exports = { templateFiles };
