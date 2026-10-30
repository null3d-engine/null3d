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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASK_EVIDENCE } from './task-evidence.ts';

/** The milestone pull request, its title, and the plan that lists its tasks. */
const PR = '549';
const TITLE = 'feat: the 0.2 release work for level of detail, effects, add-ons and vegetation';
const PLAN = '.internal/plan/m3-breakdown.md';
const BASE = 'origin/main';

/** Tasks whose work is partly on the branch: the part that landed, and the part that remains. */
const PARTIAL: Readonly<Record<string, string>> = {
	'M3-C1':
		"the scene, its lanes, rain and the hero car are in, and so are the moods (`createMoods` in the skyway sketch) and the instances demo, which is registered and built on the traffic-lanes add-on. What remains is the owner's look approval: the device records are drawn, the iPad Pro 13's in `20261024-081340-skyway.md` and the Galaxy S24's beside it",
};

/** Tasks whose work is on a helper branch, whether or not part of it has reached this branch. */
const ON_BRANCH = new Set(['M3-F9']);

/** A task that a commit names, but that the audit of the branch found unfinished. */
// The branch's audits read every ticked task against its own "Done when" and its section's rule.
// A tick states that the task is done, so a task those audits found short of its own line is not
// ticked here until the gap closes, whatever code it already has.
const INCOMPLETE = new Set([
	'M3-F5',
	'M3-B1',
	'M3-B5',
	'M3-F2',
	'M3-K9',
	'M3-V6',
	'M3-E8',
	'M3-R22',
	'M3-L4',
	'M3-V5',
	'M3-R19',
	'M3-E1',
	'M3-F14',
	'M3-K3',
	'M3-V3',
	'M3-K2',
]);

/** Tasks whose outcome a reader needs told, beyond the plan's own line. */
const NOTES: Readonly<Record<string, string>> = {
	'M3-F5':
		"the owner rejected the look and withdrew the earlier approval, because the water showed sideways lines amid the flow, and the Creek now draws its own water again, flowing with the river: each wave direction turns by the stream's local angle, the crests are kept, and the phase is carried in the moving frame. The close 640 by 360 picture is what guards that look, since the 320-wide bank views draw the stream as a ribbon a few dozen pixels across. The migration waits until the add-on follows the current the same way. The add-on moved the phase, the foam drift and the caustics onto a current vector read from the river mesh's texture coordinates instead of the old fixed flow, took the thickness from the screen-space depth copy instead of the analytic bed, and made the shore a soft alpha ramp",
	'M3-K9':
		'the budget raise it needed is landed and its shader build now passes, but the task itself is not in: its branch is not merged with the head, it has no judged speed line over the final tree, and its Done-when asks for the cost per extra light on an iPad and an S24-class phone, which no device row covers yet',
	'M3-A8':
		"the evidence measures the worst error at 2.03 of an 8-bit step at a saturated yellow, over the prototype's one-step tolerance. The owner accepted that cost and ruled that the display table stays and the light table comes out",
	'M3-E6':
		"both first users follow the preset: splats' budget, and the water add-on's reflection cadence, which doubles the wait at each frame-budget step up to every sixteenth frame. The overlay now lists the GPU time of each step of the frame and fills an add-on's row from the render passes that its description names, which the water add-on uses for its reflection pass; a feature whose work records inside the engine's own pass reads gpu not measured, as splats does on every path (D-267)",
	'M3-E8':
		"the compute pass and its WebGL2 fragment form are built and tested, and the wind add-on fills its field through the hook with a compute pass. The owner's 25 October ruling adds M3-V13's history to the hook, and the first-user outcome the plan names still waits on M3-F9's ocean",
	'M3-R22':
		"the shader cache on the branch is D-248's change, not this task's: it reuses every entry when a compiler change leaves the compiled program identical, 0 compiled and 79 reused in 19 s, where the same change cost an hour. The task's own change, three entries instead of four for every module kind, is on `feat/m3-r22-entry-set` and not on this branch, and the determinism list here still holds `lit`; the two checks' CI times remain unmeasured",
	'M3-E1':
		"unticked by the 29 October audit: the entry gained a rule-42 bullet that the tick never covered. The particles add-on's birth records are still written one per birth per frame on the sketch thread, and the engine's particle buffer gives them a Rust home",
	'M3-F14':
		"unticked by the 29 October audit: the entry gained a rule-42 bullet that the tick never covered. The per-frame terrain work, the quadtree select and the block build, is still in TypeScript and there is no terrain crate; that work is also what M3-R39's new bullet hands here by name, so R39 stands and this carries it",
	'M3-K3':
		"unticked by the 29 October audit: the owner's 26 October ruling is that cookies take any texture and larger sizes, and the head still resamples to 128 by 128 and takes pixels only",
	'M3-V3':
		'unticked under the policy this branch now states rather than by its own clause: no public behaviour may be reachable by nobody. The pick build of a compute-driven vertex offset is in its What bullet, and nothing takes it: no unit test, no browser test and no example. The owner may reverse this one without touching the others',
	'M3-K2':
		'unticked under the same policy: drag controls are exported and reached by no unit test, browser test, picture or example, because the gizmos picture and its spec reach only the transform controls',
	'M3-F3':
		"dropped with the temporal resolve it waited on (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F10':
		"dropped with the temporal resolve it needs (D-206), so it is cancelled rather than open work; M3-A11's own record made the call, not the owner, and hard rule 39 may apply, so the owner may want to see it",
	'M3-F9':
		"the simulation, the material and the older path's fragment form are on the local branch `feat/m3-f9-fft-ocean`, thirteen commits ahead of the milestone and pushed, so a reader can find them; the engine buffer-id fault it found has landed separately. The older path's cost is found and fixed on that branch: its 833 ms frame against 158 without was not the ocean's draws but the add-on switching the pass off and on every other frame, which made the engine compile its plan every frame; a pass that carries its cadence without being switched holds 60 frames a second. What remains is the quiet-window figure and the merge. The demo entry is held because its picture on that path would record a flat sea. No cost per preset is stated: two runs of identical work differed by more than the effect, so the frame-difference method cannot resolve a sub-millisecond chain",
	'M3-A11':
		'measured on both paths at every preset; it does not beat the presets, so it stays behind the internal setting and does not ship (D-206). Its black-capture and bind-group faults are fixed, its shader file still loads on first use, and that first-use case is now tested on both paths',
	'M3-D5': 'the layout that D-173 settled, which the traffic lanes add-on follows',
	'M3-R23':
		'the depth-only prepass is the default and passes the bar on the iPhone 18 Pro at both scales and on the iPad 10 at half scale; the iPad 10 at full scale reads 0.52 and 0.64 ms against the 0.5 ms bar, and the owner ruled that margin accepted (D-269)',
};

/**
 * Why a task whose work is on the branch is still unticked: the gap that the branch's audits found
 * between the task's own "Done when" and what the branch holds. These win over the note above,
 * because both describe the same task and only one of them can be true.
 */
const AUDIT_GAPS: Readonly<Record<string, string>> = {
	'M3-F4':
		"unticked by its check at 652fd235b on `feat/m3-f4-lightmap-evidence`: the captured frame is one side of the comparison rather than the comparison itself, D-258 claims more than that frame settles, not every figure has a recorded run. The evidence entry is written now and names what is owed rather than claiming it: the engine-to-viewer comparison does not exist, and the picture's failure without the direction is unrecorded. The same branch's ae46e947d states the viewer-side limit in D-258 lines 78 to 82 instead of closing it, so the owner has not ruled whether an engine-to-viewer comparison is owed",
	'M3-L4':
		"the owner ruled the three studies run in order, and all three are on the branch, two of them complete. Staged loading came first: whole levels and cluster bands arrive as stages, a band appends to the tree as it lands, and `maxLevels` with the pick-driven holdback serves both. Its load run shows the stages add no delay before the first picture, not that the first picture comes sooner, and its 29.3 per cent after the first picture is a lower bound. The impostors are in, with the card, the two atlases, the three-view blend, the per-copy turn, the bake helper and the vegetation bake with its hand-over band; an iPad Pro 13 costs 7.0 ms a frame for 152 cards, and a Galaxy S24 gave no figure because its path times no pass alone and its display ran at 30 Hz. The audit then found two faults in that work, and the far-tree task M3-V9 fixes both: a turned copy's light turns with the camera's azimuth as well as with the tree's, and the hand-over's two dither phases do not complement, so about a quarter of the band's pixels drop. The vertex morphing is in too: the terrain's pop falls from 0.026 to 0.000 per cent of the frame and the leaves' from 0.634 to 0.036, its judged GPU line reads the same on all four pages, and nine of nine pages pass on an iPad Pro 13 in Safari 26.6.1 and on a Galaxy S25 in Chrome 152, whose 30 Hz display is why its interval is not a cost",
	'M3-R19':
		'the iPad ran at High with the governor on rather than at the pinned scale, and no comparison with the earlier pair was made',
	'M3-B1':
		"the re-run at four times the pixels does not resolve the cost either: its off side reads 2.72 to 5.03 ms on WebGPU and 4.69 to 9.21 ms on WebGL2 across the presets, and the grade mark alone reaches 11.234 ms there, more than most marks cost, so the scene's own variation still swamps the look, and the GPU idles through most of each frame. Seven of the twenty-one marks keep their whole range above zero but that is not resolution: WebGL2 grain is 0.38 with a range to 9.40 and WebGL2 vignette 1.16 with a range to 5.90, and the WebGPU presets read Low 2.00, Medium 3.41 and Ultra 1.27, out of order for the same work. The method to close it: draw the look, or one mark, sixteen to thirty-two times a frame and divide; on WebGPU read the look's own pass from the per-pass timer (0.065536 ms steps), not the whole frame's difference; and alternate the sides every frame or few frames so a clock change hits both. Grade and vignette run inside the final pass and add no pass, so read that pass's part with each on and off, or state the design reason and show the part unchanged within a step. WebGL2's whole-frame figure spans the shared timeline, so those rows need another measure or must say they are not a cost",
	'M3-B5':
		'the glints draw and are tested in both sets; its cost per preset is owed (D-255), which needs a quiet GPU',
	'M3-F2':
		"the cloud that arrives as 100,000 splats used to become one chunk and could not stream; `chunks.ts` now cuts it into up to eight, which landed in `dcbacc193`. The streaming test's last recorded CI failure predates that change and no pass has been recorded since, so the fix is in the tree and unproved",
	'M3-V6':
		'the same placement is shown on two Android phones in Chrome and on an iPad in Safari 26.6.1, so a second JavaScript engine has placed the same points (`.dev/tested-devices/ipad-pro-13-safari/20261027-000756-vegetation-scatter.md`, two passed, both paths); the ground maps use trigonometry and a fractional power whose rounding can differ between engines. No placement budget is stated for the section, and the Mac figure has no raw record',
	'M3-V5':
		"every vegetation picture passes in both reference sets on both GPUs and the crowns keep their coverage at three distances, and the leaf cells now hold a spray of lobed, veined, damaged leaves instead of one smooth shape. Its author's verdict is that the atlas is at least as good as Creek's as a texture, and that the crown is still paler and flatter because the material lights it with one uniform light while Creek's texture carries painted shadowing, which belongs to M3-V7. The task's line asks the owner to judge the two side by side, and the paint time per device is owed too",
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

/** Every task ID that a kept commit's `Task:` trailer names, once that commit built something. */
function landedTasks(): Set<string> {
	// A record-only commit claims a task without building any of it, so it must not read as work
	// that landed with its evidence still owed: that reads to a maintainer as a finished feature
	// whose proof is missing. Only a commit that touches a file outside the records counts.
	const out = git('log', '--format=%x1e%H%x1f%b', `${BASE}..HEAD`, '--name-only');
	const out2 = out.split('\x1e').map((chunk) => {
		const [header = '', body = ''] = chunk.split('\x1f');
		const lines = body.split('\n');
		// A trailer claims a task. A body that mentions an ID in prose, such as a
		// `Docs-Checked:` line, must not tick it, or a task that no commit names in a trailer reads
		// as ticked.
		const claimed = lines.filter((line) => /^Task:\s/.test(line)).join('\n');
		const files = lines.filter((line) => /^\S+\/\S*$/.test(line) && !/^Task:/.test(line));
		// A test file is code wherever it lives: the guard test for a tool sits beside the tool, and
		// without this a task whose whole work is a test in `tools/` could never land.
		const built = files.some(
			(file) =>
				CODE_ROOTS.some((root) => file.startsWith(root)) || /\.(test|spec)\.[jt]s$/.test(file),
		);
		return built || header === '' ? claimed : '';
	});
	const claimed = out2.join('\n');
	return new Set(claimed.match(/M3-[A-Z0-9]+[a-z]?/g) ?? []);
}

/** Each task of the plan, in its order, with the name it was given. */
function planTasks(): { id: string; name: string }[] {
	const text = readFileSync(PLAN, 'utf8');
	// A plan entry that names a closed investigation rather than work is not a task, and counting
	// it among the open ones says the milestone has work it does not have.
	const NOT_TASKS = new Set(['M3-R37']);
	return [...text.matchAll(/^(M3-[A-Z0-9]+[a-z]?) (.+?)(?: \(P.*)?$/gm)]
		.filter((match) => !NOT_TASKS.has(match[1] as string))
		.map((match) => ({
			id: match[1] as string,
			name: (match[2] as string).trim(),
		}));
}

function description(): string {
	const tasks = planTasks();
	const landed = landedTasks();
	const done = ({ id }: { id: string }) =>
		landed.has(id) &&
		!PARTIAL[id] &&
		!ON_BRANCH.has(id) &&
		!INCOMPLETE.has(id) &&
		!(id in AUDIT_GAPS) &&
		id in TASK_EVIDENCE;
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
			const done =
				landed.has(id) &&
				!PARTIAL[id] &&
				!ON_BRANCH.has(id) &&
				!INCOMPLETE.has(id) &&
				!(id in AUDIT_GAPS) &&
				id in TASK_EVIDENCE;
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

function main(): void {
	if (!existsSync(PLAN)) {
		console.error(`pr-status reads the plan at ${PLAN}, which this clone does not keep.`);
		process.exit(1);
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
