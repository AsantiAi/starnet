---
fingerprint: e47efecf
slug: first-file-write-in-a-fresh-station-can-time-out
title: First file write in a fresh station can time out while the checkpoint runs inside its 10s budget
surface: safecell
severity: P2
status: open
found: 2026-09-30
lane: agent/ollama-fixes
fix:
origin: unknown
---

# First file write in a fresh station can time out while the checkpoint runs inside its 10s budget

## Symptom

The agent's first `fs.write` in a fresh station sometimes returns "tool fs.write timed out after 10000ms. Its effect is UNKNOWN" for a 17-byte file. The file was not written; the agent reads it back, finds nothing, and writes it again, and the run ends with `effectVerdict: unverified_effects` or an extra turn.

## Repro

Intermittent; seen only under machine load (about 1 GB of free RAM, other sessions running).

1. Boot a sidecar on an empty workspace with full access.
2. Send a task whose first mutating tool call is `fs_write` (for example "Create a file named hello.txt in the workspace containing the text: hello").
3. Under load the first write times out at 10 s; every later write in the same station takes well under a second.

A scripted run on the same machine without the load took 635 ms for the first write and 388 ms for the second, so the timeout did not reproduce on demand.

## Evidence

Seen twice on 2026-09-29/30 in live runs against a real Ollama (the model was idle during the tool call, so this is not provider time). The tool result on the wire: `ERROR: tool fs.write timed out after 10000ms. Its effect is UNKNOWN ...`, followed by `fs.read` -> `no such file: hello.txt`. The sidecar log of the second occurrence carries `[checkpoint] rebuilt index for agent from 1 shadow-git commits (index.json was empty/corrupt)`.

Anchors: `sidecar/tools/builtin/fs.js:155` (`checkpointResolvedRoot` awaits `ctx.checkpointMutation` during path resolution, inside the tool's `run`) and `sidecar/tools/builtin/fs.js:293` (`fs.write` declares `timeoutMs: 10000`); the budget is enforced around the whole `run` at `sidecar/tools/registry.js:569`. The first mutation of a station creates the shadow git repository and its first commit, so that one checkpoint is the slow one, and the timeout's abort can land mid-checkpoint (the corrupt `index.json`).

Not proven: that the checkpoint is what consumed the 10 s. No timing of the checkpoint itself was captured.

## Verdict

Open. Not an Ollama defect (any provider's first mutation takes the same path). Decide whether the checkpoint gets its own budget outside the tool's, then add a test that delays `checkpointMutation` past 10 s and asserts the write still lands.
