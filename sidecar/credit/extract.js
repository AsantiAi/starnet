/* sidecar/credit/extract.js — turn an uploaded credit report into text.
   PDF extraction shells out to poppler `pdftotext -layout <file> -` through an injected spawn,
   with a timeout. A missing binary returns an actionable error (install poppler). A .txt file
   is read as-is so parsing and tests never need poppler. No network and no new npm dependency. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).extract = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MISSING = 'pdftotext was not found. Install poppler (the poppler-utils package) so the pdftotext command is on PATH, then retry. You can also upload the report as a .txt file produced by `pdftotext -layout report.pdf -`.';

  function extOf(file) {
    const base = String(file || '').split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot).toLowerCase() : '';
  }

  function runPdftotext(spawn, file, timeoutMs) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('pdftotext', ['-layout', file, '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ ok: false, error: (e && e.code === 'ENOENT') ? MISSING : ('pdftotext failed to start: ' + ((e && e.message) || e)) });
        return;
      }
      if (!child || !child.stdout || typeof child.on !== 'function') {
        resolve({ ok: false, error: MISSING });
        return;
      }
      let out = '';
      let err = '';
      let settled = false;
      const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => {
        let stopNote = '';
        try { child.kill('SIGKILL'); }
        catch (e) { stopNote = ' Stop also failed: ' + ((e && e.message) || e) + '.'; }
        finish({ ok: false, error: 'pdftotext timed out after ' + timeoutMs + 'ms. The PDF may be image-only or very large. Export it with `pdftotext -layout` yourself and upload the .txt file.' + stopNote });
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      if (child.stderr && child.stderr.on) child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => {
        finish({ ok: false, error: (e && e.code === 'ENOENT') ? MISSING : ('pdftotext failed: ' + ((e && e.message) || e)) });
      });
      child.on('close', (code) => {
        if (code === 0) finish({ ok: true, text: out, source: 'pdftotext' });
        else finish({ ok: false, error: 'pdftotext exited with status ' + code + (err ? ': ' + String(err).trim().slice(0, 400) : '') });
      });
    });
  }

  function makeExtractor(deps) {
    deps = deps || {};
    const spawn = deps.spawn;
    const fs = deps.fs;
    const timeoutMs = deps.timeoutMs > 0 ? deps.timeoutMs : 20000;

    async function extract(file) {
      const ext = extOf(file);
      if (ext === '.txt' || ext === '.text') {
        if (!fs || typeof fs.readFileSync !== 'function') return { ok: false, error: 'no filesystem was provided to read the text report' };
        try {
          const text = fs.readFileSync(file, 'utf8');
          return { ok: true, text: String(text), source: 'text' };
        } catch (e) {
          return { ok: false, error: 'could not read the text report: ' + ((e && e.message) || e) };
        }
      }
      if (ext !== '.pdf') {
        return { ok: false, error: 'unsupported report file. Upload a PDF or a .txt file from `pdftotext -layout`.' };
      }
      if (typeof spawn !== 'function') return { ok: false, error: MISSING };
      return runPdftotext(spawn, file, timeoutMs);
    }

    return { extract };
  }

  return { makeExtractor, MISSING };
});
