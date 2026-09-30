# StarNet Remote relay

The switchboard between a phone and a home StarNet station. Both dial out to it over TLS; it forwards sealed
frames between them. It holds no keys and cannot read anything that passes through (the channel is sealed end
to end by `sidecar/remote/crypto.js` on the station and `relay/app/phone-client.js` on the phone).

- `server.js` — the relay (station sign-in by key signature, phone admission by relay pass, routing, limits)
- `ws-lite.js` — a small dependency-free WebSocket server
- It also serves the phone app (`relay/app/`) over HTTPS, since phone browsers only allow WebCrypto
  on secure pages.

Run locally: `node relay/server.js` (port 8799, or `PORT=`). Point a station at it with
`STARNET_REMOTE_RELAY=http://localhost:8799`. `http://localhost` counts as a secure page in desktop browsers,
so the phone app works there for testing.
