// The card check: draws one showcase plant either as its mesh or as its far card, at one pose under
// one sun, crops the crown and publishes its mean color, its value and its shading spread. A card
// that strays from its mesh reads as another tree, so the picture test compares the two.
// ?mode=mesh or card, ?kind=, ?dist=, ?scale=, and ?glb= for another trees file.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'card' ? 'card' : 'mesh';
const kind = params.get('kind') ?? 'stone-pine';
const dist = params.get('dist') ?? '150';
const scale = params.get('scale') ?? '1';
const WHITE = 0.0;

/** The crown's color, value and shading spread over a crop of the frame, for its green pixels. */
function crown(pixels: Uint8ClampedArray, width: number, height: number) {
	const half = Math.min(width, height) / 2;
	const [x0, y0, x1, y1] = [half - 150, half - 150, half + 150, half + 150];
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	const lums: number[] = [];
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const at = (y * width + x) * 4;
			const [R, G, B] = [pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number];
			// A crown's green pixel, and not the pale sky behind it.
			if (!(G > R + 6 && G > B + 6 && G > 20)) continue;
			r += R;
			g += G;
			b += B;
			n++;
			lums.push(0.2126 * R + 0.7152 * G + 0.0722 * B);
		}
	if (n === 0) return undefined;
	const mean = lums.reduce((s, v) => s + v, 0) / n;
	const spread = Math.sqrt(lums.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
	return {
		pixels: n,
		color: [r / n, g / n, b / n].map((v) => Math.round(v * 10) / 10),
		value: Math.round(mean * 10) / 10,
		spread: Math.round(spread * 10) / 10,
	};
}

run('card-pair', async (): Promise<Record<string, unknown>> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = '1080px';
	canvas.style.height = '1080px';
	const engine = await createEngine({
		canvas,
		sketch: `/tests/pages/sketches/card-pair-sketch.ts?kind=${kind}&mode=${mode}&dist=${dist}&scale=${scale}`,
		preset: 'medium',
		stats: false,
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	await new Promise((resolve) => setTimeout(resolve, 2500));
	const frame = await engine.captureFrame();
	const metrics = crown(frame.pixels as unknown as Uint8ClampedArray, frame.width, frame.height);
	await engine.destroy();
	if (!metrics) throw new Error(`${mode} drew no crown`);
	return { mode, kind, dist, scale, ...metrics, white: WHITE };
});
