// Times GPU occlusion culling at the Medium preset, off against on, in Chrome for Testing on the
// production builds, without the frame cap: held on in every frame (`occlusion-check=off`), and on
// with its check deciding. Every page waits until the one-minute load falls below 8, and the pages
// of a round run in turns, so the three modes share the machine's state.
// - `--part desert`: the desert and Bistro pages of this folder, each page once a round.
// - `--part island`: the Island at its town view and at the showcase's opening view, from the
//   production build of tests/pages/island-view.html in target/group-culling/island-page
//   (`NULL3D_BUILD_PAGE=island-view bunx vite build --outDir target/group-culling/island-page`).
// - `--part bench`: the repository's benchmark scenes through `bun run bench:run`, one mode after
//   another in each round, each round starting from another mode.
// - `--part repeat --file <results.json>`: every page of that file whose load reached 8, once more.
// `--rounds <n>` changes the rounds (3). Run from the repository's root once `bun run build` and
// `bun run build:cdn --url-switches` are done. Results land in this folder's results/.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const part = opt('--part', 'desert');
const rounds = Number(opt('--rounds', '3'));
const root = join(import.meta.dirname, '../../../..');
const results = join(import.meta.dirname, '../results');
const MAX_LOAD = 8;

/** The modes, as the engine's address switches. */
const MODES = {
	off: 'occlusion=off',
	forced: 'occlusion=on&occlusion-check=off',
	check: 'occlusion=on',
} as const;

/** Runs this folder's runner over `pages`, `rounds` times in turns, into `file` of the results. */
function runPages(pages: string[], file: string): void {
	execFileSync('bun', ['run.ts', '--uncapped', '--runs', String(rounds), ...pages], {
		cwd: join(import.meta.dirname, '../pages'),
		stdio: 'inherit',
		env: {
			...process.env,
			MESHLETS_MAX_LOAD: String(MAX_LOAD),
			MESHLETS_ATTEMPTS: '3',
			MESHLETS_OUT: join(results, file),
		},
	});
}

/** Each page of `bases` once in each mode. */
const inModes = (bases: string[]) =>
	bases.flatMap((base) => Object.values(MODES).map((mode) => `${base}&${mode}`));

/** Waits until the one-minute load falls below the gate, for at most half an hour. */
async function quiet(): Promise<void> {
	const by = Date.now() + 30 * 60_000;
	while (loadavg()[0] >= MAX_LOAD && Date.now() < by)
		await new Promise((resolve) => setTimeout(resolve, 15_000));
}

if (part === 'desert') {
	const desert = (view: string, shadows: boolean) =>
		`null3d.html?view=${view}&models=/models/null3d-final&direct=off&pump=1&warmup=8&seconds=40&preset=medium${shadows ? '&shadows=1' : ''}`;
	const bistro = (view: string) =>
		`null3d.html?scene=bistro&view=${view}&models=/models/bistro/null3d/bistro.glb&direct=off&pump=1&warmup=6&seconds=20&preset=medium`;
	const bases = [
		desert('walk', false),
		desert('walk', true),
		desert('aerial', false),
		desert('aerial', true),
		bistro('street'),
		bistro('wide'),
	];
	runPages(inModes(bases), 'medium-occlusion-desert-bistro.json');
} else if (part === 'island') {
	// The town view is the measuring page's own pose; the default view is the showcase's opening pose.
	// The camera holds still, so `still-camera=off` keeps every frame drawing.
	const island = (pose: string | null) =>
		`tests/pages/island-view.html?preset=medium&warm=25&seconds=15&still-camera=off&direct=off${pose ? `&pose=${pose}` : ''}`;
	runPages(
		inModes([island(null), island('600,280,540,40,80,-40')]),
		'medium-occlusion-island.json',
	);
} else if (part === 'repeat') {
	// Runs again, once each, every page of a results file whose one-minute load reached 8 or more
	// before or after it, into `<name>-repeat.json`, which the table reads in their place.
	const file = opt('--file', 'medium-occlusion-desert-bistro.json');
	const runs = JSON.parse(readFileSync(join(results, file), 'utf8')) as {
		address: string;
		load?: { before?: number; after?: number };
	}[];
	const loaded = runs
		.filter((r) => Math.max(r.load?.before ?? 0, r.load?.after ?? 0) >= MAX_LOAD)
		.map((r) => r.address);
	console.log(
		`${loaded.length} of ${runs.length} runs of ${file} ran at a load of ${MAX_LOAD} or more`,
	);
	if (loaded.length > 0) {
		execFileSync('bun', ['run.ts', '--uncapped', ...loaded], {
			cwd: join(import.meta.dirname, '../pages'),
			stdio: 'inherit',
			env: {
				...process.env,
				MESHLETS_MAX_LOAD: String(MAX_LOAD),
				MESHLETS_ATTEMPTS: '3',
				MESHLETS_OUT: join(results, file.replace(/\.json$/, '-repeat.json')),
			},
		});
	}
} else if (part === 'bench-repeat') {
	// Runs the benchmark scenes again, once, in each mode that `--modes` names (such as forced,off),
	// into folders named repeat-<mode>-..., for the modes whose runs met a load of 8 or more.
	const out = join(results, 'medium-occlusion-bench');
	const benchDir = join(root, 'target/bench');
	for (const mode of opt('--modes', 'forced,off').split(',') as (keyof typeof MODES)[]) {
		await quiet();
		const before = new Set(existsSync(benchDir) ? readdirSync(benchDir) : []);
		execFileSync(
			'bun',
			[
				'run',
				'bench:run',
				'--scenes',
				's1,s2,s3,s4,s5,s6,s7',
				'--pages',
				'null3d-webgpu',
				'--runs',
				'1',
				'--uncapped',
				'--switches',
				`preset=medium&direct=off&${MODES[mode]}`,
			],
			{ cwd: root, stdio: 'inherit' },
		);
		for (const name of readdirSync(benchDir).filter((n) => !before.has(n)))
			cpSync(join(benchDir, name), join(out, `repeat-${mode}-${name}`), { recursive: true });
	}
} else if (part === 'bench') {
	const out = join(results, 'medium-occlusion-bench');
	mkdirSync(out, { recursive: true });
	const benchDir = join(root, 'target/bench');
	for (let round = 0; round < rounds; round++) {
		// Each round starts the modes from a different one, so no mode always runs first.
		const order = Object.entries(MODES);
		for (let k = 0; k < round % order.length; k++)
			order.push(order.shift() as (typeof order)[number]);
		for (const [mode, switches] of order) {
			await quiet();
			const before = new Set(existsSync(benchDir) ? readdirSync(benchDir) : []);
			execFileSync(
				'bun',
				[
					'run',
					'bench:run',
					'--scenes',
					's1,s2,s3,s4,s5,s6,s7',
					'--pages',
					'null3d-webgpu',
					'--runs',
					'1',
					'--uncapped',
					'--switches',
					`preset=medium&direct=off&${switches}`,
				],
				{ cwd: root, stdio: 'inherit' },
			);
			for (const name of readdirSync(benchDir).filter((n) => !before.has(n)))
				cpSync(join(benchDir, name), join(out, `round${round}-${mode}-${name}`), {
					recursive: true,
				});
		}
	}
} else {
	throw new Error(`--part takes desert, island, bench or repeat, not ${part}`);
}
