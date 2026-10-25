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
		'the scene, its lanes, rain and the hero car are in; the moods, the instances demo and the device figures remain',
	'M3-T1':
		"the measured fence is in and the trim landed and was then reverted with a record: moving the fog write, the picks and the events out of the start cost more bytes than it saved, so the start stays at about 190 KB against this task's 160 KB target. That target predates the owner's decision to raise the start's budget to 187 KB, so the task needs the owner's word on whether it still means anything",
	'M3-B4':
		'the rain streaks, the storm over any hour and the lamp-following city lights are in the Skyway demo; the wet-surface helper, the windshield drops and the particles link remain',
};

/** Tasks built on a helper branch, with nothing of them on this branch yet. */
const ON_BRANCH = new Set(['M3-E9', 'M3-R14', 'M3-V2']);

/** A task that a commit names, but that the audit of the branch found unfinished. */
// An audit of the branch on 24 October 2026 read every ticked task against its own "Done when" and
// its section's rule. A tick states that the task is done, so a task that audit found short of its
// own line is not ticked here until the gap closes, whatever code it already has.
const INCOMPLETE = new Set([
	'M3-B2',
	'M3-B3',
	'M3-B5',
	'M3-E7',
	'M3-V4',
	'M3-D7',
	'M3-D9',
	'M3-F2',
	'M3-G1',
	'M3-K4',
	'M3-R16',
	'M3-R17',
	'M3-R20',
	'M3-E2',
	'M3-E4',
	'M3-K3',
	'M3-A10',
	'M3-E10',
	'M3-V6',
	'M3-B1',
	'M3-E4a',
	'M3-F5',
	'M3-E6',
	'M3-E8',
	'M3-L1',
	'M3-L3',
	'M3-R12',
	'M3-R22',
	'M3-L2',
	'M3-L4',
	'M3-A2',
	'M3-A8',
	'M3-A9',
	'M3-V5',
	'M3-A11',
	'M3-R1',
	'M3-O1',
	'M3-G2',
	'M3-G3',
	'M3-R2',
	'M3-R3',
	'M3-R4',
	'M3-R19',
	'M3-R21',
	'M3-V1',
	'M3-V3',
]);

/** Tasks whose outcome a reader needs told, beyond the plan's own line. */
const NOTES: Readonly<Record<string, string>> = {
	'M3-A9':
		'the hero tile and its cost figures are in: a still hero adds no pass, a moving one adds a depth pass of 0.028 to 0.037 ms, and WebGL2 reads the tile for 0.27 ms less than the cascades (D-219)',
	'M3-E6':
		"both first users follow the preset: splats' budget, and the water add-on's reflection cadence, which doubles the wait at each frame-budget step up to every sixteenth frame. The overlay part of the task is not built: D-199's decision 4 asks for one GPU timing scope per built-in step and per add-on feature, and D-173 for each add-on's GPU time, while the add-on rows hold no GPU time and the overlay shows one frame total",
	'M3-E8':
		"the compute pass and its WebGL2 fragment form are built and tested; the first-user outcome waits on M3-F9's ocean, because the splats add-on cannot take the hook",
	'M3-B1':
		'the pictures hold every lens mark now, and the streak and grain ones were tightened after they proved nothing at the default threshold: each mark moves about 2.8 per cent of the pixels against a half per cent limit. The cost per preset is still owed — it needs a machine idle enough for a quiet timing run, and the fleet has not given one since this morning',
	'M3-D9':
		'the command and its refusal are tested, and the two gate faults its first runs found are fixed: the size gate held compiled shader-build files to the code budget, and the fixture sketch never moved so no frame drew. D-225 records the run over every foundation add-on that has a package, and both fixtures, including three-compat, whose entry the size fix brought from 181.9 KB to 27.8 KB',
	'M3-L1':
		'every item is built with its pictures, but D-211 records Mac figures alone: the phone GPU time the fade item asks for, and the iPad and phone figures the section asks for, are missing',
	'M3-L3':
		'the WebGPU path draws the patches, but D-213 records the WebGL2 multi-draw path, the whole-level fallback and the GPU time as not built',
	'M3-R22':
		"the shader cache now reuses every entry when a compiler change leaves the compiled program identical: 0 compiled and 79 reused in 19 s, where the same change cost an hour, and a real shader change compiles exactly one. The task's own done-when is the two checks' times in CI, which are still unmeasured",
	'M3-E9':
		"the engine half is built and CI has compared its pictures: the count word reaches the main view's indirect entry after the last compute dispatch, an unculled draw reads the add-on's rows and draws that count, and the compute picture fills no row on the CPU. What the task still wants: a first user, since the splats cannot take the hook and V8's blade path is the one in sight; GPU counts in the shadow views, which today take the page's count; and the allocation check and the no-draw-before-ready test from its design note",
	'M3-F3':
		'dropped with the temporal resolve it waited on (D-206); the owner may change the ruling',
	'M3-F10': 'dropped with the temporal resolve it needs (D-206); the owner may change the ruling',
	'M3-R12':
		'the narrowing is not on the branch at all. It exists only on an unlanded branch from 23 October, and there it stops recording before the scene builds its own pipelines, strips the device bits the build compares, and drops the empty word that compute and full-screen passes need. Whatever the list then holds is not the set the pages draw with, so a narrowed build fails at the first pipeline it lacks rather than compiling the wrong thing quietly. A helper is proving each fault, and no time or size figure exists yet',
	'M3-A11':
		'measured on both paths at every preset; it does not beat the presets, so it stays behind the internal setting and does not ship (D-206). Its black-capture and bind-group faults are fixed, its shader file still loads on first use, and that first-use case is now tested on both paths',
	'M3-D5': 'the layout that D-173 settled, which the traffic lanes add-on follows',
};

/**
 * Why a task whose work is on the branch is still unticked: the gap that an audit of 24 October
 * 2026 found between the task's own "Done when" and what the branch holds. These win over the note
 * above, because both describe the same task and only one of them can be true.
 */
const AUDIT_GAPS: Readonly<Record<string, string>> = {
	'M3-L2':
		"the file's levels share their vertices but are not ordered coarsest first, so a coarse level names vertices spread through the whole buffer; the Mac has no GPU time under the fade rule, only the 11 October table that predates it; and the phone rows are frame interval and CPU time, because the S24 has no WebGPU adapter and no WebGL2 GPU timer",
	'M3-L4':
		'the vertex-morphing study has no decision record and nothing of it is built, the impostor blend has no measurement, and no iPad, phone or GPU-time figure exists',
	'M3-A2': "the refresh's cost rows are all owed, the Mac's included",
	'M3-A8':
		'the shipped design is a display-color table with no tone curve, which replaced the HDR input D-199 has the owner approving',
	'M3-A9':
		"the 4x shadow detail holds only for an object up to 1.8 m on High, and the costs were taken at loads of 13.6 to 26.3 against the spec's own limit of 8",
	'M3-A11':
		'five of the six study fixes that D-199 made test cases were never built or tested, and fog jitter and thin rain are untested',
	'M3-E10':
		'the owner ruled that a sky layer reaches both the environment map and the CPU sky light; the work is built on a helper branch and not yet on this branch, and the aurora references and the new picture have not been made',
	'M3-R1':
		'the depth-of-field test runs on no GPU path, and no adapter can take a full-screen feature yet',
	'M3-O1': 'the test runs only in Chromium on Linux, with no Safari or Firefox run on record',
	'M3-G1':
		"the engine keeps one texture transform per material, so a clip that moves a base colour or emissive map also moves that material's still maps, where three.js keeps a transform per texture; the comparison passes because it reads the animator's sampled values and never the material",
	'M3-G2': 'no Khronos iridescence sample is tested',
	'M3-G3': 'no Khronos anisotropy sample is tested, and anisotropy with no texture draws with none',
	'M3-R2': 'the stress test has not run on an iPad or a phone-class device since the change',
	'M3-R3': 'no 5% match is shown for the upload arenas or the shadow casters',
	'M3-R4': 'D-247 does not compare frame time, and the Mac GPU figure is owed',
	'M3-R19':
		'the iPad ran at High with the governor on rather than at the pinned scale, and no comparison with the earlier pair was made',
	'M3-R21':
		'the picture step reads the heavy-test jobs now, but the task is done only when the gate and CI give the same verdict on the screens and skyway pictures, and that comparison is being taken against a run of the current tip',
	'M3-B2':
		"the task's finish line needs the material's cost per GPU path and preset, and its own record says that cost is owed: the machine stayed above a load of 100 while the add-on was built",
	'M3-B3':
		"the Showroom tablet the task names is M3-C2's work, which is not built, and the screen demo's software-GPU pictures fail CI",
	'M3-B5':
		'the glints draw and are tested in both sets; its cost per preset is owed (D-255), which needs a quiet GPU',
	'M3-E7':
		"its finish line needs the car paint's glints to use the lobes; the glints draw now (D-255), and the record does not yet say whether the hook needs a general lobe form rather than the add-on's own",
	'M3-V4':
		'no device has timed the new generator, so the device figures are of the stand-in it replaced; no Mac, iPad or S24 GPU or memory figure exists, no check-addon run is recorded, and the software-GPU species pictures fail in CI',
	'M3-D7':
		'no test add-on or material reaches E1209: the browser test uses an internal entry, and it fails in CI because the software GPU accepts the program it builds',
	'M3-D9':
		'no record shows the listing check passing on vegetation, and its one run skipped the shader and size checks',
	'M3-F2':
		'a 100,000-splat cloud becomes one chunk and cannot stream, and the streaming test fails in CI',
	'M3-K4': "one of three.js r186's seven CSS3D examples is ported, and only its first layout",
	'M3-R16': 'no project made from the template is installed, built and used with the hook on',
	'M3-R17':
		"the evaluation's own record says it does not reach the gate, and the skill text it evaluates differs from the pinned version",
	'M3-R20': 'the record gives 1.25 to 2.42 seconds against a finish line that asks for under one',
	'M3-E2':
		'its finish line was rewritten to match the build without an owner ruling, and that ruling is still open',
	'M3-E4':
		"whether the approved hook table stands against hard rule 8 is the owner's to decide, and the tick waits on that",
	'M3-K3':
		"the spot-map picture covers the cookie on every path and passes; what remains is the owner's call on whether a 128 by 128 pixels-only cookie looks good enough, which the better-look rule raises",
	'M3-A10':
		"the finish line asks for the S24+, and the S24 run gives only a frame time held at its 30 Hz limit, which its own run file marks unreliable; the S25 is a faster GPU of another make on a path the S24+ lacks, so whether it closes the line is the owner's call. CI's five software sharpen references also show no sharpening at all, so the picture does not hold the effect it claims",
	'M3-V6':
		'the same placement is shown only on two Android phones in Chrome, so no second JavaScript engine has placed it, and no iPad run exists; the ground maps use trigonometry and a fractional power whose rounding can differ between engines. No placement budget is stated for the section, the Mac figure has no raw record, and docs/api/vegetation.md still calls the scatter not built',
	'M3-E4a':
		'the material change is on the branch with the water work, but the task asks for a material that declares the scene depth beside two textures on WebGPU, compatibility and WebGL2, and for the cost of a material that reads neither; its helper is finishing that proof',
	'M3-F5':
		'the water add-on, its records and its demos are on the branch, but twelve of its reference pictures are not drawn, so the picture-reference check fails; its evidence line waits on those pictures',
	'M3-V5':
		"every vegetation picture passes in both reference sets on both GPUs and the crowns keep their coverage at three distances, and the leaf cells now hold a spray of lobed, veined, damaged leaves instead of one smooth shape. Its author's verdict is that the atlas is at least as good as Creek's as a texture, and that the crown is still paler and flatter because the material lights it with one uniform light while Creek's texture carries painted shadowing, which belongs to M3-V7. The task's line asks the owner to judge the two side by side, and the paint time per device is owed too",
	'M3-V1':
		'Creek has no WebGPU figure on any device, and no vegetation task after it has its own budget per preset',
	'M3-V3': 'the Mac, iPad and phone GPU time and memory are not recorded',
};

/** The plan's groups, by the first letter of a task's part, in the plan's order. */
const GROUPS: readonly (readonly [string, string])[] = [
	['Level of detail', 'L'],
	["The study's follow-ups", 'ABC'],
	['Add-on platform and hooks', 'DE'],
	['Effects and techniques', 'F'],
	['glTF and API', 'GK'],
	['Shipping', 'OT'],
	["The study's tasks", 'R'],
	['Vegetation', 'V'],
	['Demos', 'X'],
];

const git = (...args: string[]) =>
	execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every task ID that a kept commit's `Task:` trailer names. A split task keeps a lower-case tail. */
function landedTasks(): Set<string> {
	const out = git('log', '--format=%b', `${BASE}..HEAD`);
	// Only a trailer claims a task. A commit body that mentions an ID in prose, such as a
	// `Docs-Checked:` line, must not tick it: the audit of 23 October found one task ticked that
	// no commit had ever named in a trailer.
	const claimed = out
		.split('\n')
		.filter((line) => /^Task:\s/.test(line))
		.join('\n');
	return new Set(claimed.match(/M3-[A-Z0-9]+[a-z]?/g) ?? []);
}

/** Each task of the plan, in its order, with the name it was given. */
function planTasks(): { id: string; name: string }[] {
	const text = readFileSync(PLAN, 'utf8');
	return [...text.matchAll(/^(M3-[A-Z0-9]+[a-z]?) (.+?)(?: \(P.*)?$/gm)].map((match) => ({
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
					? ' — on a helper branch'
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
	const owed = landedTasks();
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
