// What one frame of the bark and leaf atlases costs: the sketch draws a wall of leaf cards through
// the atlas material for a while, then through a plain unlit material, and reports the two frame
// intervals (tests/pages/sketches/vegetation-bake-sketch.ts). The difference is what a page pays
// each frame for its plants' textures, since a pass texture holds its image only while its pass
// draws. Run it on a quiet computer: the load at the start is printed beside the figures.
import { createEngine } from '@null3d/engine';
import { progress, publish } from './lib/result';

export async function collect(): Promise<void> {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/vegetation-bake-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	progress('engine created');
	const cost = await new Promise<{ withAtlas: number; plain: number }>((resolve, reject) => {
		const stop = engine.onSketchMessage((name, data) => {
			if (name !== 'bake-cost') return;
			stop();
			resolve(data as { withAtlas: number; plain: number });
		});
		setTimeout(() => reject(new Error('the sketch posted no bake cost')), 60_000);
	});
	await engine.destroy();
	await publish('vegetation-bake', {
		ok: true,
		tier: engine.capabilities.tier,
		...cost,
		bake: cost.withAtlas - cost.plain,
	});
}

collect().catch((error: unknown) =>
	publish('vegetation-bake', { ok: false, error: String(error) }),
);
