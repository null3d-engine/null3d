// Runs the vegetation add-on's checks by hand. The add-on is a work in progress that no CI job reads
// (D-378), so this is the one command that checks it, and the commit hook's lint passes over its
// files. It turns the add-on's switch on and runs, in order: the species registry and page, the lint
// of the add-on's files, its unit tests, its heavy checks, its type check, and its browser and
// picture tests. It stops at the first step that fails.
//   bun run test:vegetation             every step
//   bun run test:vegetation --no-browser    every step but the browser and picture tests
// The browser step draws on this machine's GPU; on the shared Mac, run it through the heavy queue.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VEGETATION_FILES, VEGETATION_PACKAGES, VEGETATION_SWITCH } from './lib/vegetation-switch';

const ROOT = join(import.meta.dirname, '..');

/**
 * The lint's settings for the add-on's files: the repository's own, without the entries that leave
 * the add-on out. Biome reads one root config, so the copy goes in a folder of its own under target.
 */
function lintConfig(): string {
	const left = new Set([
		...VEGETATION_PACKAGES.map((name) => `!packages/${name}`),
		...VEGETATION_FILES.map((glob) => `!${glob}`),
	]);
	const config = JSON.parse(readFileSync(join(ROOT, 'biome.json'), 'utf8')) as {
		files: { includes: string[] };
	};
	config.files.includes = config.files.includes.filter((entry) => !left.has(entry));
	const folder = join(ROOT, 'target/vegetation-lint');
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'biome.json'), JSON.stringify(config, null, '\t'));
	return folder;
}

/** The add-on's files for the lint: its packages, and its files outside them. */
const lintPaths = (): string[] => [
	...VEGETATION_PACKAGES.map((name) => `packages/${name}`),
	...VEGETATION_FILES.flatMap((glob) => [...new Bun.Glob(glob).scanSync({ cwd: ROOT })]),
];

/** Each step: what it does, and its command. */
const STEPS: readonly (readonly [string, readonly string[]])[] = [
	['the species registry and page', ['bun', 'tools/vegetation-registry.ts']],
	['the lint', ['bunx', 'biome', 'check', `--config-path=${lintConfig()}`, ...lintPaths()]],
	['the unit tests', ['bun', 'tests/unit.ts', '--vegetation']],
	['the heavy checks', ['bun', 'tests/heavy-checks.ts', '--vegetation']],
	['the type check', ['bun', 'tools/typecheck.ts', '--vegetation']],
	[
		'the browser tests',
		['bun', 'run', '--cwd', 'tests', 'test', 'plant-', '--grep-invert', '@alone'],
	],
	[
		'the picture tests',
		['bun', 'run', '--cwd', 'tests', 'test', 'images.spec.ts', '--grep', '\\bplant-'],
	],
];

const browser = !process.argv.includes('--no-browser');
const env = { ...process.env, [VEGETATION_SWITCH]: '1' };
for (const [name, command] of STEPS) {
	if (!browser && command.includes('--cwd')) continue;
	console.log(`test:vegetation: ${name}`);
	const result = spawnSync(command[0] as string, command.slice(1), {
		cwd: ROOT,
		env,
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		console.error(`test:vegetation: ${name} failed`);
		process.exit(result.status ?? 1);
	}
}
console.log('test:vegetation: every step passed');
