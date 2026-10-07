#!/usr/bin/env node
/* scripts/dashboard-server.js — local StarNet dispute desk.
   Binds ONLY 127.0.0.1:8765. Started by scripts/dashboard-daemon.sh.

   GET / is the dispute desk (scripts/dashboard/index.html): the case queue
   and the round-1 DRAFT letters already written under credit/cases/.
   Reads are read-only. This process does not draft, write, mail, or approve,
   and it does not touch p165 pipeline logic or case payload files.

   A sleeping browser tab, a dropped keep-alive socket, or a client that
   resets the connection must close that socket and nothing else.

   Timeouts (idle socket, not process death):
     server.timeout        0       legacy socket inactivity timer off
     server.requestTimeout 0       a paused client does not abort the process
     server.headersTimeout 65000   unfinished headers get a 408, then that socket closes
     server.keepAliveTimeout 120000  idle keep-alive sockets close after 2 minutes
*/
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const storeMod = require('../sidecar/credit/store.js');

const HOST = '127.0.0.1';
const PORT = 8765;
const REPO = path.resolve(__dirname, '..');
const PAGE = path.join(__dirname, 'dashboard', 'index.html');
const CASE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const BUREAUS = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };
const MAX_JSON = 1024 * 1024;
const MAX_LETTER = 512 * 1024;

function ignoreSocketError() { /* ECONNRESET / EPIPE from a sleeping or closed tab */ }

function candidateRoots() {
  const home = os.homedir() || '';
  const roots = [];
  function add(p) { if (p) roots.push(path.resolve(p)); }
  add(process.env.STARNET_DASHBOARD_ROOT);
  add(process.env.STARNET_WORKSPACES);
  add(process.env.SKYNET_WORKSPACES);
  if (process.platform === 'darwin') {
    add(path.join(home, 'Library', 'Application Support', 'ai.skynet.harness', 'workspaces'));
    add(path.join(home, '.local', 'share', 'StarNet', 'workspaces'));
  } else {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA
      || process.env.XDG_DATA_HOME
      || path.join(home, '.local', 'share');
    add(path.join(base, 'StarNet', 'workspaces'));
    add(path.join(base, 'Skynet', 'workspaces'));
  }
  add(path.join(REPO, 'workspaces'));
  add(path.join(REPO, 'sidecar', 'workspaces'));
  add(REPO);
  const seen = Object.create(null);
  return roots.filter(function (r) {
    if (seen[r]) return false;
    seen[r] = true;
    return true;
  });
}

function caseDir(root, caseId) {
  if (!CASE_ID.test(caseId)) return null;
  const casesRoot = path.resolve(root, 'credit', 'cases');
  const dir = path.resolve(casesRoot, caseId);
  if (dir !== path.join(casesRoot, caseId)) return null;
  let realCases, realDir;
  try {
    realCases = fs.realpathSync(casesRoot);
    realDir = fs.realpathSync(dir);
  } catch (_) { return null; }
  const prefix = realCases.endsWith(path.sep) ? realCases : realCases + path.sep;
  if (realDir.indexOf(prefix) !== 0 || path.basename(realDir) !== caseId) return null;
  return realDir;
}

function readJson(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_JSON) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readLetter(dir, bureau) {
  if (!Object.prototype.hasOwnProperty.call(BUREAUS, bureau)) return '';
  const lettersDir = path.join(dir, 'letters');
  const file = path.join(lettersDir, bureau + '.md');
  let realLetters, realFile;
  try {
    realLetters = fs.realpathSync(lettersDir);
    realFile = fs.realpathSync(file);
  } catch (_) { return ''; }
  const prefix = realLetters.endsWith(path.sep) ? realLetters : realLetters + path.sep;
  if (realFile.indexOf(prefix) !== 0) return '';
  const st = fs.statSync(realFile);
  if (!st.isFile() || st.size > MAX_LETTER) return '';
  return fs.readFileSync(realFile, 'utf8');
}

function summarize(root, caseId, record, letters) {
  const first = letters[0] && letters[0].meta ? letters[0].meta : {};
  const accounts = [];
  letters.forEach(function (letter) {
    ((letter.meta && letter.meta.accounts) || []).forEach(function (a) { accounts.push(a); });
  });
  return {
    caseId: caseId,
    status: (record && record.status) || first.status || 'NEEDS_REVIEW',
    bureau: first.bureau || (record && record.letters && record.letters[0] && record.letters[0].bureau) || '',
    reportDate: record && record.reportDate || null,
    flagCount: record && Array.isArray(record.flags) ? record.flags.length : 0,
    missingFields: record && record.missingFields || [],
    accounts: accounts.map(function (a) {
      return { furnisher: a.furnisher || '', last4: a.last4 || null, pattern: a.pattern || null };
    }),
    root: root
  };
}

function loadCase(root, caseId) {
  const dir = caseDir(root, caseId);
  if (!dir) return null;
  const store = storeMod.makeStore({ fs: fs, path: path, root: root, clock: { now: function () { return Date.now(); } } });
  let record = null;
  try { record = readJson(path.join(dir, 'case.json')); } catch (_) { record = null; }
  let letters = [];
  try { letters = store.listLetters(caseId) || []; } catch (_) { letters = []; }
  return { record: record, letters: letters, dir: dir };
}

function collect() {
  const cases = [];
  const roots = [];
  candidateRoots().forEach(function (root) {
    const dir = path.join(root, 'credit', 'cases');
    if (!fs.existsSync(dir)) return;
    roots.push(root);
    let ids = [];
    try {
      const store = storeMod.makeStore({ fs: fs, path: path, root: root, clock: { now: function () { return Date.now(); } } });
      ids = store.listCases() || [];
    } catch (_) { ids = []; }
    ids.forEach(function (caseId) {
      if (!CASE_ID.test(caseId)) return;
      if (cases.some(function (c) { return c.caseId === caseId; })) return;
      const loaded = loadCase(root, caseId);
      if (!loaded) return;
      cases.push(summarize(root, caseId, loaded.record, loaded.letters));
    });
  });
  return { roots: roots, cases: cases };
}

function detail(caseId) {
  if (!CASE_ID.test(caseId)) return null;
  const found = collect().cases.find(function (c) { return c.caseId === caseId; });
  if (!found) return null;
  const loaded = loadCase(found.root, caseId);
  if (!loaded) return null;
  const record = loaded.record || {};
  return {
    caseId: caseId,
    status: found.status,
    reportDate: record.reportDate || null,
    missingFields: Array.isArray(record.missingFields) ? record.missingFields : [],
    flags: Array.isArray(record.flags) ? record.flags : [],
    letters: loaded.letters.map(function (letter) {
      const meta = letter.meta || {};
      return {
        bureau: meta.bureau || letter.bureau || '',
        status: meta.status || '',
        pattern: meta.pattern || null,
        accounts: meta.accounts || [],
        factsRelied: meta.factsRelied || [],
        unverified: meta.unverified || [],
        wordSpacingNote: meta.wordSpacingNote || '',
        validator: meta.validator || null,
        markdown: readLetter(loaded.dir, meta.bureau || '')
      };
    })
  };
}

function send(res, status, type, body) {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-StarNet-Dashboard': 'dispute-desk'
  });
  if (res.req && res.req.method === 'HEAD') res.end();
  else res.end(buf);
}

function sendJson(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function page() {
  return fs.readFileSync(PAGE);
}

const server = http.createServer((req, res) => {
  req.on('error', ignoreSocketError);
  res.on('error', ignoreSocketError);
  req.on('aborted', ignoreSocketError);
  res.req = req;
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
    return;
  }
  let pathname = '/';
  try { pathname = decodeURIComponent(String(req.url || '/').split('?')[0]); }
  catch (_) { send(res, 400, 'text/plain; charset=utf-8', 'bad path\n'); return; }
  if (pathname.indexOf('..') !== -1) { send(res, 400, 'text/plain; charset=utf-8', 'bad path\n'); return; }

  try {
    if (pathname === '/' || pathname === '/index.html') {
      send(res, 200, 'text/html; charset=utf-8', page());
      return;
    }
    if (pathname === '/api/cases') {
      const found = collect();
      sendJson(res, 200, { ok: true, roots: found.roots, cases: found.cases });
      return;
    }
    const one = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]{1,80})$/);
    if (one) {
      const body = detail(one[1]);
      if (!body) { sendJson(res, 404, { ok: false, error: 'no such case' }); return; }
      sendJson(res, 200, { ok: true, case: body });
      return;
    }
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
  } catch (err) {
    console.error('dashboard request failed (still serving):', (err && err.message) || err);
    try { sendJson(res, 500, { ok: false, error: 'dashboard read failed' }); } catch (_) {}
  }
});

// Drop idle sockets. Never treat that as a reason to stop listening.
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 65000;
server.keepAliveTimeout = 120000;
server.maxHeadersCount = 64;

server.on('clientError', (err, socket) => {
  if (!socket || socket.destroyed) return;
  try {
    if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'HPE_INVALID_EOF_STATE')) {
      socket.destroy();
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } catch (_) {
    try { socket.destroy(); } catch (__) {}
  }
});

server.on('connection', (socket) => {
  socket.on('error', ignoreSocketError);
  socket.on('timeout', () => { try { socket.destroy(); } catch (_) {} });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('dashboard: 127.0.0.1:' + PORT + ' is already in use');
    process.exit(2);
  }
  console.error('dashboard server error (still serving if listening):', (err && err.message) || err);
});

process.on('uncaughtException', (err) => {
  console.error('dashboard uncaught (kept serving):', (err && err.message) || err);
});
process.on('unhandledRejection', (err) => {
  console.error('dashboard rejection (kept serving):', (err && (err.message || err)) || err);
});

// nohup ignores SIGHUP in the shell. Node installs its own SIGHUP handler and
// would still exit when the terminal closes, so ignore it here too. SIGTERM
// stays at the default so `dashboard-daemon.sh stop` can end this process.
process.on('SIGHUP', () => {});

server.listen(PORT, HOST, () => {
  console.log('dispute desk listening on http://' + HOST + ':' + PORT);
});
