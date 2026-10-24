// Writes the real-browser shards' page times, tests/lib/page-seconds.json, from the page times that
// CI's real-browser jobs keep in their artifacts, so the shards split each browser's plan by what
// its pages take there:
//   bun tools/real-browser-times.ts --run <id>    take the times of that CI run; give it more than
//                                                 once for the median of several runs
// It needs the GitHub CLI. `.dev/devices.md` says when to run it.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAGE_TIMES_FILE, type PageTimes, pageTimesOf } from '../tests/lib/page-times.ts';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const runs = args.flatMap((arg, at) => (arg === '--run' && args[at + 1] ? [args[at + 1]] : []));
if (runs.length === 0) {
	console.error('usage: bun tools/real-browser-times.ts --run <id> [--run <id>...]');
	process.exit(2);
}

/** Runs a command, and gives its output, or throws with its error output. */
function run(command: string[], cwd = root): string {
	const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0)
		throw new Error(`${command.join(' ')} failed:\n${result.stderr.toString()}`);
	return result.stdout.toString();
}

/** Every file below `folder` with the name `name`. */
function filesNamed(folder: string, name: string): string[] {
	return readdirSync(folder, { recursive: true, encoding: 'utf8' })
		.map((file) => join(folder, file))
		.filter((file) => file.endsWith(`/${name}`) && statSync(file).isFile());
}

/** Each browser's page times in each run, by the artifacts' names, such as real-browser-runs-Safari-3. */
const times: { browser: string; pages: { id: string; seconds: number }[] }[] = [];
const work = mkdtempSync(join(tmpdir(), 'real-browser-times-'));
try {
	for (const id of runs) {
		const listing = JSON.parse(
			run(['gh', 'api', `repos/{owner}/{repo}/actions/runs/${id}/artifacts?per_page=100`]),
		) as { artifacts: { id: number; name: string }[] };
		const artifacts = listing.artifacts.filter(({ name }) => name.startsWith('real-browser-runs-'));
		if (artifacts.length === 0) throw new Error(`CI run ${id} kept no real-browser runs`);
		for (const artifact of artifacts) {
			const browser = /^real-browser-runs-(\w+)-\d+$/.exec(artifact.name)?.[1];
			if (!browser) continue;
			const folder = join(work, String(artifact.id));
			const zip = `${folder}.zip`;
			writeFileSync(
				zip,
				Bun.spawnSync(['gh', 'api', `repos/{owner}/{repo}/actions/artifacts/${artifact.id}/zip`], {
					cwd: root,
					stdout: 'pipe',
				}).stdout,
			);
			run(['unzip', '-q', '-o', zip, '-d', folder]);
			for (const file of filesNamed(folder, 'page-times.json'))
				times.push({ browser, pages: JSON.parse(readFileSync(file, 'utf8')) });
		}
		console.log(`CI run ${id}: ${artifacts.length} real-browser shards`);
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

const table: PageTimes = { runs: runs.map(Number), browsers: pageTimesOf(times) };
writeFileSync(join(root, PAGE_TIMES_FILE), `${JSON.stringify(table, null, '\t')}\n`);
// The repository's formatter keeps short lists on one line, as the check of each commit asks.
run(['bunx', 'biome', 'format', '--write', PAGE_TIMES_FILE]);
for (const [browser, { fallback, pages }] of Object.entries(table.browsers))
	console.log(
		`${browser}: ${Object.keys(pages).length} pages of ${PAGE_TIMES_FILE}, ${fallback} s for each other page`,
	);
