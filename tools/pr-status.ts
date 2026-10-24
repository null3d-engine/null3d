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
	'M3-B1',
	'M3-E6',
	'M3-E8',
	'M3-L1',
	'M3-L3',
	'M3-R12',
	'M3-R22',
	'M3-E7',
	'M3-L2',
	'M3-L4',
	'M3-A1',
	'M3-A2',
	'M3-A8',
	'M3-A9',
	'M3-A10',
	'M3-A11',
	'M3-B5',
	'M3-D7',
	'M3-D8',
	'M3-R1',
	'M3-O1',
	'M3-G1',
	'M3-G2',
	'M3-G3',
	'M3-K6',
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
		"splats' budget follows the preset and reaches the overlay; water's reflection cadence, the other first user, is not on the branch",
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
	'M3-R12': 'the build compiles only the listed permutations; the time and size are not recorded',
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
		'the memory figure is a 40,000-ball test on the main view alone, and no GPU time was taken on the Mac, an iPad or a phone-class device',
	'M3-L4':
		'the vertex-morphing study has no decision record and nothing of it is built, the impostor blend has no measurement, and no iPad, phone or GPU-time figure exists',
	'M3-A1':
		'`scene.pick` returns no texture coordinates; raycasts and pointer events do, so the pixel-exact pick is short of the task',
	'M3-A2': "the refresh's cost rows are all owed, the Mac's included",
	'M3-A8':
		'the shipped design is a display-color table with no tone curve, which replaced the HDR input D-199 has the owner approving',
	'M3-A9':
		"the 4x shadow detail holds only for an object up to 1.8 m on High, and the costs were taken at loads of 13.6 to 26.3 against the spec's own limit of 8",
	'M3-A10': 'no GPU cost was taken on an iPad or a phone-class device',
	'M3-A11':
		'five of the six study fixes that D-199 made test cases were never built or tested, and fog jitter and thin rain are untested',
	'M3-B5':
		"the flakes are one random tilt per cell rather than the plan's glints, and no cost per preset is recorded",
	'M3-B6': 'the real-light option lights a fixed share of the cars, not the nearest ones',
	'M3-E10':
		'a sky layer draws into neither the environment map nor the CPU sky light, and D-242 drops both without a ruling',
	'M3-D7':
		'the link check runs before the texture-unit count, so an over-budget material gives a plain link error rather than the E1209 the docs promise',
	'M3-D8': 'two add-ons that declare one name with the same fields share a namespace silently',
	'M3-R1':
		'the depth-of-field test runs on no GPU path, and no adapter can take a full-screen feature yet',
	'M3-O1': 'the test runs only in Chromium on Linux, with no Safari or Firefox run on record',
	'M3-G1': "the Khronos sample's texture-transform pointers are not animated",
	'M3-G2': 'no Khronos iridescence sample is tested',
	'M3-G3': 'no Khronos anisotropy sample is tested, and anisotropy with no texture draws with none',
	'M3-K6':
		'on the HDR path, the default on most devices, a material with tone mapping off still goes through the tone curve',
	'M3-R2': 'the stress test has not run on an iPad or a phone-class device since the change',
	'M3-R3': 'no 5% match is shown for the upload arenas or the shadow casters',
	'M3-R4': 'D-247 does not compare frame time, and the Mac GPU figure is owed',
	'M3-R19':
		'the iPad ran at High with the governor on rather than at the pinned scale, and no comparison with the earlier pair was made',
	'M3-R21':
		'the picture step does not read the heavy-test jobs, so the screens and skyway pictures are not gated; the fix is on a helper branch',
	'M3-E7':
		"the lobe hook is landed and its wrong signature is refused, but the task's proof is car paint's glints, which are on a branch with their pictures still owed",
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
