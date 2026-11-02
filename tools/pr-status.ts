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
	'M3-E6':
		"both first users follow the preset: splats' budget, and the water add-on's reflection cadence, which doubles the wait at each frame-budget step up to every sixteenth frame. The overlay now lists the GPU time of each step of the frame and fills an add-on's row from the render passes that its description names, which the water add-on uses for its reflection pass; a feature whose work records inside the engine's own pass reads gpu not measured, as splats does on every path (D-267)",
	'M3-E8':
		"the hook carries M3-V13's history, and the wind add-on's field is the first user that ships: its cards, grass and leaf materials read the compute pass in the same frame on WebGPU, compatibility mode and WebGL2, where the add-on's fragment form draws it. The water add-on's FFT ocean, the plan's named first user, is on the milestone and draws its chain on all three paths under M3-F9",
	'M3-R22':
		'both shader-build checks now build the basic material and the environment generator instead of four whole entries, which is 478 builds against 11,119 and takes the determinism part from 447 s to 7.4 s on a loaded Mac. Every module kind still appears: only the environment generator sets `first_use` and only the basic material sets `by_device`, so dropping either one fails the kind assertion, and both checks read the same list again,',
	'M3-F3':
		"dropped with the temporal resolve it waited on (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F10':
		"dropped with the temporal resolve it needs (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F9':
		"the simulation, the material and the older path's fragment form are on the milestone, and the ocean draws on all three GPU paths. The demo's WebGL2 picture was blocked by an ordering fault rather than by something the picture could not show: the CPU-culled builder culled each view from the turn before its own, so a reflection that waited recorded a pass with no objects and resolved its clear color, and the sea lost its mirror. The cull now moves the views' turns on first, and the rule is recorded: a view's turn must advance before anything culls against it. The mirror keeps its image at cadences of two, three and four, and the every-frame reflection picture is byte-identical before and after the fix (0 of 230,400 bytes differ). The six demo pictures hold in both reference sets. The 833 ms frame against 158 without was the graph's recompile from switching the pass, not the ocean's draws: with the pass carrying its cadence the page held 60.01 frames a second and a 16.7 ms frame in all three states at 1920 by 1080 on WebGL2 at Low, at a one-minute load of 7.7, against 1.21 frames a second with the pass switched. No cost per preset is stated. The transform's grid and bands do not change with the preset, so one figure would answer all four; the GPU timer names its fifteen passes as one compute step; the on-and-off difference read a median of -0.105 ms with a 2.223 ms spread on WebGPU in a quiet window, so the chain sits inside the frame's own spread; and the WebGL2 quiet window closed after ten minutes of a load at 8 or more. The add-on's gates pass, with zero bytes allocated per frame at every preset and its shader sets over the 58 KB figure, which the owner ruled a warning",
	'M3-A11':
		'measured on both paths at every preset; it does not beat the presets, so it stays behind the internal setting and does not ship (D-206). Its black-capture and bind-group faults are fixed, its shader file still loads on first use, and that first-use case is now tested on both paths',
	'M3-D5': 'the layout that D-173 settled, which the traffic lanes add-on follows',
	'M3-R23':
		'the depth-only prepass is the default and passes the bar on the iPhone 18 Pro at both scales and on the iPad 10 at half scale; the iPad 10 at full scale reads 0.52 and 0.64 ms against the 0.5 ms bar, and the owner ruled that margin accepted (D-269)',
	'M3-R19':
		"the second step costs 2.96 to 2.99 ms of a 6.14 to 6.23 ms frame at half the scale on the cloud iPad, and 3.71 to 4.16 ms on the High preset's canvas; the first addendum's 20.5 to 34.9 ms was the frame's tail, since the engine folds every pass after the seventh into it. The held pair of 34.6 against 29.7 frames a second and 22.56 against 27.56 ms has no run file, and this reading's cells bracket its GPU times. The gate commit's 36.1 frames a second lies inside the 29.6 to 36.2 spread three runs gave at one code state, and the head's 29.0 sits 0.6 below its floor, so the second step is not shown to cause S5's drop (D-236)",
};

/**
 * Why a task whose work is on the branch is still unticked: the gap that the branch's audits found
 * between the task's own "Done when" and what the branch holds. These win over the note above,
 * because both describe the same task and only one of them can be true.
 */
const AUDIT_GAPS: Readonly<Record<string, string>> = {
	'M3-C1':
		"the demo draws on every path except its software references, which D-277 still lists as pending a CI run, and the owner accepted its look and its rates, but the task's Done-when asks for all four of its targets to be met and recorded, and three of them have no record. The Mac at High at DPR 2 has no record at all: the only Mac Skyway record draws Low. No record answers the no-frame-over-50-ms target, since the records give a 95th percentile and never a maximum or a 99th. Flat memory over a 60-minute run has no record, as no Skyway record mentions memory or a long run. The fourth target, 60 fps on the iPad and S24-class phones, is measured and ruled: 56.9 and 58.9 with the owner's acceptance in D-277. The tick came from `af7801907`, whose own message claims only the owner's look and the frame rate, so the three unproven rows have never been waived by name",
	'M3-C2':
		"the showroom draws and drives, its wheels turn forward on both sides with a contact-point test that fails on the inverted sign, the lamps are recorded honestly as one capture on one path with the sparkle traced to the paint, both reference sets hold its pictures, and the owner approved the nose's flake and clear-coat look. What keeps the task open is its rate: the owner kept the 60 fps bar for the tablet, and the demo does not hold it. The iPad Pro 13 reads 47.4 fps on the newer path and 57.7 on the older one at Low, and the older figures of 11.8 cold and 23.3 warm against 52.7 predate `20f4525b6`, which gave a lowered preset its own anti-aliasing. How the rest of the remaining difference divides between the path, the demo and the device's state is inferred rather than measured, as the 2 November demo record says, so no split figure is stated here",
	'M3-B1':
		"the whole look is costed at every preset on WebGPU and in compatibility mode, 3.13 to 3.91 and 3.12 to 3.82 ms at the 33-megapixel canvas, and all eight of those cells keep their range above zero. What remains is narrower: each mark is costed at the highest preset its path allows rather than at every preset, WebGL2 keeps no whole-look figure and its sharpening cell does not resolve, and the compatibility fringes' range crosses zero from -0.080 to 0.417, so that cell cannot be told apart from no mark. The earlier run at four times the pixels could not tell a mark from the frame's own variation, and that reason no longer stands",
	'M3-V11':
		"the swap landed at `10d91fda8`, and both picture sets are redrawn at this branch's head: the 12 Mac Creek pictures pass 12 of 12 against references this branch drew, and the 12 software ones pass 12 of 12 against a local drawing recorded with its reason, which CI's next run replaces (D-238). What stands open is the owner's look review. The iPad row of the plan is also owed, and its two stalled sessions now have a lead: a cold shader compile, which another branch bisected. The branch drew the Creek's plants at `10d91fda8`, and that commit's footers wrap a value onto a line with no indent, so git read no trailer block on it; the evidence and the pictures are now carried by a later commit with a proper block. It is also short of content rather than only of pictures: the task's own What line and the vegetation design's species list name maple and hemlock on north faces and pine on the dry south faces, and the valley grows none of the three, growing oak, beech, birch, willow, alder, hosta, sedge and rush with conifer, fern and shrub from the built-ins, and no rule favours a north face, since beech stands where the text gives maple; no record revises that line, so either the three species are grown or the owner or the designer revises the design. And the pictures are not final: `feat/vegetation-tree-shapes` changes the plant generator and `plant.wgsl`, so every grown plant changes shape, and when that branch lands all twenty-four Creek pictures must be drawn again",
	'M3-V15':
		"its Done-when asks for picture tests that show a gust crossing a field of cards on all three paths, a held pair that matches on reruns, and a `bun run bench:allocation` that shows no bytes a frame from the wind. Three of those are unproven or contradicted. The picture test exists at 1.0 and 1.6 seconds on all three paths, but the edge change `8435be9d6` came after the last picture run and the task's own evidence says a `bun run test:images -g wind` is owed to redraw whatever it moves. The held pair agrees across the Mac and the software GPU, but no rerun on one GPU is recorded, which is what the clause asks. And `bench:allocation` passes wind budgets of 12 to 64 bytes a frame at seven places against a recorded check-addon figure of 65 to 72, so a run that passes non-zero budgets cannot show no bytes. The fresh checker's reading is that the code is wrong rather than the clause, because rule 1 excepts only objects the browser hands back each frame and a boxed fraction passed between the add-on's own functions is not one; the measurement that settles it is `bun run bench:allocation --wind --no-inline` to find the true call sites, then those values passed as whole numbers and the same switch re-run",
	'M3-V16':
		"its Done-when is met, but its Budget line is not: the governor must hold each preset's D-241 frame ceiling and never fall below that preset's vegetation GPU time. Cells that fail are measured, not missing. The S25's Ultra Creek row reads 516.56 ms against 499.8, and the task's own evidence says that row does not close the ceiling. The iPad's forest reads 65.45 against 54.8 at Medium, 76.14 against 67.1 at High and 84.06 against 71.1 at Ultra. The Tab A9 Plus reads 1,484.12 against 1,268.5 at Low and draws no frame at Medium. The wind's own row holds where it was measured — the S25 settles at its 33.3 ms display floor with one field cycle at 5.8 of its 6.25 ms budget — so the failure is the scene, and only the owner's M3-V14 options settle it. The Mac is unmeasured at every preset, as are the iPad's Creek High and Ultra and its newer path, so the tick waits on the budget and not on a figure",
	'M3-V17':
		"its Done-when asks for the dressed, wind-blown valley within its budgets on the Mac, the iPad and an S24-class phone, its references redrawn in both sets, and the owner's review against the demo quality bar. Three of those are unmet. No Mac Creek frame row exists at any preset; the iPad reads 31.06 ms at Low against the 30.8 ceiling on the older path, with no newer-path row measured and High and Ultra unmeasured; and the S25's Ultra reads 516.56 against 499.8. The software reference set still dates from 29 October and the branch says it is owed to a CI run. No owner review record exists. The tick rests on the `Task:` trailers alone, and the task's own evidence entry calls it a partial delivery, so it is reversed here until the rows and the software set exist and the owner has looked at it",
	'M3-V14':
		"the owner ruled the rows and the budgets, and D-283 records them. Three clauses of the Done-when stand open, so the task cannot tick: the smallest-tier look, a side-by-side that the owner judges and has not named, which is also the tier he cannot tell from the next one up; the cost of each tier on the M5 Max, whose row is owed, while the iPad Pro 13, the Galaxy S25 and the Galaxy Tab A9 Plus measured theirs at this head; and the proof that the chosen rows keep Creek and the forest within D-241's frame ceilings, which cannot be shown while their readers wait on M3-V11 and M3-V12",
	'M3-V8':
		"the hill draws through the add-on on both GPU paths, with a per-tile view cull and a far share that widens the blades it keeps. Creek's two grass fields draw through the add-on with no grass code of its own, the 11 grass tests pass, and the real-GPU pictures hold the look. At Creek's own density on the Tab A9 Plus the cull takes 12.68 ms, 4.0 per cent, back at 2,312 tufts and 36.44 ms, 6.9 per cent, at 6,820; neither row reaches D-241's 208.3 ms High ceiling, and the miss is the grass's: the same page with the grass switched off measures 179.18 ms, 29.12 ms inside the ceiling, so the grass's 126.91 ms at 2,312 tufts and 311.55 at 6,820 carry those rows past it, the budget clause fails and the task stays open on it. Two routes close it and neither is a grass optimisation: the demo's second ambient occlusion pass, 176.36 ms of the 179.18, and the far cover's look The 20,000 tuft hill is a stress case with no ceiling, and its Tab High row is 961.54 ms with the shadows. The iPad's stress rows hold its ceilings, and the S24 gives WebGL2 only, with its two rows inside the S24 class's. The cull applies to the camera and not to the cascades, so every shadow view still draws the whole kept list, which waits on M3-E9's count in near shadow views and M3-V3's graph edge; that is the task's one remaining item, and Creek's whole frame is M3-V11's",
	'M3-X1':
		"held open by its own line: M3-V11 owes the Creek pictures a redraw and the GPU check, so the rule that a redraw moves its references in the same change is not yet met, and the demo budgets do not hold, though narrowly: the Skyway demo reads 56.9 frames a second on the iPad Pro 13 at Low on the newer path and 58.9 on the Galaxy S24 Plus at Low on the older one, both just under the 60 target. The cloud S24 cannot answer the target at all, because its display runs at 30 Hz and caps every figure at 30; its 1 November run holds 29.4 of that 30 at the chosen preset, so the phone-class answer is the S24 Plus's 58.9",
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
