// The trees that the island's plan places draw where it places them: a test of the plan's numbers
// alone cannot see a tree that the culling or a level drops. Each case stands the camera near one of
// the plan's oaks, over nothing but a dark background, and the tree must fill a share of the frame.
import { expect, test } from '@playwright/test';

/** The share of the frame's pixels that a tree 25 m away covers at least. */
const LEAST_COVER = 0.05;

for (const [path, query] of [
	['WebGPU', 'gpu=webgpu&direct=off'],
	['WebGPU drawing directly', 'gpu=webgpu&direct=on'],
	['WebGL2', 'gpu=webgl2'],
] as const)
	for (const oak of [0, 0.5, 1])
		test(`a planned oak draws on ${path}, at ${oak} of the list`, async ({
			page,
			browserName,
		}, info) => {
			test.skip(
				browserName !== 'chromium' || info.project.name !== 'chrome-real-gpu',
				'the trees take minutes to bake on a software GPU',
			);
			test.setTimeout(180_000);
			const sketch = `/tests/pages/sketches/island-trees-sketch.ts?oak=${oak}`;
			await page.goto(
				`/tests/pages/image.html?sketch=${encodeURIComponent(sketch)}&hold=0.2&size=320x180&preset=high&${query}`,
			);
			await page.waitForFunction(
				() => (globalThis as { __null3dHold?: unknown }).__null3dHold !== undefined,
				undefined,
				{ timeout: 150_000 },
			);
			const cover = await page.evaluate(() => {
				const { pixels } = (globalThis as unknown as { __null3dHold: { pixels: number[] } })
					.__null3dHold;
				const background = [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0];
				let drawn = 0;
				for (let at = 0; at < pixels.length; at += 4)
					if (
						Math.abs((pixels[at] ?? 0) - (background[0] ?? 0)) +
							Math.abs((pixels[at + 1] ?? 0) - (background[1] ?? 0)) +
							Math.abs((pixels[at + 2] ?? 0) - (background[2] ?? 0)) >
						30
					)
						drawn++;
				return drawn / (pixels.length / 4);
			});
			expect(cover).toBeGreaterThan(LEAST_COVER);
		});
