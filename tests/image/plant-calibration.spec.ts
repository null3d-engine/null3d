// The plant shader's leaf light, measured on every GPU path from one oak leaf that
// `plant-calibration-sketch.ts` draws beside two plain reference squares. The record's
// reflectances are the oak's own texture means, so the leaf must show its texture's colours.
//
// Each picture is read back in linear light. A front-lit face must match the square of that face's
// reflectance, a back-lit leaf the square of the transmittance under the same sun, and a leaf under
// an even sky the two squares together, all within 3 per cent per channel. The leaf's spread of
// brightness must stay its texture's, so its lower face keeps the contrast of its own picture.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import {
	LEAF_LEVEL,
	LEAF_PLACE,
	REFERENCE_PLACES,
	REFERENCE_SIDE,
	VIEW,
} from '../pages/lib/plant-calibration.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/plant-calibration-sketch.ts';
const [WIDTH, HEIGHT] = VIEW.size;

/** The oak's texture manifest, read as data so the test loads none of the add-on's code. */
const OAK_MANIFEST = JSON.parse(
	readFileSync(
		new URL(
			'../../packages/vegetation-textures/textures/pedunculate-oak/manifest.json',
			import.meta.url,
		),
		'utf8',
	),
) as { leaf: { mean: { upper: number[]; lower: number[] } } };

/** The largest share by which a measured channel may differ from its reference. */
const TOLERANCE = 0.03;

/** Channels darker than this, in linear light, hold too few 8-bit steps to measure to 3 per cent. */
const DARKEST = 0.02;

/** A picture's pixels in linear light, three a pixel. */
type Linear = Float32Array;

/** An 8-bit sRGB value in linear light. */
function linear(byte: number): number {
	const c = byte / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Draws one picture of the sketch with `query`, in linear light. */
async function draw(
	page: Page,
	tier: Tier,
	query: string,
): Promise<{ bytes: Uint8Array; light: Linear }> {
	const [run] = imageRuns([
		{
			name: `plant-calibration-${query.replaceAll(/[=&]/g, '-')}`,
			sketch: `${SKETCH}?${query}`,
			hold: 0,
			tiers: [tier],
			size: [WIDTH, HEIGHT],
			// The first page of a run compiles the plant shader's builds.
			timeoutSeconds: 400,
		},
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const bytes = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
	writePng(test.info().outputPath(`${query.replaceAll(/[=&]/g, '-')}.png`), {
		width: WIDTH,
		height: HEIGHT,
		data: bytes,
	});
	const light = new Float32Array(WIDTH * HEIGHT * 3);
	for (let i = 0; i < WIDTH * HEIGHT; i++)
		for (let k = 0; k < 3; k++) light[i * 3 + k] = linear(bytes[i * 4 + k] as number);
	return { bytes, light };
}

/** The pixel column and row of a point in metres, in the sketch's orthographic view. */
function pixelOf(x: number, y: number): [number, number] {
	const span = (VIEW.height * WIDTH) / HEIGHT;
	return [
		Math.round(((x + span / 2) / span) * WIDTH),
		Math.round(((VIEW.centre + VIEW.height / 2 - y) / VIEW.height) * HEIGHT),
	];
}

/** The mean linear colour of the middle of a reference square. */
function squareMean(light: Linear, centre: readonly [number, number]): number[] {
	const [cx, cy] = pixelOf(centre[0], centre[1]);
	const half = Math.floor(((REFERENCE_SIDE / VIEW.height) * HEIGHT * 0.6) / 2);
	const sum = [0, 0, 0];
	let count = 0;
	for (let y = cy - half; y <= cy + half; y++)
		for (let x = cx - half; x <= cx + half; x++) {
			for (let k = 0; k < 3; k++)
				sum[k] = (sum[k] as number) + (light[(y * WIDTH + x) * 3 + k] as number);
			count++;
		}
	return sum.map((v) => v / count);
}

/**
 * The leaf's pixels: those of the leaf's half that draw anything over the black background, less
 * two pixels at every edge, where the blade's last pixel blends with the background.
 */
function leafPixels(bytes: Uint8Array): number[] {
	const [right] = pixelOf(LEAF_PLACE[0] + 0.5, 0);
	const drawn = new Uint8Array(WIDTH * HEIGHT);
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < right; x++) {
			const at = (y * WIDTH + x) * 4;
			drawn[y * WIDTH + x] =
				(bytes[at] as number) + (bytes[at + 1] as number) + (bytes[at + 2] as number) > 6 ? 1 : 0;
		}
	const pixels: number[] = [];
	for (let y = 2; y < HEIGHT - 2; y++)
		for (let x = 2; x < right - 2; x++) {
			let inside = true;
			for (let dy = -2; dy <= 2 && inside; dy++)
				for (let dx = -2; dx <= 2 && inside; dx++)
					if (!drawn[(y + dy) * WIDTH + x + dx]) inside = false;
			if (inside) pixels.push(y * WIDTH + x);
		}
	return pixels;
}

/** The mean linear colour of some pixels. */
function meanOf(light: Linear, pixels: readonly number[]): number[] {
	const sum = [0, 0, 0];
	for (const p of pixels)
		for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (light[p * 3 + k] as number);
	return sum.map((v) => v / Math.max(1, pixels.length));
}

/** Luminance's spread over its mean: the contrast of a set of colours. */
function contrast(luminances: readonly number[]): number {
	const mean = luminances.reduce((a, b) => a + b, 0) / luminances.length;
	const variance = luminances.reduce((a, b) => a + (b - mean) ** 2, 0) / luminances.length;
	return Math.sqrt(variance) / mean;
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The channels of a measure that differ from their reference by more than the tolerance. */
function misses(measured: readonly number[], expected: readonly number[]): string[] {
	const out: string[] = [];
	expected.forEach((want, k) => {
		if (want < DARKEST) return;
		const ratio = (measured[k] as number) / want;
		if (Math.abs(ratio - 1) > TOLERANCE)
			out.push(
				`channel ${'rgb'[k]}: ${(measured[k] as number).toFixed(4)} against ${want.toFixed(4)} (${(ratio * 100).toFixed(1)}%)`,
			);
	});
	return out;
}

/** What the texture holds over the blade's inner texels: their mean linear colour and their contrast. */
interface TextureStats {
	readonly mean: readonly number[];
	readonly contrast: number;
}

/**
 * A layer of the oak's leaf colour file at a mip level, decoded as the GPU decodes it, over the
 * texels at least two in from the blade's edge: the same inner region that the test reads from the
 * picture, where one texel draws one pixel.
 */
async function textureStats(layer: number, level: number): Promise<TextureStats> {
	const require = createRequire(import.meta.url);
	const root = new URL('../../packages/cli/vendor/basis/', import.meta.url).pathname;
	const factory = require(`${root}basis_encoder.js`);
	const basis = await factory({ wasmBinary: readFileSync(`${root}basis_encoder.wasm`) });
	basis.initializeBasis();
	const path = new URL(
		'../../packages/vegetation-textures/textures/pedunculate-oak/leaf-color.ktx2',
		import.meta.url,
	).pathname;
	const file = new basis.KTX2File(new Uint8Array(readFileSync(path)));
	try {
		file.startTranscoding();
		const rgba = basis.transcoder_texture_format.cTFRGBA32.value;
		const info = file.getImageLevelInfo(level, layer, 0);
		const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, layer, 0, rgba));
		file.transcodeImage(out, level, layer, 0, rgba, 0, -1, -1);
		const w = info.origWidth;
		const h = info.origHeight;
		const solid = (x: number, y: number) => (out[(y * w + x) * 4 + 3] as number) >= 128;
		const sum = [0, 0, 0];
		const values: number[] = [];
		for (let y = 2; y < h - 2; y++)
			for (let x = 2; x < w - 2; x++) {
				let inside = true;
				for (let dy = -2; dy <= 2 && inside; dy++)
					for (let dx = -2; dx <= 2 && inside; dx++) if (!solid(x + dx, y + dy)) inside = false;
				if (!inside) continue;
				const at = (y * w + x) * 4;
				const c = [0, 1, 2].map((k) => linear(out[at + k] as number));
				c.forEach((v, k) => {
					sum[k] = (sum[k] as number) + v;
				});
				values.push(luminance(c[0] as number, c[1] as number, c[2] as number));
			}
		return { mean: sum.map((v) => v / values.length), contrast: contrast(values) };
	} finally {
		file.close();
		file.delete();
	}
}

for (const tier of TIERS)
	for (const face of ['upper', 'lower'] as const) {
		test(`a leaf's ${face} face shows its record's light on ${tier}`, async ({ page }) => {
			test.setTimeout(600_000);
			const front = await draw(page, tier, `light=front&face=${face}`);
			const back = await draw(page, tier, `light=back&face=${face}`);
			const sky = await draw(page, tier, `light=sky&face=${face}`);
			const reflectance = squareMean(front.light, REFERENCE_PLACES.reflectance);
			const transmittance = squareMean(front.light, REFERENCE_PLACES.transmittance);
			const skyReflectance = squareMean(sky.light, REFERENCE_PLACES.reflectance);
			const skyThrough = squareMean(sky.light, REFERENCE_PLACES.transmittance);
			const gloss = squareMean(front.light, REFERENCE_PLACES.gloss);
			const skyGloss = squareMean(sky.light, REFERENCE_PLACES.gloss);
			const frontLeaf = leafPixels(front.bytes);
			const backLeaf = leafPixels(back.bytes);
			const skyLeaf = leafPixels(sky.bytes);
			// The leaf covers about a third of its square of texture: thousands of pixels.
			expect(frontLeaf.length).toBeGreaterThan(4000);
			const measured = {
				front: meanOf(front.light, frontLeaf),
				back: meanOf(back.light, backLeaf),
				sky: meanOf(sky.light, skyLeaf),
			};
			// The shader scales each texel by the record's colour over the face's whole-blade mean, so
			// the inner region the test reads shows the record's colour times its own share of that
			// mean. The highlight, which the black glossy square holds, does not scale.
			const own = await textureStats(face === 'upper' ? 0 : 1, LEAF_LEVEL);
			const leaf = OAK_MANIFEST.leaf;
			const whole = face === 'upper' ? leaf.mean.upper : leaf.mean.lower;
			const inner = own.mean.map((m, k) => m / (whole[k] as number));
			const scaled = (colour: readonly number[], highlight: readonly number[]) =>
				colour.map(
					(v, k) =>
						(v - (highlight[k] as number)) * (inner[k] as number) + (highlight[k] as number),
				);
			const none = [0, 0, 0];
			const expected = {
				front: scaled(reflectance, gloss),
				back: scaled(transmittance, none),
				sky: scaled(
					skyReflectance.map((r, k) => r + (skyThrough[k] as number)),
					skyGloss,
				),
			};
			// Contrast under the even sky, where no highlight lies over the picture.
			const leafContrast = contrast(
				skyLeaf.map((p) =>
					luminance(
						sky.light[p * 3] as number,
						sky.light[p * 3 + 1] as number,
						sky.light[p * 3 + 2] as number,
					),
				),
			);
			const ownContrast = own.contrast;
			const summary = {
				tier,
				face,
				ratios: Object.fromEntries(
					(['front', 'back', 'sky'] as const).map((light) => [
						light,
						measured[light].map((v, k) => Number((v / (expected[light][k] as number)).toFixed(4))),
					]),
				),
				inner: inner.map((v) => Number(v.toFixed(4))),
				contrast: {
					leaf: Number(leafContrast.toFixed(4)),
					texture: Number(ownContrast.toFixed(4)),
				},
			};
			test.info().annotations.push({ type: 'calibration', description: JSON.stringify(summary) });
			console.log(`plant calibration ${JSON.stringify(summary)}`);
			expect({
				front: misses(measured.front, expected.front),
				back: misses(measured.back, expected.back),
				sky: misses(measured.sky, expected.sky),
			}).toEqual({ front: [], back: [], sky: [] });
			// The picture samples between texels, which softens it a little; a face that lost its
			// picture's contrast, as a grey underside does, would read well under its texture's own.
			expect(leafContrast / ownContrast).toBeGreaterThan(0.8);
			expect(leafContrast / ownContrast).toBeLessThan(1.25);
		});
	}
