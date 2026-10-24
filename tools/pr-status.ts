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
	'M3-T1': 'the measured fence is in; the trim is on its branch',
};

/** Tasks built on a helper branch, with nothing of them on this branch yet. */
const ON_BRANCH = new Set(['M3-A3', 'M3-B4', 'M3-E9', 'M3-R14']);

/** A task that a commit names, but that the audit of the branch found unfinished. */
const INCOMPLETE = new Set([
	'M3-B1',
	'M3-D9',
	'M3-E2',
	'M3-E4',
	'M3-E6',
	'M3-E8',
	'M3-E10',
	'M3-F2',
	'M3-L1',
	'M3-L3',
	'M3-L4',
	'M3-R12',
	'M3-R13',
]);

/** Tasks whose outcome a reader needs told, beyond the plan's own line. */
const NOTES: Readonly<Record<string, string>> = {
	'M3-A9':
		'the hero tile and its cost figures are in: a still hero adds no pass, a moving one adds a depth pass of 0.028 to 0.037 ms, and WebGL2 reads the tile for 0.27 ms less than the cascades (D-219)',
	'M3-E2':
		"the task hook and the splats add-on's distance selection run on the job workers on both paths; the allocation check the task asks for is missing",
	'M3-E4':
		"the depth input is built and splats mix with meshes by depth; water's soft shores, the task's first user, are not on the branch",
	'M3-E6':
		"splats' budget follows the preset and reaches the overlay; water's reflection cadence, the other first user, is not on the branch",
	'M3-E8':
		"the compute pass and its WebGL2 fragment form are built and tested; the first-user outcome waits on M3-F9's ocean, because the splats add-on cannot take the hook",
	'M3-E10':
		"the sky layer's template, ids and sizes are in place but unregistered; the example add-on that draws a sky layer, the task's first user, does not exist",
	'M3-F2':
		'the add-on, both file kinds, depth mixing and the pictures on both paths are in; its streaming within budget on the iPad and an S24-class phone is not recorded',
	'M3-B1': 'the lens kit has no picture test and no cost per preset',
	'M3-D9':
		'the command and its refusal of an add-on that imports the engine internal entry are tested; no recorded run holds it over every foundation add-on',
	'M3-L1':
		'every item is built with its pictures, but D-211 records Mac figures alone: the phone GPU time the fade item asks for, and the iPad and phone figures the section asks for, are missing',
	'M3-L3':
		'the WebGPU path draws the patches, but D-213 records the WebGL2 multi-draw path, the whole-level fallback and the GPU time as not built',
	'M3-L4': 'the impostor cards are done; staged loading, coarse first, is not',
	'M3-F3':
		'dropped with the temporal resolve it waited on (D-206); the owner may change the ruling',
	'M3-F10': 'dropped with the temporal resolve it needs (D-206); the owner may change the ruling',
	'M3-R12': 'the build compiles only the listed permutations; the time and size are not recorded',
	'M3-R13': 'the fallbacks exist; no test names the three checks the task asks for',
	'M3-A11':
		'measured on both paths at every preset; the resolve does not beat the presets, so TAA does not ship (D-206)',
	'M3-D5': 'the layout that D-173 settled, which the traffic lanes add-on follows',
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
					: INCOMPLETE.has(id) || NOTES[id]
						? NOTES[id]
							? ` — ${NOTES[id]}`
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
				!NOTES[id],
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
