# StarNet v0.13.1

A repair update: web requests work again, group chats save and show who is in them, COMMS reads like a conversation, crew no longer freeze in the halls, each floor OUTBOX shows only its own line's work, and schedules let you pick who they run as.

## Fixed

### Web requests

- **web_request and web_fetch work again.** Since 0.12.5, every web request an agent made could fail with "fetch failed", even for sites like google.com. Requests now connect normally, and on networks without IPv6 they fall back to IPv4.
- **Clearer network errors.** When a request fails to connect, the error now includes the reason code (such as ECONNREFUSED) and, when known, the host or address, instead of a bare "fetch failed".

### Group chats

- TODO: group chat fixes (pending merge of the group chat repair).

### COMMS readability

- **Reads like a conversation.** Messages show a 12-hour time, and a [ TODAY · 3:42 PM ] divider marks the first message, a new day, or a gap of 30 minutes or more.
- **Your turn stands out.** Your message is a gold > prompt line on its own rail, and the agent's reply mirrors it: name and time above, the text on a phosphor rail over a light dither.
- **No more boxes.** Station lines are ruled terminal tags, code is lit without outlines, choices are [ BRACKETED ] keys, and a reply split across rows reads as one block under one name.
- **The run summary stays under its reply.** On fast runs it used to land between your question and the answer.
- **Smaller rating.** The rating prompt for a finished task is one slim row with two thumbs under its run, not a large centered card.
- **Steadier hover.** Hovering a message no longer makes it glow; its time brightens and the copy key appears.

### Crew movement

- **Crew no longer freeze in the halls.** Two or three crew whose paths crossed could each wait for the other forever and stand still for minutes. They now never wait on someone who is waiting on them.
- **A backstop for stuck crew.** A crew member trying to walk somewhere who has not moved for 12 seconds drops that path: crew at work re-route to their desk and idle crew pick something new. Seated crew, conversations, gatherings and crew waiting on your approval are left alone.

### Floor OUTBOX & deliverables

- **Each OUTBOX is its own line's.** Clicking a floor OUTBOX opens the workflow that ships into it, with its newest result and last jobs, instead of every deliverable on the station. An OUTBOX on no line says so.
- **Per-line counts.** Each OUTBOX's SHIPPED pallet, crate stack and hover count only its own line's work. Routines, chats and away runs wait in DELIVERABLES › TO REVIEW, never on a chute.
- **Workflow jobs are filed in DELIVERABLES too.** Every finished workflow job also gets its own row in DELIVERABLES (under the workflow filter) with what you asked, what the line delivered and the files its steps wrote, with OPEN IN WORKFLOWS. It stays after you collect the crate. A job where no step ran is not listed.

### Schedules & recipes

- **RUN AS.** Choose which crew member a schedule runs as when you make a routine from a recipe, and change it later from the routine's edit form. Before, it always used the active workstream's agent (usually the Overseer), and the only way to move it was asking in COMMS.
- **EDIT and DELETE are easy to find.** On your own recipe, ✐ EDIT and ⌫ DELETE sit in the recipe's header. An edit saves in place, and from its next save on, the recipe shows when it was last saved.
- **Same-name guard.** Saving a recipe with a name that already exists warns you first; save again to keep both. An imported recipe whose name is taken lands as "Name (2)" and says so.
- **An honest send warning.** Scheduling a recipe whose directive looks like it may send or write now says plainly that unattended sends are refused by default, so it can only draft, but that it really sends if the agent has Full Access or you grant the routine connected tools. FULL BYPASS also lets it send.

### Spending, providers & delegation

- **Spending limits hold during retries.** A run now checks its per-run limit and the station's spending caps before every retry and recovery attempt, not only between turns, so retrying can no longer carry a run past a limit.
- **Quest refresh respects spending caps.** Refreshing quests by hand is skipped, with the reason, when a spending cap has been reached.
- **OpenRouter key check is real.** Checking OpenRouter now tests your current key against OpenRouter itself; before, a reachable model list alone could report it as working.
- **Delegated work can be verified.** A lead asked to confirm work it dispatched can now look the run up, instead of concluding the worker never ran. The worker's Dossier RECORD tab shows that run up front as "delegated by" its lead.

## Known issues

- **Images on Claude Code.** Agents running on Claude Code cannot see images; image analysis says so and suggests another way.
