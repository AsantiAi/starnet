# Final texture additions — 2026-10-02

Owner request: retain the approved shell refresh, add a few matching finishes, and make insulation interior-only.

Implementation: `86ad9d463`; combined with trunk's station-builder improvements in `dfcd8fcc4`. Release surface re-locked in `94c9ad7d7`.

## Delivered materials

- Three new exterior finishes: TRUSS, LOUVER, CERAMIC. Fifteen exterior choices total, including the earlier refreshed artwork.
- INSULATION is selectable under WALLS only. The approved quilted PNG is copied unchanged into the interior wall pack.
- Legacy exterior insulation deserializes as THERMAL. Explicit shell paint, interior material and interior paint are preserved.
- Native fallback recipes remain available for the new surfaces.
- Desktop and website copies match. Prompts and reference provenance: `shell-final-additions-2026-10-02.prompts.txt`.

## Live observations

Seeded app: `node dev/seed.js --keep`, isolated `shell-refresh-1002`, http://127.0.0.1:18802/.

- Entered BUILD > BUILD MODE > Surfaces > SHELL. Observed all 15 choices and no insulation option.
- Applied TRUSS, LOUVER and CERAMIC in turn to the Outpost room at 136% zoom. Screenshots showed diagonal truss braces, recessed chevron louver blades, and pale ceramic plates on the exterior front and clipped corner faces.
- Selected WALLS > INSULATION. The picker automatically suggested AMBER. Applied it to the room; quilted insulation appeared on the interior north/side walls while the ceramic exterior stayed in place.
- SAVE & EXIT displayed “Station layout saved locally”. Restarted the seeded server with `--keep`, reloaded the page, and observed both interior insulation and ceramic exterior still present.
- SESSIONS and the General session were visible after the restart.
- No lighting adjustments were made. The authored exterior shading remains subdued.

## Checks

- `node --check`: all six edited JavaScript source/test files passed; rechecked both worldmodel copies after trunk merge.
- `node test/industrial-shells.test.js`: PASS (shipped versioned URLs, interior-only insulation routing, paint relief, alpha, caches and fallback behavior).
- `node test/stationbake.hull.test.js`: PASS, 358 assertions, including migration, save/load and distinct native shell recipes. Passed again after trunk sync.
- `node test/worldsurface.test.js`: PASS, 822 assertions.
- `node test/industrialtextures.test.js`: PASS, 417 public-contract assertions. Synthetic canvas tests do not assess art quality.
- New shell PNGs exactly match their website mirrors; interior insulation exactly matches the owner-approved artwork.
- First full combined run: stopped at step 288/1030 on an existing voice fixture race (expected one live recorder, got zero). Its compressed 50ms permission timeout could expire during the click/stop/click sequence under load. The unchanged fixture passed standalone; commit `49e23c2b9` keeps the production 12-second permission deadline for this ordering scenario, with all 167 assertions retained and passing. No production voice code changed.
- Full combined retry: failed at step 132/1030 in `test/plugin-windows.test.js`, with Windows process exit `3221226505` (`0xC0000409`), without an assertion report. The same plugin test then passed standalone, 76 assertions. This does not establish a successful full gate.
- The standard 20-minute wrapper timed out twice in the earlier shell pass. These combined runs used the complete canonical `test:fast:raw` manifest under `scripts/timeout.mjs` with a 50-minute process deadline. No filters, skipped assertions or repository timeout changes. Logs: `dev/shell-final-combined-fast.log`, `dev/shell-final-combined-fast-retry.log`.

## Integration complete

Merged into `feat/harness-backend` at **`3ae7f72e18ea390ad894ca6978f956e8a6e0d30d`**, after syncing trunk through `992edef6a`. The merge tree exactly matches the tested candidate `fcaa02afd`.

- Pre-merge **`npm run test:fast`: PASS, 1034/1034**, exit 0. Log: `dev/shell-merge-fast-final.log` in the retained texture worktree.
- Post-merge **`npm run test:fast`: PASS, 1034/1034**, exit 0, run from the integration tree on `3ae7f72e1`. Log: `dev/shell-merge-post-fast.log` in the retained texture worktree.
- Both completed runs used the standard repository command and its unchanged 20-minute deadline. Earlier failed attempts above are historical.
- A reproduced Windows test-server startup timeout was addressed in `e7d2b15d8`: the fixture's default startup allowance is 30 seconds on Windows; explicit failure deadlines, health/token assertions and process cleanup remain tested. Fixture tests passed 10 assertions; schema-stamp tests passed 15; both also passed in the complete gates.
- Live check after trunk synchronization: the saved ceramic exterior, interior insulation and General session were present after restart. SHELL listed 15 choices without insulation; WALLS included insulation.
- The merge introduces no production backend or shared-contract changes. Existing integration-tree edits to `docs/NEXT.md`, `qa/STATUS.md` and the untracked `-result.txt` were preserved.

The seeded preview was restarted on port 18802 after the gates with the saved ceramic exterior and interior insulation. The worktree is retained to serve that preview and preserve the test logs.

This verifies this texture lane only; it is not a station-wide release-readiness claim.
