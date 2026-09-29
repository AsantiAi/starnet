# Claude Code provider (`claude-cli`)

StarNet can use the **Claude Code CLI already installed on this computer** (`claude`) as an agent's brain,
with whatever Claude account or API key that CLI is signed in with. No key is stored in StarNet.
Implementation: `sidecar/providers/claude-cli.js` (adapter), a `claude-cli` profile in
`sidecar/providers/registry.js`, one adapter case in `sidecar/providers/factory.js`; the Connect-a-brain tile and
Settings card are labelled **CLAUDE CODE** and are keyless: the CLI's own sign-in is the credential.

## Requirements

- Claude Code installed (a Claude Pro, Max, Team or Enterprise plan — the free claude.ai plan has no Claude Code).
  When it is missing, the tile shows the one-line install command for the OS plus the install guide, and re-checks
  itself every 5 s so installing flips it without a restart.
- Signed in — see **Sign in** below (or an `ANTHROPIC_API_KEY` the CLI can see).
- The sidecar finds `claude` on `PATH`, then `%USERPROFILE%\.local\bin\claude.exe` on Windows. An npm
  `claude.cmd` shim is run as `node <…>/@anthropic-ai/claude-code/cli.js`. Override with `STARNET_CLAUDE_BIN`.

## Sign in (SIGN IN WITH CLAUDE)

StarNet never holds the Claude credential. `sidecar/providers/claude-cli-login.js` runs the user's own
`claude auth login --claudeai` (it works with no terminal attached): the CLI opens the browser, finishes OAuth and
stores the token in its own credential store. Routes: `GET /api/auth/claude-cli/status`,
`POST /api/auth/claude-cli/{start,poll,code,cancel}`.

- The brain-screen tile (app.js) and the Settings → PROVIDERS card (stationui.js, via `ClaudeCliSignIn` in
  codexsignin.js) show: not installed · signed out (⏼ SIGN IN) · signing in (↗ OPEN SIGN-IN PAGE, a paste box for the
  code the fallback page shows — relayed to the CLI's stdin, never logged — and CANCEL, which kills the child) ·
  signed in, **only** once `claude auth status` proves it.
- One login child at a time; killed on cancel, on a 10-minute TTL, on graceful shutdown, and when the credential
  lands while it lingers on its paste prompt. It also dies with the sidecar.
- WAKE on a signed-out pick points at the button instead of running a doomed wire test.

## How a turn runs

Every `stream()` call is **one** `claude -p` child process:

```text
claude -p --output-format stream-json --verbose --include-partial-messages
       --tools "" --strict-mcp-config --mcp-config {"mcpServers":{}}
       --disable-slash-commands --setting-sources "" --no-session-persistence
       --model <sonnet|opus|haiku> [--effort <level>] --system-prompt-file <tmp file>
# env: the station-free child env (child-env.js) + CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
```

- The leading system messages go to a temporary system-prompt file (deleted after the turn); the transcript goes
  on stdin. `text_delta` stream events become `text` events.
- **Every CLI tool is off** (built-ins, MCP connectors, skills, settings, session file). The CLI never acts on
  the machine by itself.
- StarNet's own tools are described in the system prompt. The model asks for one with
  `<tool_call>{"name": …, "arguments": {…}}</tool_call>`; the adapter turns each block into
  `tool_start` / `tool_args` / `tool_done`, so `loop.js` runs it through the normal capability gate and consent
  broker. Results return on the next turn as `<tool_result>` blocks.
- Exactly one `done` is emitted, only after the child exited with a `result` line. A CLI error result, or an
  exit without a result, is thrown as an error (with the CLI's message / stderr tail), never delivered as an
  empty answer.
- A turn with **no** tools (chat) says so in the prompt; otherwise the model improvises its own tool-call markup as
  text. The user's ~/.claude/CLAUDE.md and auto-memory never reach a turn (verified against a control run).
- A lost sign-in (the CLI's `authentication_failed`) is thrown as a 401, so it fails fast as `auth` instead of
  riding the ~105 s retry ladder.
- Images in user messages are replaced by an explicit "image omitted" note: the CLI's text input cannot carry them.

## Stop, timeouts, budget

- **Stop** aborts the run signal; the adapter kills the child's process tree (`taskkill /T /F` on Windows,
  `SIGTERM` elsewhere) and ends the turn as cancelled.
- The shared provider **idle watchdog** (`SKYNET_PROVIDER_IDLE_MS`, default 300 s) kills a child that stays
  silent and reports a `timeout`.
- Per-run budgets and caps apply unchanged: each turn reports its cost (below) to the loop.

## Cost

The CLI's `init` line says how it is authenticated and its `result` line carries real usage:

| CLI sign-in | Booked per turn |
| --- | --- |
| Claude subscription (`apiKeySource: "none"`) | `$0` — nothing is billed per call; real token counts are kept |
| API key | the CLI's own `total_cost_usd` |

The profile is therefore **not** `unmetered`: an API-key sign-in is real spend and stays inside the budgets.

## Models and readiness

`listModels()` runs `claude auth status` (a local check, no model call). Signed in → the CLI's aliases
`sonnet`, `opus`, `haiku` (always the newest model of each family the account can use). Not installed or not
signed in → no models and an error naming the fix, so the tile and Settings row read "not detected / not
signed in" instead of claiming a working brain.
