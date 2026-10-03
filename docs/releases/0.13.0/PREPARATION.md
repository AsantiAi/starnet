# v0.13.0 — release preparation record

Tag `v0.13.0` = `6a4805361` (release commit `320bfc9ed` + claims re-lock). Cut 2026-10-03 on the owner's go:
push and tag, stage the draft, run the draft proofs, report before Publish (the owner publishes).

## Soak

- **48-hour installed soak: WAIVED by the owner** (2026-10-03: "the soak from last night is good enough"), as for 0.12.4
  and 0.12.5.
- In its place, on trunk the same day: a 2-hour soak (`qa:soak --minutes=120`) PASS on all ten checks (354 runs, 0 failed;
  11 restarts, nothing lost; RSS slope 0.26 MB/min; p95 latency 17 ms; 119 of 119 owed routine fires), and the scale soak
  (50 routines, outage and restarts) PASS with 0 lost and 0 doubled fires.

## Evidence on `6a4805361`

| Proof | Result |
| --- | --- |
| Guardian cycle 20261003-205227 | GREEN: test-fast 1050, http-e2e 185, saboteur, shoot, golden, audit, journeys |
| Beginner Run | PASS, 6 of 6 steps |
| Installed smoke (local installer, sha256 `ab0f30b0…`) | GREEN, 9 of 9, app 0.13.0, build `6a4805361`, clean tree |
| `qa:ready` | READY, 6 of 6 |
| Release preflight (post-bump) | PASS 13, FAIL 0 |
| Draft proofs (T0 clean install, G1 packaged lifecycle) | owed on the staged draft |

## Release notes

`RELEASE_NOTES.md` (108 bullets; the first 520 characters are the Update Center summary and carry the upgrade
warnings). Two independent fact-checks against the code at the candidate found 15 overstatements, all corrected before
the bump commit.

## After the tag

- The trunk secret-history scan flagged five `generic-api-key` matches in tests: the WebSocket RFC 6455 sample handshake
  key, the Web Push RFC 8291 example auth secret and a fake redaction fixture. Reviewed as test vectors, added as exact
  fingerprints to `.gitleaksignore`.
- Owed after Publish: `release:verify-host`, the public updater canary, the website deploy (the Skill Market catalog and
  pages are served from starnetos.com) and the relay deploy if `relay/` changed since its last deploy.
