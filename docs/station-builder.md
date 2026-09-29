# The agent station builder

Added 2026-09-29. The plan is at https://claude.ai/artifact/CcFcnYcEJraKFMEaXHQiYv.

When the Commander asks, the lead agent can change the floor in three ways:
- **add** a ready-made assembly line (by default in a new room)
- **add** a furnished room, or every room of a preset
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
   - a plain summary. A room's summary names the equipment it brings, because a desk is a computer: "It brings
     equipment: a desk (COMPUTE)".
   - each step's instructions
   - the readiness of any new line (`WorkflowLine.readiness`, the Workflow panel's own blocking list)
2. `station.build`: write access, the approval card, and a **taint lock** (step instructions persist and later runs
   obey them). It applies exactly that plan inside one `transact`: one undo slot, all or nothing. It refuses:
   - if the floor changed since the plan
   - if Build mode is open, because the Commander owns the floor then
   - if the result would differ from the plan by a single tile, in which case it rolls itself back

   The approval card shows the plan's own summary and each step's instructions. The sidecar reads them from the memo
   the plan tool filled; it never uses the model's words.

## The menus (the only things the model can say)

`station.plan_line`:

| Field | Accepts |
| --- | --- |
| `line` | One of the Lines shelf's tested lines, by id or plain name (read from `WorldModel.BLUEPRINTS`) |
| `where` | `"new room"` (the default: `worldmodel.roomSpots`, shared with Build mode's MAKE ROOM), or an existing room by name. In an existing room, every machine and belt must fit on clear floor **inside** it. |
| `name` | What to call the line (on its Inbox), up to 48 characters |
| `steps` | `{ step, instructions, agent }` by step number in run order, or `{ role, … }`. `agent` is a crew name or id, or `"lead"`. A step without instructions gets its role's standard ones. |
| `dailyCap` | Dollars per day, or `null` for no cap |
| `tries` | 1 to 5 review passes, on lines with a review loop |

`station.plan_room`:

| Field | Accepts |
| --- | --- |
| `kit` | One of the 12 hand-designed rooms the station presets use (`StationTemplates.kits()`), by name or id. A kit with its own line brings that line, with its instructions and nobody hired. |
| `preset` | Instead of a kit: every room of that preset, added beside the station. Nothing already there changes. This is not the whole-station swap; that stays in Build mode's Presets. |
| `where` | `"new room"` (the default), or an existing plain room of at least 18 × 11 with clear floor, to furnish it. A preset always adds new rooms. |
| `name` | A single new room's name |
| `floorStyle`, `floorMat` | From `WorldModel.FLOOR_STYLES` and `FLOOR_MATERIALS` |

`station.plan_restyle`: `room` (its current name), plus `floorStyle`, `floorMat` or `name`. Nothing is added, moved
or removed.

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
  - restyle: plan, apply, one undo, and refusals
  - a rooms gauntlet of 120 wrong or hostile room and restyle requests
- `test/station-builder.e2e.test.mjs` (HTTP gate): a mock lead plans and then builds through the real sidecar, bridge
  and page in Chromium:
  - a line: the floor, the Workflow panel pill and the Build-mode refusal are checked, and one UNDO removes it
  - a LOUNGE kit holds exactly the kit's furniture
  - a restyle changes the floor and no prop
  - one UNDO each removes the restyle and the room
- Live, in ask mode:
  - the card read "NOVA wants to build this on your station: Build + test ("SHIP IT") in a new room beside HOME: Engineer (NOVA) → Tester (NOVA) → Outbox · daily cap $5 · up to 3 review tries. It will be ready to run. One UNDO in Build mode removes it."
  - Approve once built it
  - Deny built nothing, and the model was told

  In ask mode the lead first settles its Task Brief (`brief_proceed`), because `station.build` is consequential work.

Later phases, in the plan: understanding "does X, Y, Z", recruiting on the card, and custom shapes through the conveyor
layout engine.
