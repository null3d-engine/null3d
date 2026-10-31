// Times the opportunity that a cache of the still casters in a directional light's cascades would
// have in the Creek showcase, on this machine's Chrome. It runs two sides in turns at one pose and
// one hour: the scene as it draws, and the scene without the swaying grass, which is its only caster
// that moves in every frame. With the grass out, each cascade pass draws only still casters, which
// is what a cached copy would replace; the difference between the sides is the movers' share that
// no cache can take. Every cascade draws in every frame on both sides, so a pass that would rest
// still reports. It also times a copy of a 2,048-texel depth layer, whole and in rectangles, which
// is what a restore would cost.
//
//   bun tests/shadow-cache-run.ts --moods=Midday,Afternoon --rounds=3
//
// A timing run needs a quiet machine: start it through the job queue with `QUIET_OK=1`. It writes
// its records to target/shadow-cache/ and prints each side's frame and cascade figures with the
// load read beside them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_TIMING_ARGS } from '../packages/cli/src/browser.js';
import { displayRateCheck, launchInWindow, newParkedPage } from './lib/app-window.ts';
import { waitForQuietLoad } from './lib/cost-runs.ts';
import { pageResult } from './lib/page-result.ts';
import { startServerAt } from './lib/server.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.NULL3D_PORT ?? 6173);
const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const gpus = option('gpus', 'webgpu').split(',');
const presets = option('presets', 'medium').split(',');
const moods = option('moods', 'Midday,Afternoon').split(',');
const rounds = Number(option('rounds', '3'));
const seconds = Number(option('seconds', '8'));
const settle = Number(option('settle', '4'));
const width = Number(option('width', '1920'));
const height = Number(option('height', '1080'));
/** True runs only the depth-copy probe, for a restore figure on its own. */
const copyOnly = args.includes('--copy-only');

interface PassFigure {
	name: string;
	median: number;
	p95: number;
}
interface ShareResult {
	gpuMs: number | null;
	gpuP95: number | null;
	gpuStepMs: number | null;
	passes: PassFigure[];
	drawCalls: number;
	presentedFps: number;
	frames: number;
	width: number;
	height: number;
	css: [number, number];
	dpr: number;
	tier: string;
	mode: string;
}
interface CopyResult {
	ok: boolean;
	error?: string;
	adapter?: string | null;
	format?: string;
	bytes?: number;
	copies?: Record<string, { median: number; p5: number; p95: number }>;
	passes?: Record<string, { median: number; p5: number; p95: number }>;
}
interface SideRecord {
	side: string;
	mood: string;
	gpu: string;
	preset: string;
	round: number;
	loadBefore: string;
	loadAfter: string;
	/** True when both readings were under the quiet limit, so the figures count as timing figures. */
	quiet: boolean;
	displayProblem?: string;
	result?: ShareResult;
	error?: string;
}

const load = () => (loadavg()[0] as number).toFixed(2);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join(ROOT, 'target/shadow-cache', stamp);
mkdirSync(OUT, { recursive: true });

const server = await startServerAt(ROOT, PORT);
const browser = await launchInWindow({ channel: 'chrome', args: [...GPU_TIMING_ARGS] });
const sides = [
	{ name: 'all casters', query: '&cascade-probe' },
	// The same side again in the same round, so the spread between the two readings is the
	// machine's own noise rather than a result.
	{ name: 'all casters again', query: '&cascade-probe' },
	{ name: 'still casters', query: '&cascade-probe&without=grass' },
];
const records: SideRecord[] = [];
try {
	for (const gpu of copyOnly ? [] : gpus) {
		for (const preset of presets) {
			for (const mood of moods) {
				for (let round = 0; round < rounds; round++) {
					// The sides run in turns, and the order reverses on odd rounds, so a machine that
					// changes speed between sides changes both sides alike.
					const order = round % 2 === 0 ? sides : [...sides].reverse();
					for (const side of order) {
						// A timing figure needs a quiet computer, and the wait ends on its own when
						// the machine stays busy or the queue closes the window.
						await waitForQuietLoad();
						const loadBefore = load();
						const page = await newParkedPage(browser, {
							viewport: { width, height },
							// A page ratio above the engine's own 1x cap, so the engine sizes the
							// drawing buffer from the CSS size and not from the device-pixel box.
							deviceScaleFactor: 2,
						});
						const record: SideRecord = {
							side: side.name,
							mood,
							gpu,
							preset,
							round,
							loadBefore,
							loadAfter: loadBefore,
							quiet: false,
						};
						const problems: string[] = [];
						page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
						page.on('console', (message) => {
							if (message.type() === 'error' && !message.text().includes('__null3d/report'))
								problems.push(`console: ${message.text()}`);
						});
						page.on('requestfailed', (request) => {
							if (!request.url().includes('__null3d/report'))
								problems.push(`load failed: ${request.url()}`);
						});
						try {
							record.displayProblem = await displayRateCheck(page);
							const query =
								`?mood=${mood}&preset=${preset}&gpu=${gpu}` +
								`&seconds=${seconds}&settle=${settle}${side.query}`;
							await page.goto(
								`http://localhost:${PORT}/tests/pages/creek-cascade-share.html${query}`,
							);
							record.result = await pageResult<ShareResult>(page, 180_000);
							if (problems.length) record.error = problems.slice(0, 5).join(' | ');
						} catch (error) {
							record.error = `${(error as Error).message}${problems.length ? ` | ${problems.slice(0, 5).join(' | ')}` : ''}`;
						}
						record.loadAfter = load();
						record.quiet = Number(record.loadBefore) < 8 && Number(record.loadAfter) < 8;
						records.push(record);
						const figure = record.result;
						const cascades = (figure?.passes ?? [])
							.filter((pass) => pass.name.startsWith('shadow cascade'))
							.map((pass) => `${pass.name} ${pass.median.toFixed(4)}`)
							.join(', ');
						console.log(
							`${mood} ${gpu} ${preset} r${round} ${side.name}: ` +
								`frame ${figure?.gpuMs?.toFixed(3) ?? 'none'} ms, ` +
								`${figure?.presentedFps?.toFixed(1) ?? 'none'} fps, ` +
								`${figure?.drawCalls?.toFixed(0) ?? 'none'} calls, ` +
								`${figure?.width ?? 0}x${figure?.height ?? 0} from css ` +
								`${figure?.css?.[0] ?? 0}x${figure?.css?.[1] ?? 0} at ${figure?.dpr ?? 0}x, ` +
								`${cascades || 'no cascades'}; ` +
								`load ${record.loadBefore} to ${record.loadAfter}` +
								`${record.quiet ? ', quiet' : ', loaded: a guide'}` +
								`${record.displayProblem ? `; ${record.displayProblem}` : ''}` +
								`${record.error ? `; ${record.error}` : ''}`,
						);
						console.log(
							`  passes: ${(figure?.passes ?? [])
								.map((pass) => `${pass.name} ${pass.median.toFixed(3)}`)
								.join(', ')}`,
						);
						await page.close();
					}
				}
			}
		}
	}

	// The restore's cost: a copy of one depth layer, whole and in rectangles, on this device.
	const copyPage = await newParkedPage(browser, {
		viewport: { width: 1600, height: 900 },
		deviceScaleFactor: 2,
	});
	try {
		await copyPage.goto(`http://localhost:${PORT}/tests/pages/depth-copy-cost.html`);
		const copy = await pageResult<CopyResult>(copyPage, 120_000);
		writeFileSync(join(OUT, 'depth-copy.json'), `${JSON.stringify(copy, null, 2)}\n`);
		console.log(`copy: ${JSON.stringify(copy)}`);
	} catch (error) {
		console.log(`copy failed: ${(error as Error).message}`);
	} finally {
		await copyPage.close();
	}
} finally {
	await browser.close();
	server.stop();
	writeFileSync(join(OUT, 'share.json'), `${JSON.stringify(records, null, 2)}\n`);
	console.log(`records: ${join(OUT, 'share.json')}`);
}
