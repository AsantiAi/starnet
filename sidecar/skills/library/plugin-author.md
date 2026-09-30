---
name: Build a StarNet Plugin
slug: plugin-author
description: Build the Commander their own StarNet plugin — a dashboard or app window in the station's glass style, with optional tools the crew can use.
category: Engineering
requires: []
license: MIT
default: false
---

A plugin is the Commander's own app inside StarNet: one or more **windows** (HTML/CSS/JS opened as real station windows, styled by the station kit) and optional **code** (its own process, with tools the crew can call, handlers for its windows, and background jobs). You write it as a **draft**. It stays off until the Commander approves it, and you can never switch it on yourself.

## The tools (find them with tool.search "plugin")
- `plugin.draft_start { id, name, description }` starts from a working template.
- `plugin.draft_from_installed { id }` copies an installed plugin so you can change it. It asks the Commander first.
- `plugin.draft_read { id, path? }` lists the files, or reads one. Always read a file before rewriting it.
- `plugin.draft_write { id, path, content }` writes a whole file.
- `plugin.check { id }` shows problems (manifest, windows, JS that won't compile) and look warnings.
- `plugin.preview { id, screen? }` opens a DRAFT window on the Commander's screen. It's sandboxed, with no network, a throwaway store and no backend, so a page that fetches data shows its empty or loading state in preview.
- `plugin.submit { id }` installs the plugin OFF, behind an approval card. The Commander then switches it on in ABILITIES → CREATE / ADVANCED → EXTENSIONS.

## Method
1. **Pin down the job.** Ask what the window should show or do and where the data comes from. If it's a public API, the window can `fetch` it directly (CORS permitting). If it needs a secret or a non-CORS API, do the call in the plugin's code with `api.handle` and have the window call `starnet.backend.call(name, args)`.
2. **Start from the template** (`plugin.draft_start`), then `plugin.draft_read` it. It already shows every socket working: `plugin.json`, `index.js` (hooks, two tools, a handler) and `ui/index.html` (stats, tabs, a stored list, and a KIT tab showing every class).
3. **Write the window with the kit, not your own chrome.** The page is transparent (the window's glass is its background) and the kit is injected for you. Build with its classes:
   - layout: `sn-stack`, `sn-row-flex`, `sn-grid`
   - surfaces: `sn-panel`, `sn-card`, `sn-sect` (the ▮ header strip) followed by `sn-list` with `sn-item` rows, `sn-well`
   - data: `sn-stats` of `sn-stat` (`<b>`value`</b><span>`LABEL`</span>`), `sn-table`, `sn-badge`, `dot ok|warn|bad`, `sn-progress > i`
   - controls: `sn-btn` (`.primary` `.danger` `.xs`), `sn-input`, `sn-select`, `sn-textarea`, `sn-check`, `sn-tabs` + `sn-tab.on`
   - states: `sn-empty`, `sn-loading`, `sn-error`
   Use colours only through the tokens (`var(--ph)`, `rgba(var(--ph-rgb), .2)`, `var(--ok)`…) so it repaints with the station. No white backgrounds, no other fonts, no glows: the station is matte VT323 glass.
4. **Wire the bridge.** `await starnet.ready`, then `starnet.store.get/set` (durable JSON, shared with the plugin's code), `starnet.ui.toast`, `starnet.ui.setTitle`, `starnet.ui.openLink('https://…')`, and `starnet.backend.call(name, args)`.
5. **Code, only if needed** (`index.js`, `"main"` in plugin.json): `api.tool({ name, description, parameters, readOnly, run })` for crew tools, `api.handle(name, fn)` for the window, `api.every(ms, fn)` for syncing, and `api.store`. Delete `index.js` and `"main"` for a window-only plugin. It then has no access to the computer at all, which is safest when no code is needed.
6. **`plugin.check`, then `plugin.preview`.** Fix every problem, and take the look warnings seriously. Preview, ask the Commander how it looks, adjust, and preview again.
7. **`plugin.submit`, then tell the Commander** what it does, that it is OFF until they approve it in EXTENSIONS, and, if it has tools, that its PLUGIN TERMINAL will be placed in the lead's room so the crew can use them (each call asks first).

## Manifest
```json
{ "name": "PR Radar", "version": "1.0.0", "description": "…", "main": "index.js",
  "screens": [{ "id": "main", "title": "PR RADAR", "entry": "ui/index.html", "size": "panel" }] }
```
`size` is `panel` or `wide`. Titles are plain text of at most 40 characters. Keep every file inside the folder.

## Never
- Never claim it is installed and working before the Commander approves it. Submitted means OFF.
- Never put a secret in window code: the page is a sandbox the Commander can inspect. Secrets belong in the plugin's code.
- Never copy the station's own files into a plugin. The kit is injected for you.
