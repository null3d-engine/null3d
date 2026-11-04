// Times GPU occlusion culling at the Medium preset, off against on, in Chrome for Testing on the
// production builds, without the frame cap: held on in every frame (`occlusion-check=off`), and on
// with its check deciding. Every page waits until the one-minute load falls below 8, and the pages
// of a round run in turns, so the three modes share the machine's state. `--part desert` runs the
// desert and Bistro pages of this folder (3 rounds, each page once a round); `--part bench` runs the
// repository's benchmark scenes through `bun run bench:run`, one mode after another in each round.
// `--rounds <n>` changes the rounds. Run from the repository's root once `bun run build` and
// `bun run build:cdn --url-switches` are done. Results land in this folder's results/.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
	const pages = bases.flatMap((base) => Object.values(MODES).map((mode) => `${base}&${mode}`));
	execFileSync('bun', ['run.ts', '--uncapped', '--runs', String(rounds), ...pages], {
		cwd: join(import.meta.dirname, '../pages'),
		stdio: 'inherit',
		env: {
			...process.env,
			MESHLETS_MAX_LOAD: String(MAX_LOAD),
			MESHLETS_ATTEMPTS: '3',
			MESHLETS_OUT: join(results, 'medium-occlusion-desert-bistro.json'),
		},
	});
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
	throw new Error(`--part takes desert or bench, not ${part}`);
}
