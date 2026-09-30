/* test/fixtures/stepin-login-site.js — a tiny site with a real login wall, for STEP-IN proofs.

   /account  → redirects to /login unless the `sid` cookie is set; when signed in it says "Signed in as <user>".
   /login    → a form with a user field and a PASSWORD field (the auth-wall probe's signal). POST /login sets the
               cookie and redirects back to /account. Any non-empty password is accepted: this is a fixture, and
               the point of the proof is WHO types it (the Commander, through the STEP-IN window), not what.

   Used two ways:
     · required by test/browser.stepin.e2e.test.js (makeServer)
     · run as a process (`node test/fixtures/stepin-login-site.js [port]`) for the live app proof, where it is the
       agent's own background dev server: it prints the URL it listens on, which is what browser.test_navigate's
       ownership check reads. */
'use strict';
const http = require('node:http');

const PAGE = (title, body) => '<!doctype html><meta charset=utf-8><title>' + title + '</title>'
  + '<style>body{font:16px sans-serif;margin:40px;background:#f4f4f4}form{display:grid;gap:10px;width:280px}'
  + 'input,button{font:16px sans-serif;padding:8px}</style><body>' + body + '</body>';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function makeServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/login') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const user = String(f.get('user') || '').trim(), pass = String(f.get('pass') || '');
        if (!user || !pass) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(PAGE('Sign in', '<h1>Sign in</h1><p id=err>Enter a user and a password.</p>' + FORM));
        }
        res.writeHead(303, { 'Set-Cookie': 'sid=' + encodeURIComponent(user) + '; Path=/; HttpOnly; SameSite=Lax', Location: '/account' });
        res.end();
      });
      return;
    }
    if (url.pathname === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE('Sign in', '<h1>Sign in to Fixture Bank</h1>' + FORM));
    }
    if (url.pathname === '/account' || url.pathname === '/') {
      const sid = cookies(req).sid;
      if (!sid) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE('Your account', '<h1 id=who>Signed in as ' + esc(sid) + '</h1><p id=balance>Balance: 1,337 credits</p>'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}
const FORM = '<form method=post action=/login><input id=user name=user autocomplete=username placeholder=user>'
  + '<input id=pass name=pass type=password autocomplete=current-password placeholder=password>'
  + '<button id=go type=submit>Sign in</button></form>';

if (require.main === module) {
  const port = Number(process.argv[2]) || 0;
  const server = makeServer();
  server.listen(port, '127.0.0.1', () => {
    console.log('stepin fixture listening on http://127.0.0.1:' + server.address().port + '/');
  });
}

module.exports = { makeServer };
