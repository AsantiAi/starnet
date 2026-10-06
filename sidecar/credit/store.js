/* sidecar/credit/store.js — atomic storage for credit-dispute cases.
   Layout: <root>/credit/cases/<caseId>/case.json, letters/<bureau>.md, letters/<bureau>.json,
   and an append-only validator-failures.jsonl. Letter files are written only as DRAFT or
   DRAFT_NEEDS_FIX. There is no status for sent, mailed, or approved. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).store = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeMemoryFs() {
    const files = new Map();
    const norm = (p) => String(p).replace(/\\/g, '/');
    return {
      existsSync(p) {
        p = norm(p);
        if (files.has(p)) return true;
        const pref = p.endsWith('/') ? p : p + '/';
        for (const k of files.keys()) if (k.startsWith(pref)) return true;
        return false;
      },
      mkdirSync(p) { files.set(norm(p).replace(/\/$/, '') + '/', ''); },
      writeFileSync(p, data) { files.set(norm(p), String(data)); },
      readFileSync(p) {
        p = norm(p);
        if (!files.has(p) || p.endsWith('/')) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return files.get(p);
      },
      appendFileSync(p, data) {
        p = norm(p);
        files.set(p, (files.has(p) ? files.get(p) : '') + String(data));
      },
      renameSync(a, b) {
        a = norm(a); b = norm(b);
        if (!files.has(a)) { const e = new Error('ENOENT: ' + a); e.code = 'ENOENT'; throw e; }
        files.set(b, files.get(a));
        files.delete(a);
      },
      readdirSync(p) {
        p = norm(p).replace(/\/$/, '');
        const pref = p + '/';
        const names = new Set();
        for (const k of files.keys()) {
          if (!k.startsWith(pref)) continue;
          const name = k.slice(pref.length).split('/')[0];
          if (name) names.add(name);
        }
        return Array.from(names);
      }
    };
  }

  function makeStore(deps) {
    deps = deps || {};
    const fs = deps.fs;
    const pathMod = deps.path;
    const root = deps.root || '';
    const clock = deps.clock || { now: () => 0 };
    if (!fs || !pathMod) throw new Error('credit store requires { fs, path, root }');

    function nowIso() {
      const n = clock.now();
      try { return new Date(n).toISOString(); } catch (_) { return String(n); }
    }
    function caseDir(caseId) { return pathMod.join(root, 'credit', 'cases', caseId); }
    function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

    function atomicWrite(file, data) {
      ensure(pathMod.dirname(file));
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
    }

    function saveCase(record) {
      const dir = caseDir(record.caseId);
      ensure(dir);
      const file = pathMod.join(dir, 'case.json');
      atomicWrite(file, JSON.stringify(record, null, 2) + '\n');
      return file;
    }

    function readCase(caseId) {
      const file = pathMod.join(caseDir(caseId), 'case.json');
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }

    function saveLetter(caseId, letter) {
      const dir = pathMod.join(caseDir(caseId), 'letters');
      ensure(dir);
      const base = pathMod.join(dir, letter.bureau);
      atomicWrite(base + '.md', letter.markdown.endsWith('\n') ? letter.markdown : letter.markdown + '\n');
      atomicWrite(base + '.json', JSON.stringify(letter.meta, null, 2) + '\n');
      if (letter.meta && letter.meta.validator && letter.meta.validator.pass === false) {
        const log = pathMod.join(caseDir(caseId), 'validator-failures.jsonl');
        const line = JSON.stringify({
          at: letter.meta.createdAt || nowIso(),
          bureau: letter.bureau,
          failures: letter.meta.validator.failures || []
        }) + '\n';
        if (typeof fs.appendFileSync === 'function') fs.appendFileSync(log, line);
        else fs.writeFileSync(log, (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') + line);
      }
      return { md: base + '.md', json: base + '.json' };
    }

    function listCases() {
      const dir = pathMod.join(root, 'credit', 'cases');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((name) => {
        return name && name.indexOf('.') !== 0 && fs.existsSync(pathMod.join(dir, name, 'case.json'));
      });
    }

    function listLetters(caseId) {
      const dir = pathMod.join(caseDir(caseId), 'letters');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(n => /\.json$/.test(n) && !/\.tmp$/.test(n)).map((n) => {
        const meta = JSON.parse(fs.readFileSync(pathMod.join(dir, n), 'utf8'));
        return { meta: meta, jsonPath: pathMod.join(dir, n), mdPath: pathMod.join(dir, n.replace(/\.json$/, '.md')) };
      });
    }

    return { saveCase, readCase, saveLetter, listCases, listLetters, caseDir, nowIso };
  }

  return { makeStore, makeMemoryFs };
});
