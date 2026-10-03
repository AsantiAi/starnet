'use strict';
/* Test/dev-only preload (NODE_OPTIONS=--require=…): routes the Gmail app-password connector's TLS connections for
   imap.gmail.com / smtp.gmail.com to FAKE local servers (test/helpers/fake-gmail.js) on plain TCP, so the real
   sidecar can be exercised end to end without a Google account or the network. Never loaded by product code.
   Ports come from STARNET_TEST_FAKE_IMAP_PORT / STARNET_TEST_FAKE_SMTP_PORT; any other host is untouched. */
const tls = require('node:tls');
const net = require('node:net');
const realConnect = tls.connect;
const ports = {
  'imap.gmail.com': Number(process.env.STARNET_TEST_FAKE_IMAP_PORT) || 0,
  'smtp.gmail.com': Number(process.env.STARNET_TEST_FAKE_SMTP_PORT) || 0
};
tls.connect = function (options) {
  const host = options && typeof options === 'object' ? options.host : null;
  if (host && ports[host]) return net.connect({ host: '127.0.0.1', port: ports[host] });
  return realConnect.apply(this, arguments);
};
