// What share of its own box each of three leaf cards covers, from the frame that the engine draws:
// the same square of the leaf atlas at three distances. Every level of the atlas is painted with a
// filter as wide as its own texels, so a heavily minified card keeps the coverage that its leaves
// have up close. The picture of three crowns at three distances is the `vegetation-coverage` image
// test, and this page measures the atlas itself, where no perspective confuses the numbers.
import { createEngine } from '@null3d/engine';
import { CARDS, cardBox } from './lib/leaf-card-row';
import { run } from './lib/result';

run('leaf-card-coverage', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const width = 1280;
	const height = 720;
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/leaf-card-coverage-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const frame = await engine.captureFrame();
	if (frame.width !== width || frame.height !== height)
		throw new Error(`the picture is ${frame.width} by ${frame.height}, not ${width} by ${height}`);

	/** The share of a box that draws anything at all: the leaves' own coverage of the card. */
	const covered = (box: { left: number; top: number; right: number; bottom: number }) => {
		let drawn = 0;
		let total = 0;
		for (let y = Math.max(0, box.top); y < Math.min(height, box.bottom); y++)
			for (let x = Math.max(0, box.left); x < Math.min(width, box.right); x++) {
				const at = (y * width + x) * 4;
				total += 1;
				// The background is black and holds no light, so any lit leaf stands above it.
				const lit =
					(frame.pixels[at] ?? 0) + (frame.pixels[at + 1] ?? 0) + (frame.pixels[at + 2] ?? 0);
				if (lit > 12) drawn += 1;
			}
		return total > 0 ? drawn / total : 0;
	};

	const shares = CARDS.map((_, index) => covered(cardBox(index, width, height)));
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		shares,
		ratio: (shares[2] ?? 0) / (shares[0] ?? 1),
	};
});
