# Group chat repair — 2026-10-04

Branch `agent/group-chat-fix-1004` (worktree `gen-trees\group-chat-fix-1004`), forked from trunk `f245a03cd`. **Not merged.**

## What Andrew reported (on installed v0.13.0)

> group chats dont seem to be working right… cant even tell when the groupchat is there, it does not show all the agents,
> I cant @ the agents… it literally doesnt save when you add one to chat and minimize starnet, when you come back the
> agents are removed from the chat

## What was actually wrong (proven, not guessed)

| Symptom | Root cause | Evidence |
|---|---|---|
| Added agent gone after minimize | **ADD AGENTS only STAGED.** `+ ADD` moved the row under IN THIS CHAT and saved nothing until START GROUP CHAT / SAVE — which, with a real 26-agent crew, sat ~110 px below the docked window's visible edge. Minimize/close = the add was never sent. | Andrew's live `group-sessions.json`: no group created since 09-09. Live repro on a 26-agent station: footer at y=1005–1046 in a body ending at y=898. |
| Can't @ the agents | The @ list only existed inside an already-existing group, and had no keyboard: `@fi` + Enter sent the literal text and failed "Unknown or ambiguous @fi". | Live: `@fi` in a direct chat → no menu; in a group → Tab moved focus to SEND, Enter → error. |
| Can't tell the group is there | A dim one-line names row in the header, no marker on the compact rail row, an empty transcript, and group messages in the OLD COMMS style (the conversation CSS was scoped to `#chat-log`). | Live DOM: rail row = "Group chat 6m"; group rows had no stamps/rails. |
| Doesn't show all the agents | Header names were one ellipsized line; the picker's nested 28vh lists showed ~3 agents at a time with the save key below the fold. | Live layout measurements. |

Also proven: adding agents from **General** converted the General home stream itself into the group.

## What changed

**Frontend (`frontend/app/group-chat.js`, `chat.js`, `app.js`, CSS):**
- `+ ADD` / `✕ REMOVE` save immediately (create on the first add, `invite` after, `configure` with a fresh revision + retry on 409 for a removal). IN THIS CHAT lists only backend-confirmed members. Footer = status + DONE, sticky; the two lists share the window height.
- `@` menu over the composer in **every** chat: ↑↓ move, Enter/Tab pick, Esc closes (it no longer falls through to STOP-ALL), `@all` in a group. Picking someone not in the chat adds them first; a direct chat becomes a group. Typing `@finn …` and sending from a direct chat does the same.
- General is never converted: a fresh group ("NOVA + FINN") opens beside it.
- A group looks like one: `[ GROUP ]` header with every member in their colour (two lines, then `+N`), "Message the group · @ picks one agent", a `GROUP CHAT · names` masthead line, `[GROUP]` on compact rail rows, and the transcript in the COMMS conversation style (stamps, time breaks, gold `>` Commander lines, each agent's rail in its own colour).
- Groups you are not viewing: a 4 s station-wide watch (never while hidden; at once on restore) lights the rail row Working / Reply needed / Approval needed and marks new activity unread.
- The transcript reconciles by key (a selection survives streaming), every message has a copy key, adjacent replies from different agents keep their names, paused work shows CONTINUE, replies a pause stopped show a RETRY line, a blocked queued turn says whose answer it waits for, a reply aimed at the asker answers the waiting question, approval keys are never clipped, a gone group stops polling and can be deleted, and picking an agent for a 1:1 never lands in a group it leads.

**Backend (`sidecar/group-sessions.js`, `sidecar/index.js`):**
- A member deleted from the crew no longer breaks the group (only ADDED ids are validated; @all and the default recipient use members still on the crew; a departed lead hands over); agent delete calls `dropAgent`.
- `@RESEARCHER 2` resolves to RESEARCHER 2 (longest name first; names may hold spaces). A crew agent outside the chat is named; an unknown handle is still refused (never guessed), with copy that says how to send it as text.
- `send({ resume })`: a pause lifts only inside a valid send; work queued before the pause stops instead of replaying ahead of the new message.
- Only the turn a live worker executes waits in 'stopping'; conversion tolerates unreadable/oversized attachments and >100K messages; an upload whose send was refused is not shared; `list()` carries attention fields; E-STOP never throws on a corrupt store.

## How the scope was found

1. Live repro of each symptom on a 26-agent mock station (the four rows above).
2. A read-only sweep of all group-chat code — 4 dimensions × finder + adversarial verifier: **24 confirmed, 0 refuted**
   (deleted crew members breaking groups, `@RESEARCHER 2` misrouting, E-STOP/pause replaying stopped work, groups you
   are not viewing never polled so approvals auto-deny unseen, a corrupt store crashing E-STOP, conversion blocked
   forever by one old >1 MiB attachment, selection wiped every poll, …). All fixed.
3. An adversarial review of this branch's own diff — 4 areas × reviewer + verifier: **17 confirmed**, all fixed
   (a source-lock test window, longest-name resolution across the whole crew, a departed member's question,
   double conversion on double Enter, navigation during a conversion, stale @ menu eating Esc, rail tag cell, …).

## Verification

- Live (mock provider, `.claude/launch.json` → `group-chat-fix-mock`, :8933): every flow above was driven through the real UI (typed keys, real clicks), then reloaded — membership persisted on the backend.
- Tests: `test/group-chat-picker.test.js` (rewritten for save-on-verb, @ menu, General), new `test/group-sessions.repair.test.js` (fast list), plus the existing group/COMMS suites.
- Gates on the lane tip `6b70b2a90`: `npm run test:fast` → `run-fast-tests: OK — 1053 step(s) green`; `npm run test:http` → `run-test-list: OK — 185 step(s) green`; claims planning authority PASS (37 claims · 371 locked surface files).

## Not verified

- On Andrew's real installed app (needs a new build) and on a real Mac.
- A real provider's tool approval / brief.ask inside a group (the mock never calls tools); those paths are covered by unit tests only.
