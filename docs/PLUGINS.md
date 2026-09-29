# StarNet plugins

A plugin is one folder with a single approval. It can add **windows** (your own HTML/JS, opened as real StarNet
windows), **code that runs inside the station** (hooks today; tools, routes and jobs are phase 2), or both.

- **Where plugins live:** `<workspaces>/plugins/<id>/`. ABILITIES → CREATE / ADVANCED → EXTENSIONS → **COPY FOLDER PATH** shows the exact folder.
- **Fastest start:** EXTENSIONS → **Create a plugin**. It writes a working starter (a window with notes saved by the
  station and a KIT tab showing every component) and opens that window. Edit the files from there.
- **Approval:** approval is locked to a hash of **every file** in the folder. Change one character anywhere and the
  plugin turns off, including any open window, until you approve the new code in EXTENSIONS.

Plan and open decisions: <https://claude.ai/artifact/8qxbub7yipDMTfavubYwZq>.

## The folder

```
plugins/pr-radar/
  plugin.json        the manifest
  index.js           optional — code the station loads (hooks). Omit it, and "main", for a window-only plugin
  ui/index.html      a window's page (any HTML/JS/CSS, any framework, relative assets)
  ui/app.js
```

```json
{
  "name": "PR Radar",
  "version": "1.0.0",
  "description": "Open pull requests at a glance",
  "main": "index.js",
  "screens": [
    { "id": "main", "title": "PR RADAR", "entry": "ui/index.html", "size": "panel" }
  ]
}
```

| field | rules |
|---|---|
| `screens[].id` | letters, numbers, `-`, `_`; max 32; unique |
| `screens[].title` | plain text shown in the station's title bar; max 40; markup characters are dropped |
| `screens[].entry` | an `.html` file inside the folder (no `..`, no absolute path, no dot-folders) |
| `screens[].size` | `panel` (default) or `wide`, the station's two window sizes |
| `main` | leave it out **and** name screens for a window-only plugin. Such a plugin has no access to your computer |

Up to 8 screens per plugin, 32 plugins, 512 files / 16 MB per plugin folder.

## How a window runs

- The page is served by the sidecar from `/plugin-ui/…` and shown in a **sandboxed frame with an opaque origin**. It
  runs any JavaScript you like, loads its own relative assets, and can `fetch` any public API that allows CORS.
- It **cannot** read the station page, the station's API token, or call the station's `/api` directly. Everything
  it asks of the station goes through the `starnet` bridge below. The station answers only for the plugin that owns
  the frame, and a page can't name another plugin.
- The station draws the title bar, the **PLUGIN** plate, the dock/minimize/expand/close controls and the glass sheet.
  Your page is everything inside. Text size follows the station's TEXT SIZE setting automatically.

## The kit (the station look, free)

Every page gets `starnet-kit.css` and `starnet-kit.js` injected first in `<head>`. The CSS sits in `@layer starnet`,
the lowest layer, so **any CSS you write wins** without `!important`. The page background is transparent: the
window's glass is your background.

**Tokens** (always the station's live values; they repaint when the Commander changes the phosphor):
`--ph --ph-bright --ph-dim --ph-faint --ink --text --gold --bg --panel --panel2`
`--ph-rgb --ph-bright-rgb --gold-rgb` (use as `rgba(var(--ph-rgb), .2)`)
`--ok --ok-rgb --bad --bad-rgb --warn` (semantic, constant across themes)
`--gd-edge --gd-light --gd-face --gd-hover --gd-shadow --gd-strip` (the glass recipes)
`--fs-0…5 --s-1…5 --r-sm --r --r-lg --t-fast --t-med --ease-soft --sn-font`

**Classes:**

| group | classes |
|---|---|
| layout | `sn-stack` (column, gap) · `sn-row-flex` · `sn-grid` (auto-fit cards) · `sn-spacer` |
| surfaces | `sn-panel` · `sn-card` · `sn-sect` (the ▮ HEADER strip; put an `sn-list`/`sn-card`/`sn-well` right after it) · `sn-list` + `sn-item` (glass rows; `.sel` or `aria-selected="true"` lights one) · `sn-well` |
| type | `sn-title` · `sn-label` · `sn-hint` · `sn-muted` · `sn-mono` · `sn-empty` |
| data | `sn-stats` + `sn-stat` (`<b>` value + `<span>` label; `.ok .warn .bad`) · `sn-table` · `sn-badge` (`.ok .gold .bad`) · `dot` (`.ok .warn .bad .off`) · `sn-progress > i` (set `width`) |
| controls | `sn-btn` (`.primary .danger .xs`) · `sn-input` · `sn-select` · `sn-textarea` · `sn-check` · `sn-field` (label + control) · `sn-tabs` + `sn-tab` (`.on` / `aria-selected`) |
| states | `sn-loading` · `sn-error` |

Bare `button`, `input`, `select` and `textarea` are already themed, so no control ever shows the browser's white
paint. Keep it matte: the station uses edges and light, not glows.

## The `starnet` bridge

Every call returns a Promise. A refused call rejects with an `Error` that says why.

```js
const { plugin, screen } = await starnet.ready;   // { id, name, version }, { id, title }

await starnet.store.set('notes', [{ text: 'hi' }]); // any JSON value, ≤ 256 KB each, ≤ 4 MB per plugin
await starnet.store.get('notes');                  // → value, or null
await starnet.store.delete('notes');
await starnet.store.keys();                        // → ['notes', …]

starnet.ui.toast('Saved', 'ok' | 'warn' | 'bad');  // a station notification, shown as "<Plugin>: Saved"
starnet.ui.setTitle('3 open');                     // title bar becomes "PR RADAR · 3 open"
starnet.ui.open('settings');                       // open another screen of THIS plugin
starnet.ui.close();
starnet.ui.openLink('https://github.com/…');       // https only, opens the real browser
starnet.ui.setHeight(480);                         // fixed content height (default: follows your content)

starnet.theme.vars;                                // the live tokens, e.g. vars['--ph']
starnet.theme.onChange((vars) => redrawChart(vars));
```

The store lives in `<workspaces>/plugin-data/<id>.json` (durable, survives restarts, outside every agent's files).

## Code that runs in the station (`main`)

`register(api)` runs once at boot. Today `api.on(event, handler)` hooks the run: `pre_tool_call` (can block),
`post_tool_call`, `pre_llm_call` (can add a note or block), `post_llm_call`, `on_session_start`, `on_session_end`,
`on_pre_compress`, `on_memory_write`, `subagent_stop`. It is ordinary in-process Node with **your computer's
permissions**, which is why it needs your approval, and why every edit turns it off until you approve it again.

Phase 2 adds `api.tool`, `api.route`, `api.job`, `api.store`, `api.secrets` and window ↔ backend messaging, with
each plugin backend in its own process.
