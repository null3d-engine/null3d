// Prototype P2's quick cost run on this Mac: the effect cost page (tests/pages/effect-cost.ts) with
// bloom by UnrealBloomPass's steps and by the mip chain, on each GPU path, at render scales 1 and
// 0.5, in Chrome on the Mac's GPU through Playwright, in a window of 1920 x 1080 CSS pixels at a
// pixel ratio of 1. It prints each run's GPU time per frame with bloom off and on, and writes them
// as JSON. It is a quick look: the device runner's bloom-p2 plan measures the phones and the iPad.
//   NULL3D_PORT=12973 bun bench/proto-p2-cost.ts --out bench/proto-p2/cost-mac.json
//   --rounds <n> runs each page n times (1 by default); --tier <list> picks the GPU paths
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';
import { pageResult } from '../tests/lib/page-result.ts';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	return at < 0 ? undefined : args[at + 1];
};
const OUT = option('--out');
const ROUNDS = Number(option('--rounds') ?? 1);
const TIERS = (option('--tier') ?? 'webgpu,webgl2').split(',');
const RUNS = [
	{ name: 'unreal', switches: '' },
	{ name: 'mip512', switches: '&method=mip&base=512' },
	{ name: 'mip384', switches: '&method=mip&base=384' },
	{ name: 'mip256', switches: '&method=mip&base=256' },
];

async function main() {
	const server = await startServer();
	const browser = await launchBrowser(defaultEnvironment());
	const results: unknown[] = [];
	try {
		for (let round = 0; round < ROUNDS; round++)
			for (const tier of TIERS)
				for (const scale of [1, 0.5])
					for (const run of RUNS) {
						if (scale !== 1 && (run.name === 'mip384' || run.name === 'mip256')) continue;
						const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
						try {
							await page.goto(
								`${server.url}/tests/pages/effect-cost.html?gpu=${tier}&scale=${scale}&effect=bloom${run.switches}`,
							);
							const result = (await pageResult(page, 120_000)) as Record<string, unknown> & {
								on: { gpuMs: number | null; intervalMs: number };
								off: { gpuMs: number | null; intervalMs: number };
							};
							const added =
								result.on.gpuMs !== null && result.off.gpuMs !== null
									? result.on.gpuMs - result.off.gpuMs
									: null;
							console.log(
								`${tier} scale ${scale} ${run.name}: GPU off ${result.off.gpuMs?.toFixed(3)} ms, on ${result.on.gpuMs?.toFixed(3)} ms, bloom ${added?.toFixed(3)} ms`,
							);
							results.push({ round, tier, scale, run: run.name, ...result });
						} finally {
							await page.close();
						}
					}
	} finally {
		await browser.close();
		server.stop();
	}
	if (OUT) writeFileSync(resolve(REPO_ROOT, OUT), `${JSON.stringify(results, null, '\t')}\n`);
}

main().catch((e) => {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
});
