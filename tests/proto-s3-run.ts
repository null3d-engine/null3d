// Runs prototype S3 (`tests/pages/proto-s3.ts`) on this machine's Chrome, on both GPU paths and at
// each AO rate that the command names, and writes each run's figures, pictures and look comparison
// to `target/proto-s3/`. `--timing` times the setups, with the GPU timer's per-pass figures and the
// batches' throughput; `--pictures` draws the pictures and skips timing.
//
//   bun tests/proto-s3-run.ts --timing --tiers=webgpu,webgl2 --rates=0.5,0.25 --rounds=5
//   bun tests/proto-s3-run.ts --pictures --tiers=webgpu,webgl2 --rates=0.5,0.25
//
// A timing run needs a quiet machine: start it through the job queue with `QUIET_OK=1`.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_TIMING_ARGS, launchBrowser } from '../packages/cli/src/browser.js';
import { compareImages, percent } from '../packages/cli/src/compare.js';
import { readPng } from '../packages/cli/src/png.js';
import { pageResult } from './lib/page-result.ts';
import { startServerAt } from './lib/server.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.NULL3D_PORT ?? 6173);
const OUT = join(ROOT, 'target/proto-s3');
const args = process.argv.slice(2);
const pictures = args.includes('--pictures');
const timing = args.includes('--timing');
const tiers = (args.find((a) => a.startsWith('--tiers='))?.slice(8) ?? 'webgpu,webgl2').split(',');
const rates = (args.find((a) => a.startsWith('--rates='))?.slice(8) ?? '0.5,0.25')
	.split(',')
	.map(Number);
const rounds = args.find((a) => a.startsWith('--rounds='))?.slice(9) ?? '5';

interface Result {
	ok: boolean;
	error?: string;
	tier: string;
	gpu: Record<string, unknown>;
	storage: Record<string, unknown>;
	render: [number, number];
	ao: [number, number];
	images?: Record<string, string>;
	batches?: { frameMs: Record<string, number>; costMs: Record<string, number>; frames: number };
	timed?: { frameMs: Record<string, number>; costMs: Record<string, number> };
}

const server = await startServerAt(ROOT, PORT);
const browser = await launchBrowser('chrome-real-gpu', GPU_TIMING_ARGS);
const runs: { tier: string; rate: number; file: string }[] = [];
try {
	for (const tier of tiers) {
		for (const rate of rates) {
			const query = new URLSearchParams({
				gpu: tier,
				preset: 'high',
				scale: '1',
				aoscale: String(rate),
				aos: 'gtao,bitmask,three',
				inputs: 'copy',
				ups: 'bilinear',
				contact: '0',
				rounds,
				timedframes: '24',
				images: pictures ? '1' : '0',
				measure: timing ? '1' : '0',
				imagesize: '960x540',
				// The timing figures use a fixed canvas, so runs on any machine compare: 3,024 x
				// 1,520 at render scale 1, and AO at half or a quarter of that.
				size: '3024x1520',
				target: '120',
			});
			const page = await browser.newPage();
			const problems: string[] = [];
			page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
			page.on('console', (m) => {
				if (m.type() === 'error' && !m.text().includes('__null3d/report')) {
					problems.push(`console: ${m.text()}`);
				}
			});
			page.on('requestfailed', (r) => {
				if (!r.url().includes('__null3d/report')) problems.push(`load failed: ${r.url()}`);
			});
			const started = Date.now();
			console.log(
				`\n=== ${tier} ao ${rate} (${pictures ? 'pictures' : ''}${timing ? ' timing' : ''})`,
			);
			await page.goto(`http://localhost:${PORT}/tests/pages/proto-s3.html?${query}`);
			let result: Result;
			try {
				result = await pageResult<Result>(page, 20 * 60_000);
			} catch (error) {
				console.error(`no result: ${(error as Error).message}\n${problems.join('\n')}`);
				await page.close();
				continue;
			}
			const base = `${tier}-${rate}`;
			mkdirSync(join(OUT, 'pictures', base), { recursive: true });
			mkdirSync(join(OUT, 'results'), { recursive: true });
			for (const [name, data] of Object.entries(result.images ?? {})) {
				writeFileSync(join(OUT, 'pictures', base, name), Buffer.from(data, 'base64'));
			}
			writeFileSync(
				join(OUT, 'results', `${base}.json`),
				`${JSON.stringify({ ...result, images: undefined, problems, seconds: (Date.now() - started) / 1000 }, null, 2)}\n`,
			);
			runs.push({ tier, rate, file: base });
			console.log(
				`${result.ok ? 'ok' : `FAILED ${result.error}`} in ${((Date.now() - started) / 1000).toFixed(0)} s; ${result.render?.join('x')} render, ${result.ao?.join('x')} ao`,
			);
			console.log(`  storage ${JSON.stringify(result.storage)}`);
			if (result.batches?.costMs) console.log(`  batches ${JSON.stringify(result.batches.costMs)}`);
			if (result.timed?.costMs) console.log(`  timed ${JSON.stringify(result.timed.costMs)}`);
			if (problems.length) console.log(`  problems ${problems.slice(0, 5).join(' | ')}`);
			await page.close();
		}
	}
} finally {
	await browser.close();
	server.stop();
}

/** The mean luminance, from 0 to 255, of the pixels of one channel reading. */
function meanLight(image: { data: Uint8Array }): number {
	let sum = 0;
	const count = image.data.length / 4;
	for (let i = 0; i < image.data.length; i += 4)
		sum += ((image.data[i] ?? 0) + (image.data[i + 1] ?? 0) + (image.data[i + 2] ?? 0)) / 3;
	return sum / count;
}

/**
 * How two images differ: the share of pixels whose largest channel difference passes `STEPS`, split
 * by whether the first is darker or lighter there, and the mean signed difference (negative where
 * the first is darker).
 */
function apart(a: { data: Uint8Array }, b: { data: Uint8Array }) {
	let changed = 0;
	let darker = 0;
	let lighter = 0;
	let sum = 0;
	const count = a.data.length / 4;
	for (let i = 0; i < a.data.length; i += 4) {
		const dr = (a.data[i] ?? 0) - (b.data[i] ?? 0);
		const dg = (a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0);
		const db = (a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0);
		const biggest = Math.abs(dr) > Math.abs(dg) ? dr : dg;
		const step = Math.abs(biggest) > Math.abs(db) ? biggest : db;
		if (Math.abs(step) > STEPS) {
			changed++;
			if (step < 0) darker++;
			else lighter++;
		}
		sum += (dr + dg + db) / 3;
	}
	return {
		share: changed / count,
		darker: darker / count,
		lighter: lighter / count,
		mean: sum / count,
	};
}

/** How many channel steps one image may differ by before its pixel counts as another color. */
const STEPS = 8;

// The look comparison: the occlusion alone and the shaded scene, the bitmask variant against the
// current technique and against GTAO, on each path and rate. A timing run that has no pictures
// from an earlier picture run skips it.
const looks: Record<string, unknown> = {};
for (const { file } of runs) {
	const folder = join(OUT, 'pictures', file);
	const read = (name: string) => readPng(join(folder, `${name}.png`));
	if (
		!['baseline', 'copy-three-bilinear-ao', 'copy-bitmask-bilinear-ao'].every((name) =>
			existsSync(join(folder, `${name}.png`)),
		)
	) {
		looks[file] = 'no pictures: run --pictures first';
		continue;
	}
	const baseline = read('baseline');
	const entry: Record<string, unknown> = {};
	for (const kind of ['gtao', 'bitmask', 'three']) {
		for (const [suffix, label] of [
			['-ao', 'occlusion'],
			['', 'scene'],
		] as const) {
			const image = read(`copy-${kind}-bilinear${suffix}`);
			entry[`${kind}-${label}`] = {
				darkening: Number((meanLight(baseline) - meanLight(image)).toFixed(3)),
			};
		}
	}
	for (const kind of ['bitmask', 'three']) {
		for (const [suffix, label] of [
			['-ao', 'occlusion'],
			['', 'scene'],
		] as const) {
			const a = read(`copy-${kind}-bilinear${suffix}`);
			const current = read(`copy-three-bilinear${suffix}`);
			const gtao = read(`copy-gtao-bilinear${suffix}`);
			const diff = apart(a, current);
			const other = apart(a, gtao);
			const compared = compareImages(current, a, 0.1);
			entry[`${kind}-against-current-${label}`] = {
				over8: percent(diff.share),
				darker: percent(diff.darker),
				lighter: percent(diff.lighter),
				meanDiff: Number(diff.mean.toFixed(3)),
				pixelmatch: percent(compared.share),
			};
			entry[`${kind}-against-gtao-${label}`] = {
				over8: percent(other.share),
				darker: percent(other.darker),
				lighter: percent(other.lighter),
				meanDiff: Number(other.mean.toFixed(3)),
			};
		}
	}
	looks[file] = entry;
}
writeFileSync(join(OUT, 'looks.json'), `${JSON.stringify(looks, null, 2)}\n`);
console.log(`\nLOOKS\n${JSON.stringify(looks, null, 2)}`);
