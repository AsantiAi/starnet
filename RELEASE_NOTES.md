# StarNet v0.13.0

A simpler dock, a new glass look, apps your crew builds, StarNet Remote for your phone, Claude Code as a provider, and a lead that builds rooms and changes settings from chat. Heads-up: stations that never set autonomy now start at SUGGEST, routines stop after 90 minutes, a StarNet-credits run stops at $2 unless you set a per-run limit, old notifications are cleared, and going back to 0.12.5 drops made props and plugin terminals. See Heads-up below.

## Highlights

- **One dock, fewer doors.** The dock keeps its four menus (CREW, WORK, BUILD and SYSTEM), and MY WORK, AUTOMATE and CONNECT each open one window with tabs in place of six separate dock buttons. A new station's dock adds buttons the first time you need them.
- **A new glass look.** Frosted glass panels, CREW as agent cards, COMMS replies laid out like reports, and session rows that lead with the agent's name in its own colour.
- **APPS.** Describe an app (a dashboard, a tracker, a tool, a game) and your crew builds it in its own window. It can update itself on a schedule, and you change it by describing the change.
- **Your lead runs the station from chat.** Ask for a setting change, a new room, a whole station layout or a workflow line, and the lead does it through the same paths your buttons use, asking your approval first unless the agent has Full Access.
- **Workflows you can just use.** WORK › AUTOMATE › WORKFLOWS lists every line with one key to send it a job. SET IT UP FOR ME builds a line from a description, and NEEDS CHANGES turns what you did not like into suggested fixes.
- **Build Mode upgrades.** Box-select many things, move or duplicate them as one edit with one undo, drag to lay a row of furniture, resize or furnish a room by clicking it, and make your own props on StarNet credits.
- **StarNet Remote.** Pair a phone by QR code to chat with your crew, answer approvals and get notified when an agent needs you or finishes a task you sent.
- **Claude Code as a provider.** Agents can run on your own Claude subscription through your installed Claude Code. ChatGPT, Grok, Kimi and Claude Code can each hold several sign-ins and move to the next one when an account hits its usage limit.
- **One shared browser.** You and your COMMS agents use the same station browser, by default a real Chrome window with its own profile. STEP-IN hands you an agent's browser when it needs you to sign in.
- **Feedback that sticks.** Every thumbs up or down and every correction is saved, and your most recent ones shape every agent's later runs.

## New

### Dock, windows & look

- **ONE MENU dock.** CREW holds AGENTS, RECRUIT and YOU. WORK holds MY WORK, AUTOMATE and QUESTS. BUILD holds BUILD MODE, CONNECT and NEW APP. SYSTEM holds FIELD MANUAL, SETTINGS, UPDATES and NOTIFICATIONS. An APPS menu appears once you have an app.
- **Tabbed windows.** MY WORK is TASKS · DELIVERABLES · RECIPES. AUTOMATE is WORKFLOWS · SCHEDULES · GOAL LOOPS · AWAY WORK. CONNECT is ABILITIES · CHANNELS. Tabs swap in place, and a tab click never throws away text you have not saved. The OUTBOX is now DELIVERABLES › TO REVIEW, shown only when something waits for your verdict.
- **A dock that grows with you.** A brand-new station starts with the buttons a newcomer needs; the others come online the first time they matter, with a NEW SYSTEM ONLINE notice. Nothing is locked: SHOW EVERYTHING (in SETTINGS › LOOK & SOUND and QUESTS › Progress) puts every system in the dock, and a station that was already set up opens with everything shown.
- **Glass everywhere.** CREW, COMMS and every window share one frosted-glass style with matching keys, lit rows and one drawn icon set. CREW shows each agent as a card with its status lamp, and the station view carries only the CINEMA key, with the link state in the top bar's UPLINK.
- **Station art.** The station's hull and wall materials are redrawn, with three new hull finishes, and 44 crew skins get steadier walk cycles in which heads, arms and held items hold still from frame to frame.

### COMMS & sessions

- **Per-agent threads.** Clicking a CREW row narrows the session list to that agent's sessions. A group chat lists under every member as soon as they join.
- **Inbox rows.** Each session row leads with the agent's name in its own colour beside the time, with the session title under it and the square session lamp (read, unread, working, reply, approval, failure).
- **Reports-style replies.** Headings read as section labels, bold stands out, code blocks wrap in their own well, and tables are easier to read. Rating a reply is two thumbs on one row, and REMEMBERED starts collapsed.
- **12-hour clock.** Message times read on a 12-hour clock, with the date on older messages.
- **Quieter header.** The COMMS header no longer repeats the transcript's working spinner and timer; it shows only faults, such as a station it cannot reach. Two icons sit there instead: + adds agents and the globe opens the BROWSER (plus the HUD key in the desktop app).
- **A "yes" runs the work.** Answering "yes" or "do it" to an agent's offer runs it as a task with tools, in COMMS and on Telegram and Discord. Every run also knows today's date.

### Apps

- **NEW APP.** Give an app a name and say what it should do; the lead builds the page, fills it with real content and opens it in its own glass window. Asking for an app in plain COMMS works too.
- **AUTO-UPDATE.** Each app can refresh itself every 15 minutes, hourly, every 6 hours, daily or weekly (or never), following what you wrote, and an update may redesign the page itself. A refresh keeps running if you close the window.
- **Change it by describing it.** The bar under every app takes a described change, refreshes now, and says when the app last updated and when it runs next.
- Apps are only for things inside StarNet. A site to host, a React project, a script or a browser extension is built as real files instead.

### Your lead, from chat

- **Change any setting from chat.** The lead can change about forty things that used to need a click: an agent's model, personality, name, skin, approval or reach; renaming, pinning, archiving or deleting sessions; the look; memory; backup models; spending caps; routines on or off; connectors, abilities and skills; trusted folders; and more. Each change uses its button's own path and is reported done only once the station has actually changed.
- **Bigger changes ask separately.** Anything that widens what agents may do or spend (Full Power, Full Access for an agent, spending caps, the autonomy dial, standing approvals, trusted folders, plugin approval) gets its own approval card every time unless the agent already has Full Access, is never covered by an earlier "always", and never runs unattended. A run that has read untrusted content asks again even under Full Access. The lead never enters a credential, answers an approval or lifts E-STOP.
- **Station builder.** The lead can see the floor and build where you ask: furnished preset rooms, rooms described part by part ("the left side cozy, the right side a line that builds and tests code"), restyling, refurnishing, clearing and removing rooms, and hallways. It can make a missing prop on StarNet credits, with the object and price on the approval card. The card draws the plan before anything is built, and each build is one undo.
- **Whole-station layouts.** The lead can lay out the whole station as a diamond (every room on an even grid round the bridge, keeping its shape as rooms are added) or a concourse, every room furnished in a style. "No, undo that" takes back its last build.
- **Lines from chat.** The lead can build a line you describe, set up its steps, budget and routing, set what starts it (a schedule, a folder or a webhook), send it one test job with your approval, read the result and fix the line.

### Workflows & lines

- **WORKFLOWS window.** Every workflow is listed with who works it, an honest status and one key: SEND A JOB or FINISH SETUP. NEW WORKFLOW places a starter line or one SET IT UP FOR ME builds from your description, and one agent can do every step.
- **Results you can steer.** A job shows the step working on it, then the whole result. NEEDS CHANGES suggests exact step changes to use or put back, KEEP THIS STYLE makes the line match a result you liked, and SEND IT AGAIN runs the job beside the last result. Jobs are kept across restarts.
- **Workflow panel.** The panel shows the line as a diagram of its real machines. The + adds a step, a branch or a sorter; a step's card can move it, add a reviewer, rename it or remove it, each as one undo. The INBOX card opens on SEND IT A JOB, shows live progress ("Now: step 1 of 2") and returns the whole result plus each step's own reply, and a test job has its own STOP key.
- **Lines that fit.** A ready-made line that does not fit where you click is laid out nearby, routed exactly as drawn, and work presets come ready to run with a setup guide. Joining two machines with the BELT tool makes the connection, a moved machine re-lays its belts, and a loose belt routes nothing and says so.

### Routines & automation

- **Plain-English schedules.** "every day at 7am", "weekdays at 8:30am", "the 15th of every month at noon" and "every 2 hours between 9am and 5pm on weekdays" are understood. A schedule StarNet cannot read exactly is refused with examples, never saved as a different one.
- **Routines deliver.** A routine's final reply is what you receive, and results come back to the chat the routine was made in. Its approval card says in plain words what it will do each run, and a routine you create is armed right away.
- **Run history.** Every routine has a HISTORY key listing its past runs: status, when, duration, spend and tool calls.
- **Repeat sense.** When you ask for the same kind of work a third time, the lead offers to make it a routine, with a suggested schedule.

### Build Mode & station

- **Many at once.** Drag across empty floor to select everything in a box (Shift adds), Shift+click to add or drop one, or select the whole floor. Move, duplicate or delete the group as one edit with one undo; a refused move names what is in the way.
- **Drag to lay a row.** With furniture armed, a drag lays copies from where you pressed to where you let go, as one undo.
- **Rooms are easy.** Click a room to select it, then drag its edge handles to resize it or use MOVE, FLOOR, FURNISH, CLEAR or DELETE. FURNISH lays out a whole furnished room in one click.
- **Build Mode has feel.** REFIT is now called BUILD MODE. Placed things drop in and settle with a soft sound, deleted things dissolve, the tabs open on their tools, and the selection card shows the object's art and every action.
- **MAKE A PROP.** Type any object; a preview is shown before you pay, and the prop is drawn on StarNet credits and joins the catalog as MADE BY YOU. Made props can be turned (MAKE SIDE VIEW; symmetric ones turn for free), resized from 50% to 300% for free, and deleted.
- **Desk screens.** Click an agent's desk to open its screen: the file it is writing, the command and its output, the page it is reading, with a mid-run note, STOP and a way to its chat.

### StarNet Remote (phone)

- **Pair a phone.** SETTINGS › REMOTE switches Remote on and shows a one-time QR code for 10 minutes. On iPhone, the pairing link walks you through adding StarNet Remote to the Home Screen. Station and phone both connect out to StarNet's relay, which passes their sealed messages without holding the keys.
- **Your station in your pocket.** The phone shows your station with the crew as their real sprites, your sessions shared with the desk, an ACTIVITY feed, and approvals and questions in plain words.
- **Notifications.** The station can notify your phone when an agent needs your OK, has a question, or finishes a task you sent, even with the app closed.
- **The desk's permissions.** A phone works with the same permissions as the desk. Tick ALWAYS ASK on a phone's card to have it ask before every step that needs an OK. Removing a phone stops the tasks it started.

### Models, providers & accounts

- **Claude Code.** SIGN IN WITH CLAUDE on the CLAUDE CODE card lets agents run on your Claude subscription (Pro, Max, Team or Enterprise) through your installed Claude Code. StarNet never holds the credential, and Claude Code's own tools, settings and memory are switched off for these runs. Subscription turns record $0 with real token counts. Thanks to @bobclawexe for the original idea and adapter (#41).
- **Several accounts.** The ChatGPT, Grok, Kimi and Claude Code cards list every connected sign-in with ＋ ADD ACCOUNT, SIGN IN and REMOVE. A run whose account hits its usage limit moves to the next one and says which.
- **ChatGPT-plan images.** With a ChatGPT sign-in, STUDIO can generate images on your plan without an API key.
- **Ollama with full context (#20).** Ollama chats now use Ollama's own chat API with a context window sized to the request, so long requests are no longer silently cut short and agents on Ollama can use their tools. New Ollama users are pointed to a model that works with StarNet's tools.
- **StarNet credits.** A run on StarNet credits reserves $2 by default instead of your whole balance, and the Budget panel says so (#53).

### Browser

- **One station browser.** You and your COMMS agents share one browser. By default it is a real Chrome window on your installed Chrome, Edge or Chromium, shown live in the BROWSER window, and it keeps the sign-ins you make in it; SETTINGS › BROWSER can switch it to built-in. Agent-made web pages open running in the BROWSER window, which has a door in COMMS and a typeable address bar.
- **Always yours too.** Your clicks and keys are never refused while an agent browses, and a minimized Chrome window stays live in the BROWSER window.
- **STEP-IN.** When an agent hits a sign-in, it pauses and hands you its live browser; TAKE THE WHEEL, then HAND BACK. Sites you signed in to are listed under SAVED SIGN-INS with FORGET.
- **No browser? No problem.** A computer with no Chrome, Edge or Chromium downloads Google's Chrome for Testing for the station.

### Connectors, skills & plugins

- **Gmail with an app password.** A new Gmail (app password) card connects Gmail over IMAP and SMTP with your address and a Google app password, without Google sign-in. Agents can search, list, read, send and draft email. It needs 2-Step Verification, and Workspace admins can turn app passwords off. Its results are not sent to StarNet Managed models.
- **Skill Market.** CONNECT › ABILITIES › DISCOVER lists a curated, signed catalog of over 100 skills, StarNet Originals and credited community picks, installed for the whole crew in one click. A skill StarNet withdraws is shown as pulled, and a public Skill Market page is on starnetos.com. Skills you or your agents wrote export as a standard Agent Skills package.
- **Plugin windows and backends.** A plugin can open its own windows in the station, run its code in its own process, and give the crew tools through a PLUGIN TERMINAL placed in a room. A plugin that fails cannot take the station down with it.
- **The crew builds plugins.** Agents can draft a plugin and preview it in a DRAFT window; a submitted plugin installs turned off until you approve it.

### HUD mode, memory & first run

- **HUD mode.** The HUD key in COMMS (desktop app), Ctrl+Shift+H or the tray's HUD Mode item folds StarNet into a small always-on-top panel showing your working agents at their desks, their run clocks and COMMS. Drag it bigger and the station view grows with it; leaving restores the window and camera exactly as they were.
- **Your ratings steer later runs.** Every thumbs up or down, every correction and NEEDS CHANGES feedback on a workflow result is saved as a confirmed preference, and your most recent ones reach every agent's later runs, including helpers they start. A finished run you rated as missed counts as a failure in the agent's track record.
- **Agents learn skills.** Agents turn your ratings and their failed runs into new skills, even across a restart, and what the station learned while you were away is offered for you to keep when you return.
- **A new station suggests.** A new station starts at SUGGEST: it lines up suggestions and quests for you to approve and never acts on its own (see Heads-up).
- **A first path.** The awakening ends by offering a station that fits the purpose you gave and a confirmed first path toward your mission, and START QUEST starts an agent quest's work in its own session.

## Improved

### Runs, stop and spend

- **STOP and STEER reach every run.** Routine runs, line steps, line triggers, step tests and phone tasks can be stopped and steered from the desk screen and the HUD.
- **E-STOP reaches more.** It stops phone tasks, NEEDS CHANGES and SET IT UP FOR ME calls, and plugin tools already running, and pauses plugin background jobs.
- Stopping one step of a running line stops the whole line instead of handing half-written text to the next step, and a line's spending limit now applies inside each step, not only between steps.
- Image analysis fallback, made-prop charges and skill reviews count toward spend and your limits, and a run stopped by its spending cap spends nothing more as it ends.
- A routine that hits a temporary failure retries after growing waits (90 seconds, then 4.5 and 13.5 minutes) instead of 90 seconds each time.

### COMMS, notifications & settings

- **Notifications that mean something.** The bell keeps who is waiting on you, what finished while you were elsewhere and what stopped. Every entry opens where it happened, repeats fold into one, and confirmations stay as toasts.
- A waiting entry settles wherever you answer it (desk, phone, Telegram or voice), and following a notification into a session shows a ‹ BACK TO NOTIFICATIONS key.
- Links in replies are clickable inside bold or code, while a reply is still streaming, and in group chats and file previews in the desktop app. A link whose text names a different site shows where it really goes.
- SETTINGS › PROVIDERS is now SETTINGS › AI & MODELS. On macOS, StarNet also finds Claude Code installed with Homebrew or npm.
- A failed account sign-in keeps its reason with a DISMISS key, and a signed-out main account no longer blocks runs on another one.

## Fixed

- **Routines on Follow station default** now run on the station default instead of being refused.
- **Stale token after an engine restart (#39).** An open page recovers its access token instead of failing every call.
- **Configuring lines from chat (helps #28).** The lead can now set up and change lines. A step's card also says its instructions are added to the agent's own purpose.
- **One-site routines keep web requests (#58).** A task about one site (such as checking orders on a shop) keeps web requests to that site and its API.
- **Routine files (#60).** A routine's file writes land in its project folder, where its commands look, and each file it writes or adds to names its full location.
- A line's last step is told its reply is the finished result, so it no longer writes an essay about the earlier steps.
- Deleting a group chat removes its conversation and files, and OPEN on a project session's file opens the project's copy instead of an older file with the same name.
- In Build Mode, moving or deleting a room in a way that would leave a hallway leading nowhere is refused, and nothing changes.
- The remembered count in COMMS counts only what is still remembered, and says how many were forgotten.

## Security

### Remote and phones

- The relay limits frame and message sizes and connections per address, and a phone can read only its agent's workspace or files the station showed it.
- A phone task's approvals and session grants end with the task, revoking a phone stops its runs, and approval text shown on a lock screen is redacted first.
- Phone push goes only to real browser push services and never follows a redirect.

### Agents, approvals and standing work

- Setting changes that widen access or spending never ride a standing approval, and a run that has read untrusted content must ask again before making one.
- Runs started by non-owner chat-channel senders, and the helpers they start, cannot create, edit, resume or start routines, loops or line triggers; pausing and stopping stay allowed.
- A helper resumed by the lead keeps the restrictions it started under, and a line test job's untrusted-content mark travels back to the lead.
- An app that rewrites a granted routine's task loses its unattended grants.
- The Skill Market's folder can never become an agent's workspace.

### Your preferences

- Only your own confirmed words count as your preferences; an agent's notes are never injected as your verdict.
- Chat-channel guests, group chats and helpers started from them never receive your preferences.

### Content and tools

- Apps run in a sandbox with no network; a frame that leaves its page is replaced, and links open in your browser. Plugins built by the crew stay off until you approve them, and an approved plugin runs with your computer's permissions, as its approval card says.
- The Skill Market is signed, ships text only, refuses tampered downloads, and its guard refuses download-and-run instructions.
- On Claude Code runs, a tool call shown inside a code block is treated as text and never run, and your personal Claude Code instructions never reach a turn.
- The browser downloader gets no StarNet keys, an agent cannot read the page while you sign in through STEP-IN, and only you at COMMS can drive the shared signed-in browser.
- A crafted HTML email cannot freeze StarNet while it is read, and broken tool-call text that holds a credential is never quoted back.
- Forwarded chat-channel text is never read as one of your custom commands, and project file links serve only files inside a trusted project.

## Heads-up: changes when you update

- **Autonomy starts at SUGGEST.** A station whose autonomy was never set now starts at SUGGEST instead of WAIT: it plans suggestions and quests for you to approve in the background (these use model calls) but never acts on its own. To go back, choose WAIT under SETTINGS › AUTONOMY › INITIATIVE.
- **Routines stop after 90 minutes.** A routine run still going after 90 minutes is stopped and recorded as a failure, which counts toward pausing that routine.
- **StarNet credits stop at $2 a run.** With no per-run limit set, a run on StarNet credits stops after $2. Set PER RUN under SETTINGS › SPENDING LIMITS to change it.
- **Older notifications.** Notifications from before 0.13 are cleared the first time you open the bell.
- **Where things moved.** Six dock buttons are now tabs inside MY WORK, AUTOMATE and CONNECT. The OUTBOX is DELIVERABLES › TO REVIEW, SETTINGS › PROVIDERS is AI & MODELS, Night Shift is AUTONOMY (and AWAY WORK under AUTOMATE), REFIT is BUILD MODE, and SETTINGS › APPEARANCE is LOOK & SOUND, which now also holds Live Voice.
- **Rolling back to 0.12.5.** Once 0.12.5 saves the station, made props and plugin terminals are removed from the floor, and agents set to Claude Code switch to OpenRouter.

## Known issues

- **Images on Claude Code.** Agents running on Claude Code cannot see images; image analysis says so and suggests another way.
