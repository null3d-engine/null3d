// Prototype P2's comparison: bloom's scene (bench/scenes/bloom.ts) drawn by three.js's
// UnrealBloomPass, pmndrs's BloomEffect, null3D's UnrealBloomPass steps and null3D's mip chain with
// the settings that bench/lib/bloom-mapping.ts maps, side by side, with numbers. It also draws the
// glow at two canvas sizes and two render scales, to show whether its size follows the screen. It
// opens the pages in Chrome on the Mac's GPU through Playwright and writes the images, a JSON file
// of the numbers and a page that shows them (index.html) into the output folder. From the
// repository root, with a port of your own:
//   NULL3D_PORT=12973 bun bench/proto-p2.ts --out bench/proto-p2
// Options:
//   --out <folder>   where the images go; test-results/proto-p2 by default
//   --tier <tier>    null3D's GPU path: webgpu (default), compat or webgl2
//   --only <list>    groups to draw: unreal, pmndrs, default, size (all by default)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';
import { watchConsole } from '../packages/cli/src/page.js';
import { imageRuns, type Tier } from '../tests/lib/images.ts';
import { pageResult } from '../tests/lib/page-result.ts';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';
import { type MipBloomSettings, mapPmndrsBloom, mapUnrealBloomPass } from './lib/bloom-mapping.ts';
import {
	compareImages,
	decodeFeatureResult,
	encodePng,
	holdPagePath,
	type RgbaImage,
} from './lib/parity';
import { BLOOM_SETTINGS } from './scenes/bloom';

const SKETCH = 'tests/pages/sketches/bloom-sketch.ts';
const TWIN = '/bench/pages/threejs/bloom-p2.html';
const RESULT_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	return at < 0 ? undefined : args[at + 1];
};
const OUT = resolve(REPO_ROOT, option('--out') ?? 'test-results/proto-p2');
const TIER = (option('--tier') ?? 'webgpu') as Tier;
const ONLY = (option('--only') ?? 'unreal,pmndrs,default,s4,size').split(',');

/** A setting as the sketch's ?settings= switch takes it: base64url JSON, which holds no dot. */
function encodeSettings(settings: object): string {
	return btoa(JSON.stringify(settings))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

/** The image page's path that draws the sketch with `query` at `size` on the tier. */
function null3dPath(query: string, size: readonly [number, number], tier = TIER): string {
	const [run] = imageRuns([
		{ name: 'proto-p2', sketch: `${SKETCH}${query}`, hold: 1, size, tiers: [tier] },
	]);
	if (!run) throw new Error('no image run');
	return `${run.path}&antialias=none`;
}

/** The twin page's path for an effect at `size`. */
function twinPath(query: string, [width, height]: readonly [number, number]): string {
	return `${TWIN}?${query}&width=${width}&height=${height}`;
}

/** Bevy's NATURAL preset as mixes: its blend into each level from the level below it. */
export function bevyNaturalMixes(levels = 8): number[] {
	const intensity = 0.15;
	const boost = 0.7;
	const curvature = 0.95;
	const last = levels - 1;
	const blend = (mip: number) =>
		intensity + (1 - (1 - mip / last) ** (1 / (1 - curvature))) * boost * (1 - intensity);
	return Array.from({ length: levels - 1 }, (_, level) => blend(level + 1));
}

/** The mip chain that M2-F7 plans as the default: Bevy's NATURAL preset on a 512-row base. */
export const DEFAULT_MIP: MipBloomSettings = {
	method: 'mip',
	intensity: 0.15,
	threshold: 0,
	knee: 0,
	levels: 8,
	baseRows: 512,
	karis: true,
	composite: 'mix',
	mixes: bevyNaturalMixes(),
};

async function loadFrame(browser: Browser, baseUrl: string, path: string): Promise<RgbaImage> {
	const page = await browser.newPage();
	const { errors } = watchConsole(page);
	try {
		await page.goto(`${baseUrl}${path}`);
		return decodeFeatureResult(await pageResult(page, RESULT_TIMEOUT_MS), 'bloom');
	} catch (e) {
		throw new Error(`${path}: ${(e as Error).message} ${errors.join('; ')}`);
	} finally {
		await page.close();
	}
}

/** Luminance of a display pixel, from 0 to 1. */
function luma(data: Uint8Array, i: number): number {
	return (
		(0.2126 * (data[i] as number) +
			0.7152 * (data[i + 1] as number) +
			0.0722 * (data[i + 2] as number)) /
		255
	);
}

/** The light that bloom adds, per pixel: the bloomed image's luminance less the plain image's. */
function added(on: RgbaImage, off: RgbaImage): Float32Array {
	const out = new Float32Array(on.width * on.height);
	for (let p = 0; p < out.length; p++)
		out[p] = Math.max(0, luma(on.data, 4 * p) - luma(off.data, 4 * p));
	return out;
}

/**
 * Measures of a glow: the light it adds in all, the shares of the image where it adds more than 1,
 * 4 and 16 levels of 255, and the mean distance of its light from the image's brightest added point,
 * as a share of the image's height.
 */
function glowMeasures(glow: Float32Array, width: number, height: number) {
	let sum = 0;
	let peak = 0;
	let peakAt = 0;
	const over = [0, 0, 0];
	glow.forEach((v, p) => {
		sum += v;
		if (v > peak) {
			peak = v;
			peakAt = p;
		}
		[1, 4, 16].forEach((level, k) => {
			if (v * 255 > level) over[k] = (over[k] as number) + 1;
		});
	});
	const px = peakAt % width;
	const py = Math.floor(peakAt / width);
	let moment = 0;
	glow.forEach((v, p) => {
		moment += v * Math.hypot((p % width) - px, Math.floor(p / width) - py);
	});
	return {
		total: sum / (width * height),
		share: over.map((n) => n / (width * height)),
		meanDistance: moment / sum / height,
	};
}

/** The difference between two glows: the mean gap where either glows, as a share of their mean. */
function glowGap(a: Float32Array, b: Float32Array): number {
	let gap = 0;
	let level = 0;
	for (let p = 0; p < a.length; p++) {
		gap += Math.abs((a[p] as number) - (b[p] as number));
		level += ((a[p] as number) + (b[p] as number)) / 2;
	}
	return gap / level;
}

/** An image of a glow, brightened four times, so its edges show. */
function glowImage(glow: Float32Array, width: number, height: number): RgbaImage {
	const data = new Uint8Array(width * height * 4);
	glow.forEach((v, p) => {
		const c = Math.min(255, Math.round(v * 4 * 255));
		data.set([c, c, c, 255], 4 * p);
	});
	return { width, height, data };
}

interface Entry {
	group: string;
	name: string;
	file: string;
	glowFile?: string;
	note: string;
	measures?: ReturnType<typeof glowMeasures>;
	againstThree?: { pixelsDiffering: number; glowGap: number; glowRatio: number };
	againstNull3dUnreal?: { pixelsDiffering: number; glowGap: number };
}

async function main(): Promise<void> {
	mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await launchBrowser(defaultEnvironment());
	const entries: Entry[] = [];
	const save = (name: string, image: RgbaImage) => {
		const file = `${name}.png`;
		writeFileSync(join(OUT, file), encodePng(image));
		return file;
	};
	const frame = (path: string) => loadFrame(browser, server.url, path);
	try {
		const size = [1280, 720] as const;
		const off = await frame(null3dPath('', size));
		const threeOff = await frame(twinPath('effect=none', size));
		save('null3d-off', off);
		save('three-off', threeOff);
		const record = (
			group: string,
			name: string,
			image: RgbaImage,
			plain: RgbaImage,
			note: string,
			three?: { image: RgbaImage; plain: RgbaImage },
			unreal?: { image: RgbaImage; plain: RgbaImage },
		) => {
			const glow = added(image, plain);
			const entry: Entry = {
				group,
				name,
				note,
				file: save(name, image),
				glowFile: save(`${name}-glow`, glowImage(glow, image.width, image.height)),
				measures: glowMeasures(glow, image.width, image.height),
			};
			if (three) {
				const other = added(three.image, three.plain);
				const sum = (g: Float32Array) => g.reduce((a, b) => a + b, 0);
				entry.againstThree = {
					pixelsDiffering: compareImages(three.image, image).share,
					glowGap: glowGap(glow, other),
					glowRatio: sum(glow) / sum(other),
				};
			}
			if (unreal) {
				entry.againstNull3dUnreal = {
					pixelsDiffering: compareImages(unreal.image, image).share,
					glowGap: glowGap(glow, added(unreal.image, unreal.plain)),
				};
			}
			entries.push(entry);
			console.log(
				`${group} ${name}: ${JSON.stringify({ ...entry, file: undefined, glowFile: undefined, group: undefined, name: undefined, note: undefined })}`,
			);
			return glow;
		};

		if (ONLY.includes('unreal'))
			for (const name of ['soft', 'strong'] as const) {
				const three = {
					image: await frame(twinPath(`effect=unreal&bloom=${name}`, size)),
					plain: threeOff,
				};
				record(
					'unreal',
					`three-unreal-${name}`,
					three.image,
					threeOff,
					`three.js UnrealBloomPass, ${name}`,
				);
				const unreal = { image: await frame(null3dPath(`?bloom=${name}`, size)), plain: off };
				record(
					'unreal',
					`null3d-unreal-${name}`,
					unreal.image,
					off,
					"null3D today: UnrealBloomPass's steps",
					three,
				);
				for (const karis of [true, false]) {
					const mapped = mapUnrealBloomPass(BLOOM_SETTINGS[name], { canvasHeight: size[1], karis });
					const image = await frame(null3dPath(`?settings=${encodeSettings(mapped)}`, size));
					record(
						'unreal',
						`null3d-mip-${name}${karis ? '' : '-no-karis'}`,
						image,
						off,
						`null3D mip chain, mapped: intensity ${mapped.intensity.toFixed(2)}, base ${mapped.baseRows} rows, mixes ${mapped.mixes.map((m) => m.toFixed(2)).join(' ')}, Karis ${karis ? 'on' : 'off'}`,
						three,
						unreal,
					);
				}
				const fixed = mapUnrealBloomPass(BLOOM_SETTINGS[name], {
					canvasHeight: size[1],
					baseRows: 512,
				});
				record(
					'unreal',
					`null3d-mip-${name}-base-512`,
					await frame(null3dPath(`?settings=${encodeSettings(fixed)}`, size)),
					off,
					`null3D mip chain, mapped on the default 512-row base: mixes ${fixed.mixes.map((m) => m.toFixed(2)).join(' ')}`,
					three,
					unreal,
				);
			}

		if (ONLY.includes('pmndrs')) {
			const three = { image: await frame(twinPath('effect=pmndrs', size)), plain: threeOff };
			record(
				'pmndrs',
				'three-pmndrs-default',
				three.image,
				threeOff,
				'pmndrs BloomEffect, defaults (mipmapBlur)',
			);
			for (const karis of [true, false]) {
				const mapped = mapPmndrsBloom({}, { canvasHeight: size[1], karis });
				record(
					'pmndrs',
					`null3d-mip-pmndrs${karis ? '' : '-no-karis'}`,
					await frame(null3dPath(`?settings=${encodeSettings(mapped)}`, size)),
					off,
					`null3D mip chain, mapped: intensity ${mapped.intensity.toFixed(2)}, base ${mapped.baseRows}, mixes ${mapped.mixes.map((m) => m.toFixed(2)).join(' ')}, Karis ${karis ? 'on' : 'off'}`,
					three,
				);
			}
			// The direct mapping: pmndrs's radius as every mix, its levels, a base at half the canvas.
			const direct: MipBloomSettings = {
				method: 'mip',
				intensity: 1,
				threshold: 1,
				knee: 0.03,
				levels: 8,
				baseRows: size[1] / 2,
				karis: false,
				composite: 'screen',
				mixes: new Array(7).fill(0.85),
			};
			record(
				'pmndrs',
				'null3d-mip-pmndrs-direct',
				await frame(null3dPath(`?settings=${encodeSettings(direct)}`, size)),
				off,
				"null3D mip chain with pmndrs's own numbers: radius 0.85 as every mix, base at half the canvas",
				three,
			);
		}

		if (ONLY.includes('default'))
			record(
				'default',
				'null3d-mip-default',
				await frame(null3dPath(`?settings=${encodeSettings(DEFAULT_MIP)}`, size)),
				off,
				"M2-F7's candidate default: threshold 0, energy-conserving mix at 0.15, Bevy NATURAL's level blend, Karis on",
			);

		if (ONLY.includes('s4')) {
			// S4 with emissive materials, at the hold frame's 640 x 360, with ACES on both sides. The
			// twin's composer has no MSAA and null3D's S4 page keeps the preset's, so edges differ.
			const kind =
				TIER === 'webgl2' ? 'null3d-webgl2' : TIER === 'compat' ? 'null3d-compat' : 'null3d-webgpu';
			const nullPage = (switches: string) => holdPagePath('s4', kind, `emissive&${switches}`);
			const threePage = (mode: string) =>
				holdPagePath('s4', 'threejs-webgl', `emissive&bloomp2=${mode}`);
			const plain = await frame(nullPage('x=1'));
			const threePlain = await frame(threePage('none'));
			save('s4-null3d-off', plain);
			save('s4-three-off', threePlain);
			const height = 360;
			for (const name of ['soft', 'strong'] as const) {
				const three = { image: await frame(threePage(`unreal-${name}`)), plain: threePlain };
				record(
					's4',
					`s4-three-unreal-${name}`,
					three.image,
					threePlain,
					`S4: three.js UnrealBloomPass, ${name}`,
				);
				const unrealSettings = { ...BLOOM_SETTINGS[name], method: 'unreal' };
				const unreal = {
					image: await frame(nullPage(`bloomp2=${encodeSettings(unrealSettings)}`)),
					plain,
				};
				record(
					's4',
					`s4-null3d-unreal-${name}`,
					unreal.image,
					plain,
					"S4: null3D today, UnrealBloomPass's steps",
					three,
				);
				const mapped = mapUnrealBloomPass(BLOOM_SETTINGS[name], { canvasHeight: height });
				record(
					's4',
					`s4-null3d-mip-${name}`,
					await frame(nullPage(`bloomp2=${encodeSettings(mapped)}`)),
					plain,
					`S4: null3D mip chain, mapped at 360 rows: base ${mapped.baseRows}`,
					three,
					unreal,
				);
			}
			const three = { image: await frame(threePage('pmndrs')), plain: threePlain };
			record('s4', 's4-three-pmndrs', three.image, threePlain, 'S4: pmndrs BloomEffect, defaults');
			const mapped = mapPmndrsBloom({}, { canvasHeight: height });
			record(
				's4',
				's4-null3d-mip-pmndrs',
				await frame(nullPage(`bloomp2=${encodeSettings(mapped)}`)),
				plain,
				`S4: null3D mip chain, pmndrs mapped at 360 rows: base ${mapped.baseRows}`,
				three,
			);
			record(
				's4',
				's4-null3d-mip-default',
				await frame(nullPage(`bloomp2=${encodeSettings(DEFAULT_MIP)}`)),
				plain,
				"S4: M2-F7's candidate default (threshold 0, mix 0.15, Bevy NATURAL levels)",
			);
		}

		if (ONLY.includes('size')) {
			// The glow's size: the same view at 640 x 360 and 1280 x 720 (pixel ratio 1 and 2 on one
			// CSS size), and at render scale 1 and 0.5.
			const strongMip = mapUnrealBloomPass(BLOOM_SETTINGS.strong, { canvasHeight: 720 });
			for (const [label, query] of [
				['unreal', '?bloom=strong'],
				['mip', `?settings=${encodeSettings(strongMip)}`],
			] as const) {
				for (const [tag, s, scale] of [
					['640', [640, 360], ''],
					['1280', [1280, 720], ''],
					['1280-scale-50', [1280, 720], 'scale=0.5&fixed&'],
				] as const) {
					const plain = await frame(null3dPath(`?${scale}x=1`, s));
					const image = await frame(null3dPath(`?${scale}${query.slice(1)}`, s));
					record(
						'size',
						`size-${label}-${tag}`,
						image,
						plain,
						`${label}, ${s[0]} x ${s[1]}${scale ? ', render scale 0.5' : ''}`,
					);
				}
			}
		}
	} finally {
		await browser.close();
		server.stop();
	}
	writeFileSync(
		join(OUT, 'metrics.json'),
		`${JSON.stringify({ tier: TIER, entries }, null, '\t')}\n`,
	);
	writeFileSync(join(OUT, 'index.html'), galleryPage(entries));
	console.log(`wrote ${entries.length} images to ${OUT}`);
}

/** The comparison page: each group's images side by side, with their glows and numbers. */
function galleryPage(entries: Entry[]): string {
	const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
	const groups = [...new Set(entries.map((e) => e.group))];
	const cell = (e: Entry) => `<figure>
<img src="${e.file}" alt="${e.name}"><img src="${e.glowFile}" alt="${e.name} glow">
<figcaption><b>${e.name}</b><br>${e.note}<br>${
		e.measures
			? `glow: ${pct(e.measures.share[0] as number)} of the image over 1/255, ${pct(e.measures.share[2] as number)} over 16/255, mean distance ${e.measures.meanDistance.toFixed(3)} of the height`
			: ''
	}${
		e.againstThree
			? `<br>against three.js: ${pct(e.againstThree.pixelsDiffering)} of pixels differ by its rule, glow gap ${pct(e.againstThree.glowGap)}, glow ratio ${e.againstThree.glowRatio.toFixed(2)}`
			: ''
	}${e.againstNull3dUnreal ? `<br>against null3D's UnrealBloomPass steps: ${pct(e.againstNull3dUnreal.pixelsDiffering)} of pixels` : ''}</figcaption>
</figure>`;
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prototype P2 bloom</title>
<style>
:root { --bg: #f6f6f4; --fg: #1d1f22; --muted: #5d6268; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171a; --fg: #e4e6e8; --muted: #9aa0a6; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
.row { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
figure { margin: 0; } img { width: 100%; display: block; margin-bottom: 4px; }
figcaption { color: var(--muted); font-size: 12px; } figcaption b { color: var(--fg); }
</style></head><body>
<h1>Prototype P2: mip-chain bloom against UnrealBloomPass and pmndrs BloomEffect</h1>
<p>Each figure shows the image, then the light that bloom adds (four times brighter). Drawn on the Mac in Chrome; the numbers come from bench/proto-p2.ts.</p>
${groups
	.map(
		(g) =>
			`<h2>${g}</h2><div class="row">${entries
				.filter((e) => e.group === g)
				.map(cell)
				.join('\n')}</div>`,
	)
	.join('\n')}
</body></html>
`;
}

if (import.meta.main)
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
