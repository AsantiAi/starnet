#!/usr/bin/env node
/* scripts/dashboard-server.js — local StarNet dashboard listener.
   Binds ONLY 127.0.0.1:8765. Started by scripts/dashboard-daemon.sh.

   A sleeping browser tab, a dropped keep-alive socket, or a client that
   resets the connection must close that socket and nothing else. This
   process stays up. It does not read case files or the p165 pipeline.

   Timeouts (idle socket, not process death):
     server.timeout        0       legacy socket inactivity timer off
     server.requestTimeout 0       a paused client does not abort the process
     server.headersTimeout 65000   unfinished headers get a 408, then that socket closes
     server.keepAliveTimeout 120000  idle keep-alive sockets close after 2 minutes
*/
'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8765;

const BODY = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>StarNet dashboard</title></head>'
  + '<body><p>StarNet local dashboard is up on 127.0.0.1:8765.</p></body></html>\n';

function ignoreSocketError() { /* ECONNRESET / EPIPE from a sleeping or closed tab */ }

const server = http.createServer((req, res) => {
  req.on('error', ignoreSocketError);
  res.on('error', ignoreSocketError);
  req.on('aborted', ignoreSocketError);
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD', 'Connection': 'close' });
    res.end('method not allowed\n');
    return;
  }
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(BODY),
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-StarNet-Dashboard': 'local'
  };
  res.writeHead(200, headers);
  if (method === 'HEAD') res.end();
  else res.end(BODY);
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

// Last resort: a socket error from an idle tab must not be fatal.
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
  console.log('dashboard listening on http://' + HOST + ':' + PORT);
});
