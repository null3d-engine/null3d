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
	'M3-V11':
		"the species sheet is restored and redrawn at `1c5dc7acf`: the panels view grows the whole plant again, thirteen of twenty species had kept the old sheet after a stale module served their redraw, and Linux Firefox and this Mac agreed on the restored sheet at 40.260 and 40.367 per cent from the stored date palm. All plant pictures pass at zero, with the sparse oak moved 13.8 to 14.9 per cent and the coverage page 1.4 to 3.0, and the panel page reports its frame loop while it grows. Nine species keep Linux its own reference at `cb1a5c898`, from CI run 43864156371, because Firefox draws them 0.52 to 1.75 per cent from the Mac set. The software set still holds the old sheet while CI's replacements download at a throttled few megabytes an hour, so the browser shards show that difference until the follow-up commit replaces them; the drawn run that supplies them is 43864156371",
	'M3-V12':
		"the owner ruled the forest's ceilings stand and closed the task on D-364's row: the forest settles at 94.6, 116.8 and 134.7 ms against 54.8, 67.1 and 71.1, and the demo's own forest stays after the swap was reverted at 67.40, 85.12 and 97.74",
	'M3-V16':
		"the governor's ladder, including the occlusion removal at `df6788f3a`, is measured on the device; the scenes are over their ceilings, so no governed row holds them, and D-364 records that the tasks close on their rows rather than on a ceiling",
	'M3-V14':
		"both remaining clauses close by the owner's ruling of 16 November 2026. The smallest tier is the look he answered with 'low looks fine, close it'. The frame clause closes on D-364's row, not the ceiling: Creek settles at 704.8 to 796.6 ms against 90.8, 67.1 and 99.0, and the forest at 94.6, 116.8 and 134.7 against 54.8, 67.1 and 71.1",
	'M3-V17':
		"the clauses stand by the owner's ruling of 16 November 2026: the frame clause closes on D-364's forest row, 94.6, 116.8 and 134.7 ms against 54.8, 67.1 and 71.1, and the particle, picture and motion clauses hold their evidence in `tools/task-evidence.ts`",
	'M3-D6':
		'`packages/engine/src/shared/version.ts` compares the interface range an add-on declares with the engine that runs it, and `packages/engine/src/shared/version.test.ts` proves it: its test refuses a test add-on built for an interface above this engine and names both, with E1432 and E1433',
	'M3-S1':
		"every queue lane's peak is measured on the server with its conditions, the shader build's peak is the landing's outside-the-queue measurement (5,172 MiB at `96107e7a4` over fourteen threads and 1,180 seconds, free 18.3 GB before, 8.1 at its lowest and 14.5 after, a floor, with the queue's 17 GB booking named beside it), the page process links the built set rather than building it, its cut is proved in one sitting (15,311 MiB before against 14,336, 4 seconds under 1,280 after), the type check needs no cut at 3.0 GB against 7, and the lane pairs hold the reserve (free 29 to 28 GB of 36, the lowest share 69 to 79 per cent)",
	'M3-C2':
		"the owner ruled that the showroom's look stands, and the rate is held by dynamic resolution, the first of three options, with no code change. The studio view reads 45 to 46 frames a second at the whole render scale; the governor walks to 0.75 over about ten seconds, its opening windows read 48.5 to 50.5, at 0.75 the view holds 59.2, and a 15-second window at 0.85 reads 59.8. In the second session the car had left the studio, the view cost about half, and the whole scale itself held 60 after settling, with 0.85 also at 60 and the lower scale saving only 1.8 ms of that street view. The time outside the engine's passes, 5.07 to 5.51 ms on the studio pages and 4.7 to 7.8 across the session, is the browser's presentation. The Mac's rows (108.0 and 106.2 at Low) and the S24's 29.4 of its 30 Hz cap stand as the evidence records them. D-345 records the look and the rate",
	'M3-R43':
		"the owner read the cross-tier clause under the device tolerance: the same-run software drawings agree at 0.109 to 0.127 per cent, inside the 0.5 per cent tolerance that browsers and devices use, so the clause is met; the harness's 0.100 reference limit is the bar for a drawing against its reference, and its 0.127 count here is its anti-aliasing exclusion failing on a dithered picture. The three SwiftShader references come from CI run 42992273718 at `2a5fcaf65`, the run-to-run stability is measured by runs 42749736710 and 42749760664 at `cf627ef05`, and the water add-on's held-frame test observes the pass the add-on draws. D-326's addendum records the reading",
	'M3-R22':
		"the export test reads 10.2 s against its 60 s clause, the determinism part 33 s against 2 min, and the six rust-tests parts 2m29s, 3m22s, 1m58s, 2m01s, 2m05s and 2m28s against 4 min, in CI run 43151824050 at 1d8efb835, every job green; the kind assertion still holds, because both checks read one list and each entry alone writes the kinds it covers. The whole-build comparison that the determinism test runs only when the shard variable is unset sits outside the Done-when's four clauses and does not block the tick",
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
	'M3-V8':
		"the hill draws through the add-on on both GPU paths, with a per-tile view cull, a far share that widens the blades it keeps, and a per-view cull that the near cascades apply too. Creek's two grass fields draw through the add-on with no grass code of its own, the 11 grass tests pass, and the real-GPU pictures hold the look. At Creek's own density on the Tab A9 Plus the far share takes 12.68 ms, 4.0 per cent, back at 2,312 tufts and 36.44 ms, 6.9 per cent, at 6,820, and the per-view cull takes the 2,312-tuft row to 288.75, 294.98 and 298.22 ms over three runs against 306.09, while at 6,820 the runs straddle 490.73; neither row reached 208.3 ms, the S24 class's High ceiling, which the far-cover work took as its stretch target, and the gap was the grass's: the same page with the grass switched off measures 179.18 ms, 29.12 ms inside that target, so the grass's 126.91 ms at 2,312 tufts and 311.55 at 6,820 carry those rows past it. The shadow views were never the large part: the three cascade passes cost 2.1 to 2.2 ms at the valley's density and 6.3 at the strip's. The timer times the frame's first seven passes one by one and adds each pass after them to the last, so the 176.36 ms that it gave ambient occlusion's denoise was the opaque pass in that slot: with the sun's contact shadows and the bounce light off the scene measures 143.49 ms, and the timer names the opaque pass at 138.94, so the three ambient occlusion passes cost about 43 ms and four pictures of the hill, with either effect off and with both, are pixel for pixel the same. With both off the hill at Creek's density measured 235.41 ms, 27.11 ms past that target, and the far cover closed the rest: its fade now reaches its floor at 24.31 meters, removing 36.9 per cent of the drawn tufts, and the row measures 209.72 and 196.02 ms there, mean 202.87, against 217.45 and 216.60 at 25.59. The base page bracketed that block at 162.27 and 156.30, so the machine drifted about 6 ms within it, and the 208.3 target sits inside the row's spread at the chosen distance rather than outside it; the hill crest's picture differs from the authored distance by 0.768 per cent of its pixels and the demo's horizon by 0.085, with no bare edge. The 20,000 tuft hill is a stress case with no ceiling, and its Tab High row is 961.54 ms with the shadows. The iPad's stress rows hold its ceilings, and the S24 gives WebGL2 only, with its two rows inside the S24 class's. The per-view cull reads the frame's own matrix and the one count that the compute pass writes, and Creek's whole frame is M3-V11's. The low-end tablet's top presets are no longer a gap: the row exists and all thirteen pages draw at 75ed4c62d, with Low at 170.98 ms against 1,268.5 and Medium at 425.33 against 1,820.8 both holding, where the recorded branch run at cf627ef05 read Medium 2,243 and High drew no frame, and D-241 gives this tablet no High or Ultra row, so its High and Ultra figures, 754.52 and 941.49 ms, are recorded without a ceiling rather than against the S24 class's 208.3 and 499.8. The Mac's row now exists too: all thirteen pages at 75ed4c62d read 2.06, 3.67, 6.68 and 9.31 ms from Low to Ultra on the newer path, 1.97 and 4.06 on the compatibility path, and 5.80 and 9.19 on WebGL2, with no drawing-buffer warning. The iPad's rows above Low now exist: the iPad Pro 13 passes all thirteen vegetation-grass pages at 75ed4c62d, reading 3.65, 6.44, 10.04 and 12.14 ms of GPU time from Low to Ultra on the newer path and 3.52 and 6.72 on the compatibility path, with its WebGL2 CPU times, and the no-grass page's timer is refused as the hot-device fault it was. The view-edge clause now has its record: `tests/image/vegetation-grass-shadow-edge.spec.ts` reads the bottom sixteenth's share of the frame's own ground shadow, 0.786 on WebGPU, 0.912 in compatibility mode and 0.876 on WebGL2, and it falls to zero when the blade list's cull is given no reach past the view; the WebGL2 path passes the cut case because it culls each view itself.",
};

/**
 * Why a task whose work is on the branch is still unticked: the gap that the branch's audits found
 * between the task's own "Done when" and what the branch holds. These win over the note above,
 * because both describe the same task and only one of them can be true.
 */
const AUDIT_GAPS: Readonly<Record<string, string>> = {};

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

/**
 * Why this tool refuses a shallow clone, or null when the history is whole. A shallow clone keeps a
 * stub of the branch, so the trailers the tool counts are not the branch's: it can print a count of
 * almost nothing and still exit 0.
 */
export function shallowRefusal(answer: string): string | null {
	return answer.trim() === 'true'
		? 'pr-status counts the branch history, and this clone is shallow: run git fetch --unshallow origin first.'
		: null;
}

function main(): void {
	const refusal = shallowRefusal(
		execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }),
	);
	if (refusal !== null) {
		console.error(refusal);
		process.exit(1);
	}
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

if (import.meta.main) main();
