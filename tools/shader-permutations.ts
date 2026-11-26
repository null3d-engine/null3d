// Writes the permutation words that the repository's demos, or a project's pages, draw with, as a
// narrowed build reads them. The recording itself is the command-line tool's
// (`packages/cli/src/shader-record.js`), which `bunx @null3d/cli shaders record` runs for a project;
// this script adds the demos' page list and the repository's own browser.
//
// The file is the input of a narrowed build: `NULL3D_SHADER_PERMUTATIONS=<file> bun run build`
// compiles only those words, and the Vite plugin's `shaders.list` option copies only their builds.
// Record again after a scene gains a feature that turns on a new bit, or the build lacks the word,
// and the engine names it the moment a pipeline asks for it.
//
// Usage, from the repository root, with the pages served by `bun run examples:preview`, which
// serves HTTPS by default:
//   bun tools/shader-permutations.ts --base https://localhost:5173 --out examples/shader-permutations.txt
//     [--pages demos] [--workers 4] [--extra a,b] [--click <selector>] [--scroll]
// `--pages demos` runs every demo of `examples/demos.ts` in hold mode at each quality preset on
// both GPU paths, and then live, where it advances the scene and presses every button of a
// showcase scene's controls HUD, so the words those states turn on reach the list. Pages of a
// project's own are named with repeated `--page <path>` arguments instead, which record in hold mode
// at each preset on both GPU paths, and a page that the run drives through its states with
// `--live <path>`. `--scroll` scrolls each live page to its end. The script writes the recorded
// words alone, so a word that no page draws leaves the list. `--extra` adds words by hand, as
// hexadecimal numbers, for a path that the recording cannot reach. `--click` presses a selector
// after each page loads, for a page whose engine starts on a click, such as a game page with a Play
// button. The pages must be served with a development build of the engine, or one built with the
// plugin's `urlSwitches`: a production build ignores `?gpu`, `?preset` and `?permutations`, so it
// records nothing.
import { DEMOS } from '../examples/demos.ts';
import { defaultEnvironment } from '../packages/cli/src/browser.js';
import {
	RECORD_GPUS,
	RECORD_PRESETS,
	type RecordTarget,
	readExtraWords,
	recordTargets,
	recordWords,
} from '../packages/cli/src/shader-record.js';
import { writeWordList } from '../packages/cli/src/shader-words.js';
import { launchRepoBrowser } from '../tests/lib/chrome-for-testing.ts';

/**
 * The address a demo's recorded pages take, for a scene whose state changes what it draws and
 * whose own controls cannot reach that state. The island ships up to 18 skinned walkers, so its
 * recording asks for the highest count: a page that raises the count then asks for no word that
 * the recording missed.
 */
const RECORD_QUERY: Readonly<Record<string, string>> = { island: '&walkers=18' };

/** Every demo of the examples page, held at each preset and live, on both GPU paths. */
function demoTargets(pageRoot: string): RecordTarget[] {
	const targets: RecordTarget[] = [];
	for (const demo of DEMOS) {
		const query = RECORD_QUERY[demo.name] ?? '';
		for (const gpu of RECORD_GPUS) {
			for (const preset of RECORD_PRESETS)
				targets.push({
					path: `${pageRoot}?demo=${demo.name}&hold=${demo.hold}&gpu=${gpu}&preset=${preset}${query}`,
					live: false,
				});
			// A live page advances the scene, and a showcase scene also offers its controls, so the
			// run sweeps its HUD and moves through the scene, which reveals what a held frame may not
			// show.
			targets.push({ path: `${pageRoot}?demo=${demo.name}&gpu=${gpu}${query}`, live: true });
		}
	}
	return targets;
}

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
	const at = args.indexOf(name);
	return at < 0 ? undefined : args[at + 1];
};
const all = (name: string): string[] =>
	args.flatMap((arg, at) => (arg === name ? [args[at + 1] ?? ''] : []));
const base = value('--base') ?? 'https://localhost:5173';
const out = value('--out') ?? 'examples/shader-permutations.txt';
// The page that runs a demo: the examples preview serves it at the root, and the repository's dev
// server at its own path.
const pageRoot = value('--page-root') ?? '/';
const workers = Math.max(1, Math.min(16, Number(value('--workers') ?? 4)));
const held = all('--page');
const live = all('--live');
const targets =
	value('--pages') === 'demos' && held.length === 0 && live.length === 0
		? demoTargets(pageRoot)
		: recordTargets({ held, live, scroll: args.includes('--scroll') });
if (targets.length === 0)
	throw new Error('name the pages to record: --pages demos, or one --page <path> for each');
// The real GPU where the machine has one, so both paths draw as a device draws them; the software
// GPU elsewhere, as CI runs it.
const browser = await launchRepoBrowser(defaultEnvironment());
let words: number[];
try {
	words = await recordWords({
		browser,
		base,
		targets,
		workers,
		click: value('--click'),
		extra: readExtraWords(value('--extra') ?? ''),
	});
} finally {
	await browser.close();
}
// The demos' list holds what the demos draw now, so a word that no demo draws leaves it.
const list = writeWordList(out, words, {
	replace: true,
	writer: 'bun tools/shader-permutations.ts',
});
console.log(`wrote ${list.words.length} words to ${out}, ${list.added} of them new`);
