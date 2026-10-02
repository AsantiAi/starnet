# Shell refresh live review — 2026-10-02

Historical review of the first shell pass. See [the final additions and verification](shell-final-2026-10-02.verification.md) for the current catalog, interior-only insulation and final gate result.

Candidate artwork/source commit: `fc9cad7c7`. Seeded app: `node dev/seed.js --keep` on port 18802, isolated `shell-refresh-1002` workspace.

## Observed in the running app

- Opened BUILD > REFIT STATION > Surfaces > SHELL at 136% zoom in the seeded Outpost (one room, 198 tiles, eight objects).
- Inspected the new station armor on the initial shell. Applied each of the 12 optional finishes by selecting its material and clicking the room: monocoque, timber, clapboard, shingle, brick, stone, stucco, curtain, hedge, thermal, insulation and heatsink. Observed the corresponding artwork on the front face and clipped corners after each station rebake.
- Applied TEAL paint to HEATSINK. The actual shell changed hue while its fins and recesses remained visible.
- SAVE & EXIT showed “Station layout saved locally”. Reloaded the page and observed the teal heatsink shell still in place in the normal station view, with SESSIONS and the General session visible.
- The authored dark lighting remains intact. Wood, plaster and masonry are subdued on the downward-facing shell; the comparison gallery exposes their full source detail. No scene lighting or native shell geometry was changed.
- After syncing the current interface from trunk (`3aa0ae6b7`), reloaded the running app, entered BUILD > BUILD MODE > Surfaces > SHELL, applied the station armor, inspected its front and corners again, and saved it for the local preview.

## Automated checks

- `node test/industrial-shells.test.js`: PASS, including all 13 versioned URLs, shipped assets, paint relief, alpha, cache, optional failure isolation and classic fallback.
- `node test/industrialtextures.test.js`: PASS, 408 public-contract assertions. Synthetic canvas assets do not assess art quality.
- Inspected all 13 PNG files: each is 1254 by 1254, has fully opaque alpha, differs from its original, and exactly matches its website mirror.
- The first partial gate was stopped to sync the newly merged interface before integration.
- Full combined `npm run test:fast` attempt: exited 124 at the mandatory 1,200,000 ms timeout after `shell.fg-ledger.test` passed and while `shell.process-tree.test` was running. No assertion failure was reported. Log: `dev/shell-refresh-combined-fast.log`.
- Full combined retry: exited 124 at the same unchanged timeout after `website-deploy-staging.test` passed and while the website asset mirror check was running. No assertion failure was reported. Log: `dev/shell-refresh-combined-fast-retry.log`.
- The complete gate is **not green**. Per AGENTS.md and starnet-merge-ritual, this branch has **not been merged**. Implemented files and the live local preview remain in `agent/shell-refresh-1002` for review. The full test gate timing out is the remaining integration blocker.

Original output PNGs are retained unchanged. This is an implementation review, not owner acceptance of the art direction.
