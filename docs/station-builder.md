# The agent station builder

Added 2026-09-29. The plan is at https://claude.ai/artifact/CcFcnYcEJraKFMEaXHQiYv.

When the Commander asks, the lead agent can change the floor in these ways:
- **design** a room the way the Commander describes it, part by part (vibe design: "a new room, the left side cozy, the
  right side a line that builds and tests code")
- **add** a ready-made assembly line (by default in a new room)
- **add** a furnished room, or every room of a preset
- **swap** the whole station for a preset, backed up like Build mode's Presets
- **restyle** a room's floor or name

The model never places anything itself. It fills a fixed menu, and StarNet does all the placing with the same code
Build mode uses. A weak model's worst case is a change the Commander didn't want, which one UNDO removes. It can't
break the station.

## How it works

1. A plan tool: read-only, no approval.
   - `station.plan_line` (`StationBuilder.plan`)
   - `station.plan_room` (`planRoom`)
   - `station.plan_restyle` (`planRestyle`)

   The page builds the request on a **copy** of the live station and checks it:
   - every new machine and piece of furniture can be walked up to
   - for rooms, no furniture sits on a doorway or the tile just inside it
   - no new routing error appears anywhere
   - every existing dock routes exactly as before

   It returns:
   - a `planId`, which lasts ten minutes and is used once
   - a plain summary. A room's summary names the equipment it brings, because a desk is a computer, and what agents
     gain there in `EquipmentHelp`'s own words: "It brings equipment: a desk (COMPUTE), a rack (FILES). What agents
     gain there: a place to work; read, create and search files."
   - each step's instructions
   - the readiness of any new line (`WorkflowLine.readiness`, the Workflow panel's own blocking list)
2. `station.build`: write access, the approval card, and a **taint lock** (step instructions persist and later runs
   obey them). It applies exactly that plan inside one `transact`: one undo slot, all or nothing. It refuses:
   - if the floor changed since the plan
   - if Build mode is open, because the Commander owns the floor then
   - if the result would differ from the plan by a single tile, in which case it rolls itself back

   The approval card shows the plan's own summary and each step's instructions, including the steps of a kit's or a
   preset's own line. The sidecar reads them from the memo the plan tool filled; it never uses the model's words.
   The card also **draws** the plan (`planpreview.js`, the station preset cards' recipe): the station's rooms dimmed, the
   room the plan adds or changes lit, each zone outlined and numbered, and what will stand there. The page draws it
   from its own parked plan (`StationCommands.previewFor`).
   After a build the camera shows the new room (the whole station after a preset), with the note "Built by NOVA: … ·
   open BUILD and press UNDO to remove it".

   In Full Access the build runs without the card, like every other write tool: the consent broker bypasses every
   prompt in that posture.

## Vibe design: a room described part by part

`station.plan_room` with `zones`: a list of 1 to 4 parts of the room, each `{ area, style }` or
`{ area, line | purpose | shape, name, staff, dailyCap, tries }`.

- `area`: left, right, back, front, back-left, back-right, front-left, front-right, or whole (on a 2 × 2 grid; top is
  the back, bottom the front). Areas may not overlap.
- `style`: one of 14 in `frontend/app/roomstyles.js` (cozy, lounge, library, desks, meeting, cafe, games, garden,
  quarters, storage, gym, lab, comms, workshop), also by name or word ("comfy"). Each is a few hand-arranged sets of the
  presets' own furniture, largest first. StarNet seats the largest set that fits, against the room's outer walls, as
  arranged or mirrored, off every doorway's landing, with every piece reachable. The card lists the pieces really
  placed.
- A line zone holds one line, laid out **inside the zone** by the Workflow panel's own layout engine
  (`LineLayout.layout`, written by `applyLineLayout`):
  - `line`: a shelf line, by id or name
  - `purpose`: the Commander's words; StarNet picks the line, as `station.plan_line` does
  - `shape`: a custom line, built through the panel's own graph edits (`LineEdit.OPS`). Its stages, in order: a role,
    `{ together: [roles] }` (each gets a copy), `{ turns: [roles] }`, `{ sort: { code: role, research: role } }`
    (everything else goes straight on), and `{ review: true, tries }` after a step
  - `staff`: `{ step, agent, instructions }` in run order, with `"new"` to recruit

A new room is sized for what its zones need, from the engine's own measure of each line and the size of each style's
set: at least 18 × 10 for several zones, at most 44 × 26. Anything bigger is refused with "Split it into two rooms".
With `where` naming an existing plain room, that room is split down the middle, and each zone must fit around what
already stands there. Lines go in first, then the furniture. The whole room lands in one undo.

Sets survive either prop catalog. The page's remastered desk is 3 tiles wide, not 2, so a flat decor piece that would
overlap is left out. The catalog's mount rules hold too (`app.js` hands them to the world model): a lava lamp stands on
its side table, and what may stand on a table can. The tests install the same rules the page does.

## The menus (the only things the model can say)

`station.plan_line`:

| Field | Accepts |
| --- | --- |
| `line` | One of the Lines shelf's tested lines, by id or plain name (read from `WorldModel.BLUEPRINTS`) |
| `shape` | Instead of `line`: a line the Commander DESCRIBED, as stages in order (a role, `{ together }`, `{ turns }`, `{ sort }`, `{ review, tries }`: see Vibe design). It is laid out whole by the layout engine in a new room sized for it, or in an existing room (`where`) around what already stands there. `name` is the line's name, `steps` staff it in run order. |
| `purpose` | The Commander's own words for what the line is for. With no `line`, StarNet picks one with `WorkflowLine.suggestLineFor`, the reader behind FOR YOUR GOAL (the shape of the work: research then writing, a draft and a reviewer, code with tests or a review, two takes), and the card says why. Words with no such shape are refused with the menu. Every step's standard instructions end with `This line is for: "…"`. |
| `where` | `"new room"` (the default: `worldmodel.roomSpots`, shared with Build mode's MAKE ROOM), or an existing room by name. In an existing room, every machine and belt must fit on clear floor **inside** it. |
| `name` | What to call the line (on its Inbox), up to 48 characters |
| `steps` | `{ step, instructions, agent }` by step number in run order, or `{ role, … }`. `agent` is a crew name or id, `"lead"`, or `"new"` to recruit that role's specialist. A step without instructions gets its role's standard ones. |

**Recruiting** (`agent: "new"`): the card lists it ("It adds 1 crew member: TESTER, with a desk in HOME"). The build
recruits through `Build.summonForRole`, the setup guide's own RECRUIT, after the floor matched its plan and inside the
same undo step. UNDO takes back the recruit's desk and seat but not the agent (DELETE AGENT in its Dossier does), and the
card says so. If a recruit fails, nothing is built, and the refusal names any agent already recruited.
| `dailyCap` | Dollars per day, or `null` for no cap |
| `tries` | 1 to 5 review passes, on lines with a review loop |

`station.plan_room`:

| Field | Accepts |
| --- | --- |
| `kit` | One of the 12 hand-designed rooms the station presets use (`StationTemplates.kits()`), by name or id. A kit with its own line brings that line, with its instructions and nobody hired. |
| `preset` | Instead of a kit: every room of that preset, added beside the station. Nothing already there changes. |
| `replace` | `true` with a preset: swap the whole station for it, exactly as Build mode's Presets does (`StationTemplates.build` → `replaceLayout`, every agent keeps a desk). The page first backs the current layout up to Build mode's own slot, so RESTORE PREVIOUS in Build → Presets brings it back; if the backup fails, nothing changes. |
| `where` | `"new room"` (the default), or an existing plain room of at least 18 × 11 with clear floor, to furnish it. A preset always adds new rooms. |
| `name` | A single new room's name |
| `type` | A room type's floor, as in Build mode's TYPE palette (HAB, BRIDGE, LAB, FOUNDRY, QUARTERS, STORAGE): its floor style and material |
| `floorStyle`, `floorMat` | From `WorldModel.FLOOR_STYLES` and `FLOOR_MATERIALS`; they win over a `type` |

`station.plan_restyle`: `room` (its current name), plus `type`, `floorStyle`, `floorMat` or `name`. Nothing is added,
moved or removed.

Anything else is refused with the valid choices. For example, `x` gets: "StarNet chooses every position, belt and piece
of furniture itself, so these fields are not accepted: x".

## Proof

- `test/station-builder.test.js` (fast gate):
  - all 20 lines plan and build in a new room, and one undo restores the station exactly
  - add-only on a station with a working line
  - existing-room placement
  - steps, settings and refusals
  - stale and tampered plans
  - **the bad-model gauntlet**: 400 seeded wrong or hostile line requests, and after every one the station is unchanged, or built with nothing existing moved and one undo restoring it
  - all 12 kits in a new room, each holding exactly its furniture, with doorways clear and one undo
  - every preset's rooms beside a busy station, with the existing line routing as before
  - furnishing an existing room, and refusing one with no clear floor
  - restyle: plan, apply, one undo, and refusals, with room types
  - every preset (all 7) as a whole-station swap on a busy station: exactly the preset's rooms, every agent keeps a place, one undo restores the old station exactly
  - a rooms gauntlet of 120 wrong or hostile room and restyle requests
  - purposes that pick each line shape, a vague one refused, a named line winning over a purpose
  - recruiting: listed on the card, nobody summoned while planning, seated by the build, one undo for the floor, and a failed recruit building nothing
  - vibe design, under both prop catalogs: every style in a half of a new room beside a working line (reachable, one undo, nothing existing moved); line zones of a shelf line, a purpose and every custom stage kind, each machine inside its zone and nothing but staffing missing; four corners; a whole-room style; an existing room split; the card's drawing; recruiting in a zone; 30 refusals; and a vibe gauntlet of 90 hostile zone requests
- `test/station-builder.e2e.test.mjs` (HTTP gate): a mock lead plans and then builds through the real sidecar, bridge
  and page in Chromium:
  - a line: the floor, the Workflow panel pill and the Build-mode refusal are checked, and one UNDO removes it
  - a LOUNGE kit holds exactly the kit's furniture
  - a restyle changes the floor and no prop
  - one UNDO each removes the restyle and the room
  - a swap to RESEARCH STATION backs the old layout up, and Build mode's RESTORE PREVIOUS brings it back
  - "fix bugs in my repo and test them" picks Build + test, and `"new"` recruits a real Tester through the page, seated and ready
  - a described line ("research it, then a writer and an analyst at once, then a reviewer") lands as four steps with a split and a join, in its own room, in one undo
  - vibe design: "the left side cozy, the right side a line that builds and tests code" lands with every piece of furniture left of every machine, the lamp on its table, in one undo
- Live, in ask mode, the design card read "DEN, a new 30 × 10 room beside HOME: the left half, a cozy corner (a bookshelf, a tall plant, a rug, a beanbag, a couch, a side table, a plant and a lava lamp); the right half, Build + test …". It drew the room with its two zones numbered, nothing was built while it waited, and Approve once built it.
- Live, in ask mode:
  - the card read "NOVA wants to build this on your station: Build + test ("SHIP IT") in a new room beside HOME: Engineer (NOVA) → Tester (NOVA) → Outbox · daily cap $5 · up to 3 review tries. It will be ready to run. One UNDO in Build mode removes it." (it now ends "takes it back", which also fits a swap or a restyle)
  - Approve once built it
  - Deny built nothing, and the model was told

  In ask mode the lead first settles its Task Brief (`brief_proceed`), because `station.build` is consequential work.

Custom shapes (the plan's phase 4) are built as line zones. The card draws the plan rather than overlaying the live floor.
