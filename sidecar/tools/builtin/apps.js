/* sidecar/tools/builtin/apps.js — the crew's side of APPS (sidecar/apps.js).

   The Commander describes an app ("a Daily AI News Brief, refreshed every 24h"); the lead builds it with these:
     app.create    a new app (the APPS window's NEW APP does this for the Commander; the tool is for "make me an app…" in chat)
     app.read      what an app is made of: its files, its data keys, its schedule — or one file / one data value
     app.write     write one page file (index.html …) — the open window reloads onto it at once
     app.check     compile its scripts and look-check it against the station style (never runs anything)
     app.publish   put data into the app (what its page shows) — scheduled refreshes end with this
     app.schedule  refresh it on a schedule ("every 24h", "0 8 * * *") with a task; "off" stops it
   All of it is inert until a page draws or a routine runs: the page is a network-less sandbox, and the scheduled
   task is an ordinary routine under the station's normal rules. So none of these ask first. */
'use strict';

const GUIDE = [
  'HOW A STARNET APP WORKS (keep to this):',
  '- The app is ONE page: index.html (put CSS/JS inline or in style.css / app.js beside it). It opens in a StarNet window.',
  '- The station kit is injected automatically — build ONLY with its classes so the app looks native: sn-stack · sn-row-flex · sn-grid · sn-panel · sn-card · sn-sect (▮ header strip) + sn-list/sn-item rows · sn-stats/sn-stat (<b>value</b><span>LABEL</span>) · sn-table · sn-badge · dot ok|warn|bad · sn-title · sn-label · sn-hint · sn-muted · sn-btn (.primary .xs) · sn-input · sn-select · sn-tabs/sn-tab.on · sn-empty · sn-loading · sn-error. Colours only via var(--ph), rgba(var(--ph-rgb),.2), var(--ok) --bad --warn. The page background stays transparent (the window glass shows through). No white, no other fonts, no glows.',
  '- TIME: your own sense of today\'s date is WRONG (it is your training era). app.read states the station\'s real date — anything current (news, prices, "today") is searched for THAT date, and every item you publish is from it.',
  '- The page has NO network: it never fetches anything. Its content is DATA you publish with app.publish(app, key, value) — any JSON (e.g. key "brief": { date, items:[{title, summary, source, url}] }).',
  '- In the page: const data = await starnet.store.get("brief"); render it; and re-render when new data lands: starnet.onData(async () => { … }). Show an empty state (sn-empty) until the first data arrives, and a small "updated <time>" line (data._meta is kept by the station: await starnet.store.get("_meta") → { updatedAt }).',
  '- Links: a plain <a href="https://…"> opens in the Commander\'s browser (the station catches the click) — just link. Never put a URL inside an inline onclick="…" attribute (its quotes break the attribute); for a whole clickable row, wrap it in the <a>.',
  '- If it should update by itself (daily, hourly…), call app.schedule with `every` and the `task` each refresh performs (e.g. "search the web for today\'s top AI news and publish a brief with app.publish key brief"). Then do the FIRST refresh yourself now (do the task, app.publish) so the Commander sees real content immediately.',
  '- Build order: app.read → app.write index.html → app.check → app.publish sample/real data → app.schedule. Tell the Commander in one or two sentences what the app does and when it refreshes.'
].join('\n');

// the station's real date, in words — a model assumes its training-era date, so every app turn is told it
function todayLine(now) {
  if (typeof now !== 'function') return '';
  try { return 'Today is ' + new Date(now()).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' (the station clock — trust it over your own sense of the date).\n'; } catch (_) { return ''; }
}

function makeAppTools(deps) {
  const apps = deps.apps;
  const defs = [
    {
      name: 'app.create',
      description: 'Create a new StarNet app (a dashboard or tool that lives in its own StarNet window) from a name and a one-line description. Returns its id and how to build it.',
      schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string', description: 'what it should do, in the Commander\'s words' } } },
      scope: 'write',
      run: async (a) => {
        const made = await apps.create({ name: a.name, description: a.description });
        return { content: 'Created the app "' + made.name + '" (id: ' + made.id + '). Its window shows a "building" page until you write index.html.\n' + GUIDE, summary: 'app created ' + made.id };
      }
    },
    {
      name: 'app.read',
      description: 'See what a StarNet app is made of: with only `app`, its description, files, data keys and schedule (plus the build guide); with `path`, one file; with `key`, one published data value.',
      schema: { type: 'object', required: ['app'], properties: { app: { type: 'string' }, path: { type: 'string' }, key: { type: 'string' } } },
      scope: 'read', readOnly: true,
      run: async (a) => {
        const { id, meta } = await apps.need(a.app);
        if (a.path) return { content: await apps.readFile(id, a.path), summary: 'read ' + a.path };
        if (a.key) return { content: JSON.stringify(await apps.dataGet(id, a.key), null, 2) || 'null', summary: 'data ' + a.key };
        const files = await apps.listFiles(id);
        const keys = await apps.dataKeys(id);
        const d = await apps.describe(id);
        return {
          content: todayLine(deps.now) + 'App "' + meta.name + '" (id: ' + id + ')\nDescription: ' + (meta.description || '—') +
            '\nFiles: ' + files.map(f => f.path + ' (' + f.bytes + ' B)').join(', ') +
            '\nData keys: ' + (keys.join(', ') || 'none yet') +
            '\nSchedule: ' + (d.schedule ? (d.schedule.display + ' — task: ' + (meta.schedule && meta.schedule.task) + (d.schedule.armed === false ? ' (routines are switched OFF on this station — it will not fire until the Commander turns them on)' : '')) : 'none') +
            '\n\n' + GUIDE,
          summary: 'app ' + id
        };
      }
    },
    {
      name: 'app.write',
      description: 'Write one file of a StarNet app (the whole file). index.html is the app. The open window reloads onto the new version immediately.',
      schema: { type: 'object', required: ['app', 'path', 'content'], properties: { app: { type: 'string' }, path: { type: 'string', description: 'e.g. index.html' }, content: { type: 'string', description: 'the COMPLETE file' } } },
      scope: 'write',
      run: async (a) => {
        const { id } = await apps.need(a.app);
        const r = await apps.writeFile(id, a.path, a.content);
        return { content: 'Wrote ' + r.path + ' (' + r.bytes + ' bytes); the app window reloaded. Run app.check.', summary: 'app wrote ' + r.path };
      }
    },
    {
      name: 'app.check',
      description: 'Check a StarNet app without running it: every script compiles, and a look check against the station style (warnings).',
      schema: { type: 'object', required: ['app'], properties: { app: { type: 'string' } } },
      scope: 'read', readOnly: true,
      run: async (a) => {
        const { id } = await apps.need(a.app);
        const files = await apps.listFiles(id);
        const problems = [], warnings = [];
        if (!files.some(f => f.path === 'index.html')) problems.push('index.html is missing — that is the app');
        for (const f of files) {
          if (!/\.(?:html?|js)$/i.test(f.path)) continue;
          const text = await apps.readFile(id, f.path);
          const scripts = /\.js$/i.test(f.path) ? [text] : Array.from(text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)).map(m => m[1]);
          for (const src of scripts) {
            if (/^\s*(?:import|export)\s/m.test(src) || /type=["']module/.test(text)) continue;
            const err = deps.compile ? deps.compile(src, f.path) : '';
            if (err) problems.push(f.path + ': ' + err);
          }
          if (/\.html?$/i.test(f.path)) {
            if (/background(?:-color)?\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(text)) warnings.push(f.path + ': a white background — leave the page transparent');
            if (!/class="[^"]*\bsn-/.test(text)) warnings.push(f.path + ': no kit classes (sn-*) — it will not look like StarNet');
            if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket/.test(text)) warnings.push(f.path + ': the page tries to use the network — it has none; publish data with app.publish instead');
            if (/onclick\s*=\s*"[^"]*\$\{\s*JSON\.stringify/i.test(text)) warnings.push(f.path + ': JSON.stringify inside an onclick="…" attribute — its quotes end the attribute and the handler never runs; use a plain <a href> (the station opens links) or addEventListener');
          }
        }
        return { content: (problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'OK — no problems.') + (warnings.length ? '\nLook warnings:\n- ' + warnings.join('\n- ') : ''), summary: problems.length ? 'app check: ' + problems.length + ' problem(s)' : 'app check ok' };
      }
    },
    {
      name: 'app.publish',
      description: 'Put data into a StarNet app — what its page shows (any JSON under a key the page reads). The open window updates immediately. Scheduled refreshes end with this.',
      schema: { type: 'object', required: ['app', 'key', 'value'], properties: { app: { type: 'string' }, key: { type: 'string', description: 'the key the page reads, e.g. "brief"' }, value: { description: 'any JSON value' } } },
      scope: 'write',
      run: async (a) => {
        const { id } = await apps.need(a.app);
        await apps.publish(id, a.key, a.value);
        return { content: 'Published "' + a.key + '" to the app; its window is showing it now.', summary: 'app published ' + a.key };
      }
    },
    {
      name: 'app.schedule',
      description: 'Make a StarNet app refresh itself: `every` ("every 24h", "every 6h", "0 8 * * *" for 8:00 daily) and the `task` each refresh performs (it must end by publishing with app.publish). every "off" stops it.',
      schema: { type: 'object', required: ['app', 'every'], properties: { app: { type: 'string' }, every: { type: 'string' }, task: { type: 'string' } } },
      scope: 'write',
      run: async (a) => {
        const { id } = await apps.need(a.app);
        const r = await apps.schedule(id, { every: a.every, task: a.task });
        if (r.off) return { content: 'The app no longer refreshes on a schedule.', summary: 'app schedule off' };
        return {
          content: 'Scheduled: ' + r.display + '.' + (r.armed === false ? ' NOTE: routines are switched OFF on this station, so it will not fire until the Commander turns them on — the app window offers a TURN ON button. Do the first refresh yourself now.' : ' Do the first refresh yourself now so the app has content.'),
          summary: 'app scheduled ' + r.display
        };
      }
    }
  ];
  const tools = defs.map(d => Object.assign({ capability: 'apps', impact: 'none', requiresConsent: false, network: false, readOnly: false }, d));
  return { register(registry) { for (const t of tools) registry.register(t); }, defs: tools, GUIDE };
}

function toolNames() { return ['app.create', 'app.read', 'app.write', 'app.check', 'app.publish', 'app.schedule']; }
module.exports = { makeAppTools, toolNames, GUIDE, todayLine };
