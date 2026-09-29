# The agent station builder

Added 2026-09-29. The plan is at https://claude.ai/artifact/CcFcnYcEJraKFMEaXHQiYv.

When the Commander asks, the lead agent can **add** a ready-made assembly line (and by default a new room for it). The
model never places anything itself. It fills a fixed menu, and StarNet does all the placing with the same code Build
mode uses. A weak model's worst case is a line the Commander didn't want, which one UNDO removes. It can't break the
station.

## How it works

1. `station.plan_line`: read-only, no approval. The page's `StationBuilder.plan` builds the request on a **copy** of the
   live station and checks it:
   - every new machine can be walked up to
   - no new routing error appears anywhere
   - every existing dock routes exactly as before

   It returns a `planId` (it lasts ten minutes and is used once), a plain summary, each step's instructions, and the
   new line's readiness (`WorkflowLine.readiness`, the Workflow panel's own blocking list).
2. `station.build_line`: write access, the approval card, and a **taint lock** (step instructions persist and later
   runs obey them). It applies exactly that plan inside one `transact`: one undo slot, all or nothing. It refuses:
   - if the floor changed since the plan
   - if Build mode is open, because the Commander owns the floor then
   - if the result would differ from the plan by a single tile, in which case it rolls itself back

   The approval card shows the plan's own summary and each step's instructions. The sidecar reads them from the memo
   `station.plan_line` filled; it never uses the model's words.

## The menu (the only things the model can say)

| Field | Accepts |
| --- | --- |
| `line` | One of the Lines shelf's tested lines, by id or plain name (read from `WorldModel.BLUEPRINTS`) |
| `where` | `"new room"` (the default: `worldmodel.roomSpots`, shared with Build mode's MAKE ROOM), or an existing room by name. In an existing room, every machine and belt must fit on clear floor **inside** it. |
| `name` | What to call the line (on its Inbox), up to 48 characters |
| `steps` | `{ step, instructions, agent }` by step number in run order, or `{ role, … }`. `agent` is a crew name or id, or `"lead"`. A step without instructions gets its role's standard ones. |
| `dailyCap` | Dollars per day, or `null` for no cap |
| `tries` | 1 to 5 review passes, on lines with a review loop |

Anything else is refused with the valid choices. For example, `x` gets: "StarNet chooses every position, belt and piece
of furniture itself, so these fields are not accepted: x".

## Proof

- `test/station-builder.test.js` (fast gate):
  - all 20 lines plan and build in a new room, and one undo restores the station exactly
  - add-only on a station with a working line
  - existing-room placement
  - steps, settings and refusals
  - stale and tampered plans
  - **the bad-model gauntlet**: 400 seeded wrong or hostile requests, and after every one the station is unchanged, or built with nothing existing moved and one undo restoring it
- `test/station-builder.e2e.test.mjs` (HTTP gate): a mock lead plans and then builds through the real sidecar, bridge
  and page in Chromium. The floor, the Workflow panel pill, the Build-mode refusal and one UNDO are all checked.
- Live, in ask mode:
  - the card read "NOVA wants to build this on your station: Build + test ("SHIP IT") in a new room beside HOME: Engineer (NOVA) → Tester (NOVA) → Outbox · daily cap $5 · up to 3 review tries. It will be ready to run. One UNDO in Build mode removes it."
  - Approve once built it
  - Deny built nothing, and the model was told

  In ask mode the lead first settles its Task Brief (`brief_proceed`), because `station.build_line` is consequential work.

Later phases, in the plan: rooms and decor from curated kits, understanding "does X, Y, Z", recruiting on the card, and
custom shapes through the conveyor layout engine.
