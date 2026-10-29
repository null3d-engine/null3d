// Writes the permutation words that a project's scenes draw with, as a build of a narrowed shader
// set reads them. Each page runs with `?permutations=record`, the engine collects the words that its
// pipelines ask for, and the words that every page asked for go into one file, one hexadecimal word
// on each line.
//
// The file is the build's input: `NULL3D_SHADER_PERMUTATIONS=<file> bun run build` builds only those
// words. Record again after a scene gains a feature that turns on a new bit, or the build lacks the
// word, and the engine names it the moment a pipeline asks for it.
//
// Usage, from the repository root, with the pages served by `bun run examples:preview`:
//   bun tools/shader-permutations.ts --base http://localhost:5173 --out examples/shader-permutations.txt
//     [--pages demos] [--workers 4] [--extra a,b]
// `--pages` names a page list: `demos` runs every demo of `examples/demos.ts` in hold mode at each
// quality preset on both GPU paths, and then live, where it advances the scene and presses every
// button of a showcase scene's controls HUD, so the words those states turn on reach the list. A
// project of its own names its pages with repeated `--page <path>` arguments instead, and a page
// that it drives through its own states with `--live <path>`. The run sweeps a live page's controls
// HUD when it has one.
// `--extra` adds words by hand, as hexadecimal numbers, for a path that the recording cannot reach.
import { writeFileSync } from 'node:fs';
import { DEMOS } from '../examples/demos.ts';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';

/** The page's record of the permutation words that a recording run collected, in order. */
type Recorded = {
	__null3dPermutations?: number[];
	__null3dStopRecording?: () => void;
};

/**
 * The quality presets to record, so a device that picks one for its own class finds every word it
 * draws. Low draws with FXAA and no fading bands, and the other presets draw with MSAA and the
 * fading bands, so these two cover the shader bits that a preset sets.
 */
const PRESETS = ['low', 'high'] as const;

/** How long to wait after a HUD pick before the next one, in ms, so its frames ask for the word. */
const PICK_MS = 600;

/** How long a live page may draw before its recording ends, in ms, so its scene and camera move. */
const LIVE_MS = 5000;

interface Target {
	/** The page's path from `--base`, such as `/?demo=creek`. */
	path: string;
	/** True for a live page, which the run drives through its states and then stops. */
	live: boolean;
}

/** The parts of a Playwright page that the controls sweep uses. */
interface HudPage {
	locator(selector: string): {
		count(): Promise<number>;
		first(): { click(options: { timeout: number }): Promise<void> };
		nth(index: number): { click(options: { timeout: number }): Promise<void> };
	};
	waitForTimeout(milliseconds: number): Promise<void>;
}

function options(): {
	base: string;
	out: string;
	pages: Target[];
	extra: number[];
	workers: number;
} {
	const args = process.argv.slice(2);
	const value = (name: string): string | undefined => {
		const at = args.indexOf(name);
		return at < 0 ? undefined : args[at + 1];
	};
	const base = value('--base') ?? 'http://localhost:5173';
	const out = value('--out') ?? 'examples/shader-permutations.txt';
	const workers = Math.max(1, Math.min(16, Number(value('--workers') ?? 4)));
	const pages: Target[] = [];
	for (let at = 0; at < args.length; at++)
		if (args[at] === '--page') pages.push({ path: args[at + 1] ?? '', live: false });
		else if (args[at] === '--live') pages.push({ path: args[at + 1] ?? '', live: true });
	// The examples page runs a demo by name, and hold mode draws the frame that its image test
	// holds. Both GPU paths record: each path's variants list bits that the other's do not, such as
	// the morph targets of WebGL2 and the instance index of WebGPU, and one set serves every device.
	// The presets record too, because the engine picks one for the device's class.
	if (value('--pages') === 'demos' && pages.length === 0)
		for (const demo of DEMOS) {
			for (const gpu of ['webgpu', 'webgl2'] as const) {
				for (const preset of PRESETS)
					pages.push({
						path: `/?demo=${demo.name}&hold=${demo.hold}&gpu=${gpu}&preset=${preset}`,
						live: false,
					});
				// A live page advances the scene, and a showcase scene also offers its controls, so the
				// run sweeps its HUD and moves through the scene, which reveals what a held frame may
				// not show.
				pages.push({ path: `/?demo=${demo.name}&gpu=${gpu}`, live: true });
			}
		}
	const extra = (value('--extra') ?? '')
		.split(',')
		.map((word) => word.trim())
		.filter((word) => word !== '')
		.map((word) => Number.parseInt(word, 16));
	return { base, out, pages, extra, workers };
}

/**
 * Presses every button of each group of the page's controls HUD, which turns on every effect and
 * quality the page offers, so the words those states ask for reach the recording. A page without a
 * HUD is left as it is.
 */
async function sweepHud(page: HudPage): Promise<number> {
	// The page gives every demo a place for a HUD, but only a scene that posts a controls model shows
	// the chevron that opens it.
	const chevron = page.locator('button.hud__chevron:visible');
	if ((await chevron.count()) === 0) return 0;
	await chevron.first().click({ timeout: 5_000 });
	await page.waitForTimeout(PICK_MS);
	let picks = 0;
	const tabs = page.locator('button.hud__tab');
	const count = await tabs.count();
	for (let k = 0; k < count; k++) {
		await tabs.nth(k).click({ timeout: 5_000 });
		await page.waitForTimeout(PICK_MS);
		// A group's buttons are the visible ones, since only the selected tab's panel shows.
		const buttons = page.locator('.hud__group:not([hidden]) button.hud__btn');
		const shown = await buttons.count();
		for (let b = 0; b < shown; b++) {
			await buttons
				.nth(b)
				.click({ timeout: 5_000 })
				.catch(() => undefined);
			await page.waitForTimeout(PICK_MS);
			picks++;
		}
	}
	return picks;
}

const { base, out, pages, extra, workers } = options();
if (pages.length === 0)
	throw new Error('name the pages to record: --pages demos, or one --page <path> for each');
// The real GPU where the machine has one, so both paths draw as a device draws them; the software
// GPU elsewhere, as CI runs it.
const browser = await launchBrowser(defaultEnvironment());
const words = new Set<number>(extra);
/**
 * Records one page's words. A page runs on its own tab, so several pages record at once: each
 * spends most of its time loading and building its scene, and one page at a time takes hours.
 */
async function recordPage(entry: Target): Promise<void> {
	const query = entry.path.includes('?') ? '&' : '?';
	const url = `${base}${entry.path}${query}permutations=record`;
	const tab = await browser.newPage();
	try {
		await tab.goto(url, { waitUntil: 'load', timeout: 120_000 });
		if (entry.live) {
			// The engine puts the stop on the page once it starts, so the words are read after the
			// page has offered its controls.
			await tab.waitForFunction(
				() => (globalThis as Recorded).__null3dStopRecording !== undefined,
				undefined,
				{ timeout: 120_000, polling: 250 },
			);
			// Let the first frames draw and the camera move before the sweep.
			await tab.waitForTimeout(LIVE_MS);
			const picks = await sweepHud(tab);
			if (picks > 0) console.log(`${entry.path}: pressed ${picks} controls`);
			await tab.evaluate(() => (globalThis as Recorded).__null3dStopRecording?.());
		}
		await tab.waitForFunction(
			() => (globalThis as Recorded).__null3dPermutations !== undefined,
			undefined,
			{ timeout: 240_000, polling: 500 },
		);
		const found = (await tab.evaluate(
			() => (globalThis as Recorded).__null3dPermutations,
		)) as number[];
		// The engine records each word without the bits that a device fixes, so one list serves every
		// device module.
		for (const word of found) words.add(word >>> 0);
		console.log(`${entry.path}: ${found.length} words`);
	} finally {
		await tab.close();
	}
}
let next = 0;
let failure: Error | undefined;
const worker = async (): Promise<void> => {
	while (failure === undefined) {
		const entry = pages[next++];
		if (entry === undefined) return;
		try {
			// A page that times out under several browsers at once is often slow, not broken, so it
			// gets a second try before the run gives up.
			await recordPage(entry).catch(() => recordPage(entry));
		} catch (error) {
			failure = new Error(`${entry.path}: ${(error as Error).message}`);
		}
	}
};
try {
	await Promise.all(Array.from({ length: workers }, worker));
	if (failure !== undefined) throw failure;
} finally {
	await browser.close();
}
// The word without any bit set is a word like another: the builds of compute passes, pre-passes and
// full-screen passes carry it, so a list that left it out would leave those passes without a shader.
const sorted = [...words].sort((a, b) => a - b);
const lines = [
	'# The permutation words that this project draws with, one hexadecimal word on each line.',
	'# Written by bun tools/shader-permutations.ts. A word added by hand keeps the run working',
	'# where a path cannot be recorded.',
	...sorted.map((word) => `0x${word.toString(16).padStart(8, '0')}`),
];
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`wrote ${sorted.length} words to ${out}`);
