// Rebuilds the milestone pull request's description from two sources that cannot drift: the plan's
// task headings, and the `Task:` trailers of the commits on this branch. The marks it prints are
// the ones the pull request uses, and the three tables below carry the judgement that a trailer
// cannot: what part of a task landed, and what a task's own outcome was.
//
// It reads the plan from `.internal/plan/m3-breakdown.md`, which git does not keep: on a clone
// without it the tool says so and stops, and nothing else in the repository depends on it.
//
// From the repository root:
//   bun run pr-status            print the description
//   bun run pr-status --apply    write it to the milestone pull request
//   bun run pr-status --ready    print the open tasks, the ones nothing blocks first
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASK_TRAILER } from './hooks/check-task';
import { findAckValues } from './hooks/commit-ack';
import { TASK_EVIDENCE } from './task-evidence.ts';

/** The milestone pull request, its title, and the plan that lists its tasks. */
const PR = '549';
const TITLE = 'feat: the 0.2 release work for level of detail, effects, add-ons and vegetation';
const PLAN = '.internal/plan/m3-breakdown.md';
const BASE = 'origin/main';

/** Tasks whose work is partly on the branch: the part that landed, and the part that remains. */
const PARTIAL: Readonly<Record<string, string>> = {};

/** Tasks whose work is on a helper branch, whether or not part of it has reached this branch. */
const ON_BRANCH = new Set<string>([]);

/** A task that a commit names, but that the audit of the branch found unfinished. */
// The branch's audits read every ticked task against its own "Done when" and its section's rule.
// A tick states that the task is done, so a task those audits found short of its own line is not
// ticked here until the gap closes, whatever code it already has.
// A task belongs here only when it has no evidence yet. A task whose proof is written but whose
// gap still stops the tick belongs in AUDIT_GAPS instead: a task in both lists says its work is
// unfinished and finished at once, and the release hook refuses a range that creates that pair.
const INCOMPLETE = new Set<string>([]);

/** Tasks whose outcome a reader needs told, beyond the plan's own line. */
const NOTES: Readonly<Record<string, string>> = {
	'M3-A8':
		"the evidence measures the worst error at 2.03 of an 8-bit step at a saturated yellow, over the prototype's one-step tolerance. The owner accepted that cost and ruled that the display table stays and the light table comes out",
	'M3-X1':
		"the demos show each new feature, and Creek's pictures moved in both reference sets with the species rework, which is the redraw the line asks for. The owner answered again that the demo shortfalls stand, and that answer covers the Skyway's two Low rows alone: Creek's and the forest's frame-ceiling misses stay open under M3-V16 and M3-V14, and the cloud S24 cannot be judged against 60 at all because its display caps at 30, which is why the phone-class answer is the S24 Plus's 58.9",
	'M3-V7':
		"the plants sway through the material and Creek draws through it, and the picture test that the first generator took with it now has a replacement: `tests/image/plant-sway.spec.ts` draws one hawthorn under a strength-2 field beside the same plant at a 1 mm sway distance, at fixed times, and the control measured exactly 0.00000 on all three tiers while the swaying picture moved 0.10111 on WebGPU, 0.02966 in compatibility mode and 0.03024 on WebGL2. The shadow redraw count now has its witnesses: tests/image/plant-shadow-count.spec.ts counts a plant's cascade draws, and crates/null3d-render/tests/shadows.rs and cpu_culled_shadows.rs redraw a still camera's far cascade past a material's sway distance 5 frames of 8 where forcing the skip off reads 8. The motion data now has its witness too: plant-sway.spec.ts draws the swaying plant under the motion view and reads 0.73 of the frame lit against none for its one-millimetre twin, on WebGPU, the compatibility path and WebGL2, and its held-time pair keeps the field's own offset so a frozen sway fails. The Rust test's cache claim rests on equality with a still card: a_card_past_its_sway_distance_leaves_a_far_cascade_cached redraws the far cascade as often for a card past its distance as for a still one, and every frame for a card within it.",
	'M3-E6':
		"both first users follow the preset: splats' budget, and the water add-on's reflection cadence, which doubles the wait at each frame-budget step up to every sixteenth frame. The overlay now lists the GPU time of each step of the frame and fills an add-on's row from the render passes that its description names, which the water add-on uses for its reflection pass; a feature whose work records inside the engine's own pass reads gpu not measured, as splats does on every path (D-267)",
	'M3-E8':
		"the hook carries M3-V13's history, and the wind add-on's field is the first user that ships: its cards, grass and leaf materials read the compute pass in the same frame on WebGPU, compatibility mode and WebGL2, where the add-on's fragment form draws it. The water add-on's FFT ocean, the plan's named first user, is on the milestone and draws its chain on all three paths under M3-F9",
	'M3-R22':
		'both shader-build checks now build the basic material and the environment generator instead of four whole entries, which is 478 builds against 11,119 and takes the determinism part from 447 s to 7.4 s on a loaded Mac. Every module kind still appears: only the environment generator sets `first_use` and only the basic material sets `by_device`, so dropping either one fails the kind assertion, and both checks read the same list again, so no module kind loses its coverage',
	'M3-R42':
		'the High and Ultra pictures-and-timings clause has no timing pair at the head and no Ultra picture. The evidence entry records no High or Ultra timing row, and the image tests draw at `preset=high` (`REFERENCE_PRESET_SWITCH` in `bench/lib/parity.ts`), so no Ultra picture exists. The shipped change is provably Low-only: `examples/showcase/island/shadow.test.ts` pins Low at 250 m and the three heavier presets at the stretchable 600 m, so the High picture cannot move. But the clause names timings and pictures and was not given them. The owner ruled that the guard test satisfies the clause: asked whether it stands in for a High and an Ultra timing pair, he answered that it is ok, so the clause is met on his word, and D-326 records the ruling',
	'M3-F3':
		"dropped with the temporal resolve it waited on (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F10':
		"dropped with the temporal resolve it needs (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F9':
		"the simulation, the material and the older path's fragment form are on the milestone, and the ocean draws on all three GPU paths. The demo's WebGL2 picture was blocked by an ordering fault rather than by something the picture could not show: the CPU-culled builder culled each view from the turn before its own, so a reflection that waited recorded a pass with no objects and resolved its clear color, and the sea lost its mirror. The cull now moves the views' turns on first, and the rule is recorded: a view's turn must advance before anything culls against it. The mirror keeps its image at cadences of two, three and four, and the every-frame reflection picture is byte-identical before and after the fix (0 of 230,400 bytes differ). The six demo pictures hold in both reference sets. The 833 ms frame against 158 without was the graph's recompile from switching the pass, not the ocean's draws: with the pass carrying its cadence the page held 60.01 frames a second and a 16.7 ms frame in all three states at 1920 by 1080 on WebGL2 at Low, at a one-minute load of 7.7, against 1.21 frames a second with the pass switched. The ocean's simulation costs 2.850 ms a frame on WebGL2, the least of three batches of an on/off ablation in separate page loads with the quiet window held; on WebGPU and in compatibility mode the batches straddle zero inside the frame's own variation, so the method states no cost there, with a bound of about 1.4 ms. The preset changes none of the bands or the grid: `createOcean` takes them as options, the transform's grid is the fixed 128 constant, and the add-on's only preset row is `reflectionEvery`, so the figure is the figure at every preset. WebGL2's 2.850 ms is 5.7 times the plan's 0.5 ms estimate, a finding about the estimate, and the Mac's ocean sits well inside a 16.7 ms frame on its own; the only per-preset reflection figure is the Galaxy S25's 1.7, 1.7, 3.4 and 3.4 ms (D-120), and the two devices are not one frame. The add-on's gates pass, with zero bytes allocated per frame at every preset and its shader sets inside the first-use figure that has since risen to 128 KB, with an add-on over a figure a warning by the owner's ruling",
	'M3-A11':
		'measured on both paths at every preset; it does not beat the presets, so it stays behind the internal setting and does not ship (D-206). Its black-capture and bind-group faults are fixed, its shader file still loads on first use, and that first-use case is now tested on both paths',
	'M3-D5': 'the layout that D-173 settled, which the traffic lanes add-on follows',
	'M3-R23':
		'the depth-only prepass is the default and passes the bar on the iPhone 18 Pro at both scales and on the iPad 10 at half scale; the iPad 10 at full scale reads 0.52 and 0.64 ms against the 0.5 ms bar, and the owner ruled that margin accepted (D-269)',
	'M3-R19':
		"the second step costs 2.96 to 2.99 ms of a 6.14 to 6.23 ms frame at half the scale on the cloud iPad, and 3.71 to 4.16 ms on the High preset's canvas; the first addendum's 20.5 to 34.9 ms was the frame's tail, since the engine folds every pass after the seventh into it. The held pair of 34.6 against 29.7 frames a second and 22.56 against 27.56 ms has no run file, and this reading's cells bracket its GPU times. The gate commit's 36.1 frames a second lies inside the 29.6 to 36.2 spread three runs gave at one code state, and the head's 29.0 sits 0.6 below its floor, so the second step is not shown to cause S5's drop (D-236)",
	'M3-V15':
		"the held pair that its Done-when asks for is recorded: two runs on this Mac's card gave the same three shares, 0.08900, 0.05505 and 0.08261, and a browser run of the wind pictures passed 21 of 21 with none moved, so no reference was redrawn",
	'M3-V12':
		"the demos' plants grow from the add-on, the whorled tiers and the tapered conifer crown are in, both picture sets were redrawn with 75 real-GPU references, and the look review approved them. The shared stand-in left the demos: `examples/lib/pines.ts` is gone, the stone garden keeps its own turn constant, and the five sketches that weigh levels and impostors keep that exact tree at `tests/pages/lib/pines.ts`, with 24 of 24 pictures unchanged. The first clause of the Done-when, that no demo keeps a plant generator of its own, is met by every demo except five. The campfire glade in `examples/particles/glade.ts` builds its own birches and cone firs in code. The impostor forest keeps a stand-in because the add-on's conifer cannot stand where it stood: the pine is 40 triangles and 1.4 KB at its coarsest level against the conifer's 3,079 and 205 KB, and drawing the demo's forest through the add-on measured 180.22 ms of GPU time at Low against 4.33, 30,070,000 triangles against 2,230,000 and 248.8 MiB of wasm against 51.8, which passes the engine's memory cap at the demo's own count. `examples/forest/` builds its own trees, three firs and a broadleaf, and `examples/translucency/plants.ts` builds its own plants with `leafMesh` and `clump`. The battle demo builds its woods with `pineTree` in `examples/compare/battle/shapes.ts`. Light-shafts is not an exception: it grows its pine with the add-on's `generatePlant` from a species record, and a record is not a generator. Four of the five are accepted by the owner's rulings, which the vegetation record's addendum carries: the translucency garden, the impostor forest, the campfire glade and the battle demo. The forest is the one exception to that: the 9 November ruling says its own generator stays only until the swap, and the owner confirmed the swap on 10 November 2026, so it is an open gap until the sparse tree lands and the forest draws through the add-on. Nothing on this task waits on his word any longer",
	'M3-V5':
		"the plant textures ship from the reference set as ETC1S KTX2 files: `@null3d/vegetation-textures` holds 11 species and 116 files in a full set and a Low half set, with a manifest and a module for each species, and `tests/image/plant-textures.spec.ts` draws the oak's two sets on all three paths. The coverage clause is met by `tests/image/plant-coverage.spec.ts`, which draws one oak crown at three distances on all three paths and holds each far crown's covered share to the near crown's within 14 per cent. What keeps it open is the Done-when's bake-time clause: the shipped path has no runtime bake, and no per-device figure records its download and decode cost. No re-scope of that clause to the shipped path is recorded and no waiver is recorded, so the task stays open on this clause alone",
};

/**
 * Why a task whose work is on the branch is still unticked: the gap that the branch's audits found
 * between the task's own "Done when" and what the branch holds. These win over the note above,
 * because both describe the same task and only one of them can be true.
 */
const AUDIT_GAPS: Readonly<Record<string, string>> = {
	'M3-C2':
		"the showroom draws and drives, its wheels turn forward on both sides with a contact-point test that fails on the inverted sign, the lamps are recorded honestly as one capture on one path with the sparkle traced to the paint, both reference sets hold its pictures, and the owner approved the nose's flake and clear-coat look. The rate clause closed on his answer: asked whether the iPad Pro 13's 47.6 to 47.8 frames a second against the 60 target stands as the close, he answered that it is ok, and an ordinary-Low run measures the gap directly at a 20.8 ms median against the 16.7 of 60 frames. What keeps the task open is the look's record: the approval the note claims dates from 2 November and nothing openable carries it, so the tick waits on the owner saying again that the look stands, and his answer then goes beside the claim in the decision record",
	'M3-V11':
		"the swap landed at `10d91fda8`, and both picture sets are redrawn at this branch's head: the 12 Mac Creek pictures pass 12 of 12 against references this branch drew, and the 12 software ones pass 12 of 12 against a local drawing recorded with its reason, which CI's next run replaces (D-238). What stands open is the owner's look review, and the owner has since put the vegetation add-on's trees and plants into another session, so that review waits: the plants it would look at are being redrawn there, and the twenty-four Creek pictures move again when they land. The iPad row of the plan is measured: Creek at Low on the core WebGPU path reads 24.28 ms median, 28.72 at p95 and 30.47 at p99 against the 30.8 ms ceiling, at 40.86 frames a second and full render scale, recorded for `bsipadpro13-safari` at `5fad58f09`. The page's 47 first-use pipelines cost 48.2 s of compile before the measured window, so the two stalled sessions were a long compile rather than a hang; High and Ultra remain unmeasured on that device. The branch drew the Creek's plants at `10d91fda8`, and that commit's footers wrap a value onto a line with no indent, so git read no trailer block on it; the evidence and the pictures are now carried by a later commit with a proper block. It is also short of content rather than only of pictures: the task's own What line and the vegetation design's species list name maple and hemlock on north faces and pine on the dry south faces, and the valley grows none of the three. Its rules place rush, sedge, weeping willow, common alder, pedunculate oak, European beech, silver birch, Norway spruce, bracken, hosta, wildflower and hawthorn, and `examples/lib/plants.ts` draws each as the plant core's stand-in. Its scatter rules do favour a north face: `examples/showcase/creek/valley.ts` gives the oak, the beech and the Norway spruce each a northness curve, and the beech's holds from 0.25 northness up. So the gap is the three species, not the aspect rule; no record revises that line, so either the three species are grown or the owner or the designer revises the design. And the pictures are not final: `feat/vegetation-tree-shapes` changes the plant generator and `plant.wgsl`, so every grown plant changes shape, and when that branch lands all twenty-four Creek pictures must be drawn again",
	'M3-V16':
		"its Done-when is met, but its Budget line is not: the governor must hold each preset's D-241 frame ceiling and never fall below that preset's vegetation GPU time. Cells that fail are measured, not missing. The S25's Ultra Creek row reads 516.56 ms against 499.8, and the task's own evidence says that row does not close the ceiling. The iPad's forest reads 65.45 against 54.8 at Medium, 76.14 against 67.1 at High and 84.06 against 71.1 at Ultra. The Tab A9 Plus's 1,484.12 against 1,268.5 at Low is from branch `3f6da0f4c`, 2,247 commits back and before the far cover; the head's run reads 1,059 against 1,268.5 and holds, and the tablet draws no frame at Medium or above. The wind's own row holds where it was measured — the S25 settles at its 33.3 ms display floor with one field cycle at 5.8 of its 6.25 ms budget — so the failure is the scene, and only the owner's M3-V14 options settle it. The reference Mac is measured at all four presets in a 2 November run at `6c22e1c01`: its High frame reads 89.28 ms against the Apple devices' 62.5 to 67.1 ms High ceilings, so that row misses too, while its Low, Medium and Ultra rows are within the wider Apple ceiling of their preset. That run's canvas is larger than the earlier Mac Creek record's, so its milliseconds must not be set against that older row's; compare them only with the ceilings. The iPad's Creek High and Ultra and its newer path remain unmeasured, but measured rows already miss the budget, so no missing figure decides the tick",
	'M3-V17':
		"its Done-when asks that Creek and the forest show gusts that travel at each preset on the four cloud devices of M3-V1 within D-241's frame ceilings, that the motion vectors and shadows follow the sway, and that every moved picture is redrawn in both reference sets. Its evidence entry records the readers and the four redrawn Creek pictures, but the wind is not yet shown to meet the whole line. The entry records no iPhone 17 row, one of the four devices. The forest's Medium and above rows were not measured at the head, so its wind share is not shown to sit inside those ceilings. A held picture of Creek under a sent gust on WebGL2 is owed, because the machine barred image runs when the change landed. The particles add-on in `packages/particles/src/` also has no wind input, so dust, motes, smoke and rain take no offset from the field, which the task's own bullet asks for. The tick rests on the `Task:` trailers alone, so it is reversed here until the rows and the held picture exist",
	'M3-V14':
		"the owner ruled the rows and the budgets, and D-283 records them. Three clauses of the Done-when stand open, so the task cannot tick: the smallest-tier look, which he has now judged: shown the wind demo at Low beside Medium, he answered that he can tell the difference, so the smallest tier he cannot tell from the next one up stands at Medium or above and Low's look is open; the cost of each tier on the M5 Max, a row D-283 records as owed: the M3 Max this repository is developed on stands in for it, and its rows are what the task will be judged on until that row exists; and the proof that the chosen rows keep Creek and the forest within D-241's frame ceilings. Creek's readers are built, and the S25's Ultra Creek frame reads 516.56 ms against the owner's 511 ms ceiling, so that side is shown to miss, while the forest's side is measured and over its ceilings: the iPad reads 88, 111 and 97 ms at Medium, High and Ultra against 54.8, 67.1 and 71.1, and the cloud S24 66 ms against 33.3",
	'M3-V8':
		"the hill draws through the add-on on both GPU paths, with a per-tile view cull, a far share that widens the blades it keeps, and a per-view cull that the near cascades apply too. Creek's two grass fields draw through the add-on with no grass code of its own, the 11 grass tests pass, and the real-GPU pictures hold the look. At Creek's own density on the Tab A9 Plus the far share takes 12.68 ms, 4.0 per cent, back at 2,312 tufts and 36.44 ms, 6.9 per cent, at 6,820, and the per-view cull takes the 2,312-tuft row to 288.75, 294.98 and 298.22 ms over three runs against 306.09, while at 6,820 the runs straddle 490.73; neither row reached D-241's 208.3 ms High ceiling before the far cover, and the miss was the grass's: the same page with the grass switched off measures 179.18 ms, 29.12 ms inside the ceiling, so the grass's 126.91 ms at 2,312 tufts and 311.55 at 6,820 carry those rows past it. The shadow views were never the large part: the three cascade passes cost 2.1 to 2.2 ms at the valley's density and 6.3 at the strip's. The timer times the frame's first seven passes one by one and adds each pass after them to the last, so the 176.36 ms that it gave ambient occlusion's denoise was the opaque pass in that slot: with the sun's contact shadows and the bounce light off the scene measures 143.49 ms, and the timer names the opaque pass at 138.94, so the three ambient occlusion passes cost about 43 ms and four pictures of the hill, with either effect off and with both, are pixel for pixel the same. With both off the hill at Creek's density measured 235.41 ms, 27.11 ms past the ceiling, and the far cover closed the rest: its fade now reaches its floor at 24.31 meters, removing 36.9 per cent of the drawn tufts, and the row measures 209.72 and 196.02 ms there, mean 202.87, against 217.45 and 216.60 at 25.59. The base page bracketed that block at 162.27 and 156.30, so the machine drifted about 6 ms within it, and 208.3 sits inside the row's spread at the chosen distance rather than outside it; the hill crest's picture differs from the authored distance by 0.768 per cent of its pixels and the demo's horizon by 0.085, with no bare edge. The 20,000 tuft hill is a stress case with no ceiling, and its Tab High row is 961.54 ms with the shadows. The iPad's stress rows hold its ceilings, and the S24 gives WebGL2 only, with its two rows inside the S24 class's. The per-view cull reads the frame's own matrix and the one count that the compute pass writes, and Creek's whole frame is M3-V11's. What stays open: no comparable Mac row, since its only run warns that the drawing buffer was the wrong size; and the low-end tablet's rows above Low, where the recorded branch run at 5fad58f09 reads the Tab A9 Plus at Medium 2,243 ms against its 1,820.8 ceiling and High drew no frame, so its budget is unmet until a newer run says otherwise. The iPad's rows above Low now exist: the iPad Pro 13 passes all thirteen vegetation-grass pages at d822a8cc2, reading 3.65, 6.44, 10.04 and 12.14 ms of GPU time from Low to Ultra on the newer path and 3.52 and 6.72 on the compatibility path, with its WebGL2 CPU times, and the no-grass page's timer is refused as the hot-device fault it was. The view-edge clause now has its record: `tests/image/vegetation-grass-shadow-edge.spec.ts` reads the bottom sixteenth's share of the frame's own ground shadow, 0.786 on WebGPU, 0.912 in compatibility mode and 0.876 on WebGL2, and it falls to zero when the blade list's cull is given no reach past the view; the WebGL2 path passes the cut case because it culls each view itself.",
	'M3-S1':
		"the add-on check links the shader set that is already built rather than building it inside its own page process, so the heavy page-build ceiling fell from 14,336 MiB against a recorded 720 to 818, and a hard link that fails across volumes now refuses by name instead of copying the set into every script folder. What keeps it open is its Done-when, that every lane's peak is measured on the server and recorded with its conditions; one lane's pair is now measured on the machine the clause names: this Mac is the 36 GB server, as the device record says, and the unit suite read 2.5 GB one group at a time and 4.0 GB with two, 312 and 168 seconds. The other queue lanes, a job kind beside another, are still owed a peak pair each with its conditions. The unit suite's own parallelism is a different lever: two of its groups at once read 174 seconds at 3.8 GB and three read 154 at 5.0, on this Mac and the same tree and command as the 312 and 168 pair, with the vegetation group's 142 seconds the floor no count goes below; its two-lane runs, 174 at 3.8 and 168 at 4.0, differ by the run-to-run noise, and the queue's 5 GB booking is for the two-group shape, whose run read 4.0 GB, where the three-group 5.0 GB is a lever not taken. The entry's own words name the gap: the before-and-after pair from the 36 GB build server, one job at a time through the queue. The Mac's figure has also moved since the entry was written. The check read 1,154 MiB on 3 November where the entry records 720 to 818, and the ceiling was raised to 1,280 with that history beside it, so the recorded conditions no longer describe the current peak",
	'M3-R22':
		"the shader-build checks build the basic material and the environment generator instead of four whole entries, 478 builds against 11,119, so the determinism part fell from 447 s to 7.4 s on a loaded Mac and every module kind still appears. What keeps it open is the third clause of its Done-when, that every rust-tests part runs under 4 min. CI run 42559133369 at `4fb343293` measured it on `ubuntu-latest`: the four partition parts took 4.83, 3.75, 3.72 and 5.92 minutes of job wall time, and the determinism part took 0.9 minutes, so the determinism part and parts 2 and 3 are inside and parts 1 and 4 are outside. The excess is the parts' own tests, not the shared runner: nextest ran 534 tests in 192.3 s in part 1 after a 76 s build and 447 in 223.7 s in part 4 after a 102 s build, and setup took about 0.4 minutes a part. The clause is a measured miss, so the task stays open",
	'M3-R43':
		"two hand-started runs of one commit now draw the same picture. Runs 42749736710 and 42749760664, both on `5fad58f09`, read 7.109 per cent on WebGPU and 0.123 and 0.125 on the other two paths, the same figures to the third decimal, where the bare base at `c788c8595` drew 3.241 and 29.845 in two runs before the held-frame turn landed. So the run-to-run change is gone, and the 7.109 is a difference from the committed reference on the software WebGPU path rather than drift. What remains: the three SwiftShader references are not yet from a CI drawing, and a hand-started run with the drawn-images input uploaded no pictures for the two shards that draw the Island, so the harness has to keep its drawings before those references can be accepted. The water add-on's held-frame test now observes the cadence and the pass that the add-on itself draws. The leading suspects are the held frame's late copies of the scene's depth and of the mirror on WebGL2",
};

/** The plan's groups, by the first letter of a task's part, in the plan's order. */
const GROUPS: readonly (readonly [string, string])[] = [
	['Level of detail', 'L'],
	["The study's follow-ups", 'ABC'],
	['Add-on platform and hooks', 'DE'],
	['Effects and techniques', 'F'],
	['glTF and API', 'GK'],
	['Shipping', 'OT'],
	['Queue lanes', 'S'],
	["The study's tasks", 'R'],
	['Vegetation', 'V'],
	['Demos', 'X'],
];

const git = (...args: string[]) =>
	execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The roots that hold a build of the engine, its tests, its demos and its published pages. */
const CODE_ROOTS = ['crates/', 'packages/', 'tests/', 'examples/', 'bench/', 'docs/'];

/**
 * Every task ID that a kept commit's `Task:` trailer names, once that commit built something. The
 * count reads every commit's trailer block, with no dateline: it reports which tasks the branch
 * names in a footer that git reads, and a tick that rests on a footer git cannot see is a tick that
 * nothing downstream can carry.
 */
function landedTasks(): Set<string> {
	// A record-only commit claims a task without building any of it, so it must not read as work
	// that landed with its evidence still owed: that reads to a maintainer as a finished feature
	// whose proof is missing. Only a commit that touches a file outside the records counts.
	const out = git('log', '--format=%x1e%H%x1f%b%x1f', `${BASE}..HEAD`, '--name-only');
	const tasks = new Set<string>();
	for (const chunk of out.split('\x1e')) {
		const [, body = '', names = ''] = chunk.split('\x1f');
		const files = names
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		// A test file is code wherever it lives: the guard test for a tool sits beside the tool, and
		// without this a task whose whole work is a test in `tools/` could never land.
		const built = files.some(
			(file) =>
				CODE_ROOTS.some((root) => file.startsWith(root)) || /\.(test|spec)\.[jt]s$/.test(file),
		);
		if (!built) continue;
		// A trailer claims a task. A body that mentions an ID in prose, such as a `Docs-Checked:`
		// line, must not tick it, or a task that no commit names in a trailer reads as ticked.
		for (const value of findAckValues(body, TASK_TRAILER))
			for (const id of value.match(/M3-[A-Z0-9]+[a-z]?/g) ?? []) tasks.add(id);
	}
	return tasks;
}

/** Each task of the plan, in its order, with the name it was given. */
function planTasks(): { id: string; name: string }[] {
	const text = readFileSync(PLAN, 'utf8');
	// A plan entry that names a closed investigation rather than work is not a task, and counting
	// it among the open ones says the milestone has work it does not have.
	const NOT_TASKS = new Set(['M3-R37']);
	const marks = [...text.matchAll(/^(M3-[A-Z0-9]+[a-z]?) (.+?)(?: \(P.*)?$/gm)];
	// An entry the owner dropped is not work either: its own line says so, and no ready start makes
	// it happen.
	const dropped = new Set<string>();
	for (let i = 0; i < marks.length; i++) {
		const start = marks[i]?.index ?? 0;
		const end = marks[i + 1]?.index ?? text.length;
		if (/^Dropped by the owner's ruling/m.test(text.slice(start, end)))
			dropped.add(marks[i]?.[1] as string);
	}
	return marks
		.filter((match) => !NOT_TASKS.has(match[1] as string) && !dropped.has(match[1] as string))
		.map((match) => ({
			id: match[1] as string,
			name: (match[2] as string).trim(),
		}));
}

function description(): string {
	const tasks = planTasks();
	const landed = landedTasks();
	const done = ({ id }: { id: string }) => isDone(id, landed);
	const open = tasks.filter(({ id }) => !landed.has(id) && !PARTIAL[id] && !ON_BRANCH.has(id));
	const lines = [
		'One pull request for the whole of the milestone that ships 0.2.0. It is not merged until every task below is done, so the list moves as the work lands.',
		'',
		'**How to read the marks:** `[x]` done and on this branch. `[ ]` not done, with its state in the note after the name: part landed, on a helper branch, or not started.',
		'',
		`The milestone holds ${tasks.length} tasks. ${tasks.filter(done).length} are done and ticked below, ${tasks.filter(({ id }) => landed.has(id) && !done({ id }) && !PARTIAL[id] && !ON_BRANCH.has(id)).length} have their work on the branch but not the evidence a tick needs, ${Object.keys(PARTIAL).length} are part landed, ${ON_BRANCH.size} are in progress on a branch, and ${open.length} are open.`,
		'',
	];
	for (const [title, letters] of GROUPS) {
		lines.push(`### ${title}`, '');
		for (const { id, name } of tasks) {
			if (!letters.includes(id.split('-')[1]?.[0] ?? '')) continue;
			// GitHub draws a checkbox only for `[x]` and `[ ]`, so a task that is part done or on a
			// branch keeps the empty box and says its state in the note; anything else reads as text.
			// A task whose code sits only on a helper branch is not done: the pull request merges the
			// branch, so an unmerged task would claim work that a reader cannot find here.
			const done = isDone(id, landed);
			const mark = done ? 'x' : ' ';
			const note = PARTIAL[id]
				? ` — part landed: ${PARTIAL[id]}`
				: ON_BRANCH.has(id)
					? NOTES[id]
						? ` — on a helper branch: ${NOTES[id]}`
						: ' — on a helper branch'
					: INCOMPLETE.has(id) || NOTES[id] || AUDIT_GAPS[id]
						? (AUDIT_GAPS[id] ?? NOTES[id])
							? ` — ${AUDIT_GAPS[id] ?? NOTES[id]}`
							: ' — the branch check is owed'
						: landed.has(id) && !(id in TASK_EVIDENCE)
							? ' — the branch check is owed'
							: '';
			lines.push(`- [${mark}] **${id}** ${name}${note}`);
		}
		lines.push('');
	}
	lines.push(
		'### How it is verified',
		'',
		"- CI on this pull request is the branch's backstop, never the first reader of a change.",
		'- Each helper commits on its own worktree branch, runs the tests its change touches, and reports before the coordinator merges it.',
		"- A task reported done is read by a fresh checker, never by its author: the checker reads the task's own Done-when line, runs the tests it names and opens the pictures it cites, and only a cleared verdict lets a tick or a landing through.",
		'- `bun run limits` reports each fixed limit before a push, and `bun run pr-status` rebuilds this list from the branch itself.',
		'- A commit that can move a limit carries a `Limits-Checked:` line, and one that changes what the GPU draws carries a `GPU-Checked:` line.',
		'- The pictures, timings and device rows live in `.dev/examples.md`, `.dev/benchmarks.md` and `.dev/tested-devices.md` beside the features they measure.',
	);
	return `${lines.join('\n')}\n`;
}

/**
 * True for a task that counts as done: landed, with an evidence entry, and nothing that holds it.
 * The description's marks and the ready list both read this one rule, so a change to it reaches
 * every place that says whether a task is finished.
 */
function isDone(id: string, landed: ReadonlySet<string>): boolean {
	return (
		landed.has(id) &&
		!PARTIAL[id] &&
		!ON_BRANCH.has(id) &&
		!INCOMPLETE.has(id) &&
		!(id in AUDIT_GAPS) &&
		id in TASK_EVIDENCE
	);
}

/** The tasks that count as done, for the ready list. */
function doneTasks(): Set<string> {
	const landed = landedTasks();
	return new Set(
		planTasks()
			.filter(({ id }) => isDone(id, landed))
			.map(({ id }) => id),
	);
}

/**
 * Each task's dependencies, as the plan's own lines name them. A task is blocked only by a task it
 * names and that is not done, so the list never grows by an assumption about what a feature needs.
 */
function planDependencies(): Map<string, string[]> {
	const text = readFileSync(PLAN, 'utf8');
	const marks = [...text.matchAll(/^(M3-[A-Z0-9]+[a-z]?) /gm)];
	const out = new Map<string, string[]>();
	for (let i = 0; i < marks.length; i++) {
		const mark = marks[i];
		if (!mark) continue;
		const id = mark[1] as string;
		const start = mark.index ?? 0;
		const next = marks[i + 1];
		const end = next?.index ?? text.length;
		const deps = new Set<string>();
		for (const line of text.slice(start, end).split('\n'))
			if (/depends on/i.test(line))
				for (const match of line.matchAll(/M3-[A-Z0-9]+[a-z]?/g)) deps.add(match[0]);
		deps.delete(id);
		out.set(id, [...deps]);
	}
	return out;
}

/** The open tasks, the ones nothing blocks first, so a coordinator starts what can start. */
function readyLines(): string[] {
	const done = doneTasks();
	const deps = planDependencies();
	const open = planTasks().filter(({ id }) => !done.has(id));
	const lines: string[] = [];
	const ready = open.filter(({ id }) => (deps.get(id) ?? []).every((dep) => done.has(dep)));
	const waiting = open.filter(({ id }) => !ready.includes(open.find((t) => t.id === id)!));
	lines.push(`${ready.length} tasks nothing blocks, and ${waiting.length} that wait on another:`);
	for (const { id, name } of ready) lines.push(`ready    ${id} — ${name}`);
	for (const { id, name } of waiting) {
		const blocked = (deps.get(id) ?? []).filter((dep) => !done.has(dep));
		lines.push(
			`waiting  ${id} — waits on ${blocked.join(', ')}${blocked.length === 0 ? name : ''}`,
		);
	}
	return lines;
}

function main(): void {
	if (!existsSync(PLAN)) {
		console.error(`pr-status reads the plan at ${PLAN}, which this clone does not keep.`);
		process.exit(1);
	}
	if (process.argv.includes('--ready')) {
		process.stdout.write(`${readyLines().join('\n')}\n`);
		return;
	}
	const body = description();
	// A task the plan no longer holds can still be named by an old commit's trailer, and it owes
	// nothing: the owed set is what the plan lists, not every id a trailer ever carried.
	const planIds = new Set(planTasks().map((task) => task.id));
	const owed = [...landedTasks()].filter((id) => planIds.has(id));
	for (const id of owed) {
		if (!(id in TASK_EVIDENCE) && !INCOMPLETE.has(id) && !ON_BRANCH.has(id) && !PARTIAL[id])
			console.error(
				`owed: ${id} landed with no entry in tools/task-evidence.ts, so its box stays empty`,
			);
	}
	if (process.argv.includes('--check')) {
		// A task the tool marks unfinished or on a branch, while the evidence file already names its
		// proof, is a stale mark: the work landed and someone forgot the set.
		for (const id of planTasks().map((task) => task.id)) {
			const stale = INCOMPLETE.has(id) || ON_BRANCH.has(id) || Boolean(PARTIAL[id]);
			if (stale && id in TASK_EVIDENCE)
				console.error(`stale: ${id} is marked unfinished or on a branch but has evidence`);
		}
		const missing = [...owed].filter(
			(id) =>
				!(id in TASK_EVIDENCE) &&
				!INCOMPLETE.has(id) &&
				!ON_BRANCH.has(id) &&
				!PARTIAL[id] &&
				!NOTES[id] &&
				!AUDIT_GAPS[id],
		);
		if (missing.length > 0) process.exit(1);
	}
	if (!process.argv.includes('--apply')) {
		process.stdout.write(body);
		return;
	}
	const file = join(tmpdir(), `pr-${PR}-body.md`);
	writeFileSync(file, body);
	execFileSync('gh', ['pr', 'edit', PR, '--title', TITLE, '--body-file', file], {
		stdio: 'inherit',
	});
	console.log(`wrote the description of pull request ${PR}`);
}

main();
