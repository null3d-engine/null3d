// Writes the permutation words that a project's scenes draw with, as a build of a narrowed shader
// set reads them. Each page runs in hold mode with `?permutations=record`, the engine collects the
// words that its pipelines ask for, and the words that every page asked for go into one file, one
// hexadecimal word on each line.
//
// The file is the build's input: `NULL3D_SHADER_PERMUTATIONS=<file> bun run build` builds only those
// words. Record again after a scene gains a feature that turns on a new bit, or the build lacks the
// word, and the engine names it the moment a pipeline asks for it.
//
// Usage, from the repository root, with the pages served by `bun run examples:preview`:
//   bun tools/shader-permutations.ts --base http://localhost:4173 --out tools/shader-permutations.txt
//     [--pages demos] [--extra a,b]
// `--pages` names a page list: `demos` runs every demo of `examples/demos.ts` in hold mode. A
// project of its own names its pages with repeated `--page <path>` arguments instead.
// `--extra` adds words by hand, as hexadecimal numbers, for a path that the recording cannot reach,
// such as a feature that a visitor turns on.
import { writeFileSync } from 'node:fs';
import { DEMOS } from '../examples/demos.ts';
import { launchChromium } from '../packages/cli/src/browser.js';

/** The page's record of the permutation words that a recording run collected, in order. */
type Recorded = { __null3dPermutations?: number[] };

/** The device bits that a device module fixes, which a build's list leaves out. */
const DEVICE_BITS = 1 | 2 | 8192;

interface Page {
	/** The page's path from `--base`, such as `/demos/s1-cells/`. */
	path: string;
}

function options(): { base: string; out: string; pages: Page[]; extra: number[] } {
	const args = process.argv.slice(2);
	const value = (name: string): string | undefined => {
		const at = args.indexOf(name);
		return at < 0 ? undefined : args[at + 1];
	};
	const base = value('--base') ?? 'http://localhost:4173';
	const out = value('--out') ?? 'tools/shader-permutations.txt';
	const pages: Page[] = [];
	for (let at = 0; at < args.length; at++)
		if (args[at] === '--page') pages.push({ path: args[at + 1] ?? '' });
	// The examples page runs a demo by name, and hold mode draws the frame that its image test holds.
	if (value('--pages') === 'demos' && pages.length === 0)
		for (const demo of DEMOS) pages.push({ path: `/?demo=${demo.name}&hold=1` });
	const extra = (value('--extra') ?? '')
		.split(',')
		.map((word) => word.trim())
		.filter((word) => word !== '')
		.map((word) => Number.parseInt(word, 16));
	return { base, out, pages, extra };
}

const { base, out, pages, extra } = options();
if (pages.length === 0)
	throw new Error('name the pages to record: --pages demos, or one --page <path> for each');
writeFileSync(out, '');
const browser = await launchChromium({ headless: true });
const words = new Set<number>(extra);
try {
	for (const page of pages) {
		const query = page.path.includes('?') ? '&' : '?';
		const url = `${base}${page.path}${query}permutations=record`;
		const tab = await browser.newPage();
		try {
			await tab.goto(url, { waitUntil: 'load', timeout: 120_000 });
			await tab.waitForFunction(
				() => (globalThis as Recorded).__null3dPermutations !== undefined,
				undefined,
				{ timeout: 240_000, polling: 500 },
			);
			const found = (await tab.evaluate(
				() => (globalThis as Recorded).__null3dPermutations,
			)) as number[];
			// The device bits belong to the module that a device loads, so a list leaves them out.
			for (const word of found) words.add((word & ~DEVICE_BITS) >>> 0);
			console.log(`${page.path}: ${found.length} words`);
		} catch (error) {
			throw new Error(`${page.path}: ${(error as Error).message}`);
		} finally {
			await tab.close();
		}
	}
} finally {
	await browser.close();
}
const sorted = [...words].filter((word) => word !== 0).sort((a, b) => a - b);
const lines = [
	'# The permutation words that this project draws with, one hexadecimal word on each line.',
	`# Written by bun tools/shader-permutations.ts. A word added by hand keeps the run working`,
	'# where a path cannot be recorded.',
	...sorted.map((word) => `0x${word.toString(16).padStart(8, '0')}`),
];
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`wrote ${sorted.length} words to ${out}`);
