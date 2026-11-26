# Verdict on api-3-readability-26

## The finding as given

- id: api-3-readability-26 (slice api-3, readability reviewer)
- page: api/splats, api/sound
- anchor: splats line 212; sound line 86
- category: wall-of-text
- severity: low
- claim: Splats line 212 names 13 members of Splats in one sentence without saying what any of them does. Sound line 86 lists the setters of loops, groups and shots in prose. The water page gives members in tables.
- evidence: splats line 212 "Splats gives update(eye), setBudget(count), settle(), ready, total, drawn, chunks, loaded, failed, bytes, loadedBytes, feature and draw, and destroy() frees it."
- proposedEdit: Add a Member | What it does table for Splats under The calls. On api/sound add a Sound | Members | Notes table with rows for a loop, a group and a shot.
- generatedSource: (none; both are hand-written pages)

Verdict: partly

## Evidence

Splats (holds, but smaller than claimed):
- docs/api/splats.md:212-213 is the sentence as quoted. It sits under "## The calls" (line 199), after a call table (lines 201-210) that covers only the module's functions.
- Seven of the 13 members are explained elsewhere on the same page: `update` (line 110), `setBudget` (line 139), `ready` and `settle()` (lines 149-153), `failed`, `bytes` and `loadedBytes` (lines 195-196). So "without saying what any of them does" is true of the sentence, not of the page.
- Six members have no meaning on the page: `total`, `drawn`, `chunks`, `loaded`, `feature`, `draw`.
- docs/api/reference/splats.md:131-145 has a table of every `Splats` member with a description, and the page links that reference at line 263. So a reader can find the meanings, but only by leaving the page.

Sound (does not hold as a real cost):
- docs/api/sound.md:86 does not just list setters. It gives the group's index-first form with an example, the `positions`/`levels`/`rates`/`tones` arrays with a one-call copy example, `play(x, y, z, level, rate)`, and what a destroyed sound does. These notes do not fit table cells well.
- The meaning of each setter's value is in the table directly below, "## The values of a sound" (lines 90-97: level, rate, tone, place).
- docs/api/reference/sound.md has per-member tables for the group (lines 88-93), the loop (line 129) and the shot (line 182).
- stats.json lists this paragraph at 91 words and 7 sentences, just over the 90-word mark. A table here is a matter of taste.

Water comparison: the water tables (docs/api/water.md:96-126) are option fields that a call takes, not members of a returned object. They show that tables suit options. They do not show that the sound paragraph needs one.

## Corrected claim

On api/splats, the sentence at line 212 lists all 13 members of `Splats` with no meanings. Six of them (`total`, `drawn`, `chunks`, `loaded`, `feature`, `draw`) are explained nowhere on the page, only in the API reference. The api/sound paragraph at line 86 is fine: the values table under it and the API reference already explain the setters.

## Corrected edit

On docs/api/splats.md only, replace the sentence at lines 212-213 with a short table under "## The calls":

| Member | What it does |
| --- | --- |
| `update(eye)` | Chooses the splats that draw from the camera's position. Call it once a frame |
| `setBudget(count)` | Caps the splats that draw below the preset's count |
| `ready` | Resolves when the cloud can draw its first view |
| `settle()` | Resolves once the chosen splats are packed and their chunks have arrived |
| `total`, `drawn` | The splats that the cloud holds, and the splats that draw now |
| `chunks`, `loaded`, `failed` | The cloud's chunks, the ones that have loaded, and the ones that stayed unreachable |
| `bytes`, `loadedBytes` | The cloud's total size, and the part that has arrived |
| `feature`, `draw` | The add-on feature, whose settings, budget and figures the engine resolves, and the draw, whose batch rows are the splats that draw |
| `destroy()` | Frees the cloud |

The [API reference](reference/splats.md#splats) gives each member's type.

Leave docs/api/sound.md as it is.
