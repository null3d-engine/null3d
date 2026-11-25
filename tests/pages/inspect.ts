// Starts the engine with the boxes sketch and drives its inspection channel: lists the scene,
// reads and changes an object, changes its material, selects it, reads the frame figures, the render
// graph, the errors, a capture and the quality. A production build has no channel, so the page
// reports that it skipped, and the test skips with it.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** One object in a listing. */
interface Summary {
	slot: number;
	name: string;
	kind: string;
}

/** One object with its transform and material. */
interface Detail {
	slot: number;
	position: number[];
	materialValues?: Record<string, unknown>;
}

run('inspect', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/boxes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	try {
		if (engine.inspect === undefined)
			return { skipped: 'the inspection channel needs a development build' };
		const inspect = engine.inspect;
		const listing = (await inspect('objects')) as { objects: Summary[]; count: number };
		const box = listing.objects.find((object) => object.name === 'box');
		if (box === undefined) throw new Error('the boxes sketch has no object named "box"');
		const filtered = (await inspect('objects', { filter: 'box' })) as { count: number };
		const changed = (await inspect('setObject', {
			selector: box.slot,
			position: [1, 2, 3],
			visible: true,
		})) as Detail;
		const read = (await inspect('object', { selector: box.slot })) as Detail;
		const material = (await inspect('setMaterial', {
			selector: box.slot,
			values: { color: '#ff0000', roughness: 0.5 },
		})) as Detail;
		const selected = (await inspect('highlight', { selector: box.slot })) as {
			selected: Summary | null;
		};
		const cleared = (await inspect('highlight', {})) as { selected: Summary | null };
		const stats = (await inspect('stats')) as { frames: number; presentedFps: number };
		const graph = (await inspect('graph')) as { graph: string };
		const errors = (await inspect('errors')) as { errors: string[] };
		const quality = (await inspect('setQuality', { preset: 'low' })) as { preset: string };
		const capture = (await inspect('capture')) as { png: string; bytes: number };
		return {
			count: listing.count,
			filtered: filtered.count,
			slot: box.slot,
			changed: changed.position,
			read: read.position,
			color: material.materialValues?.color,
			roughness: material.materialValues?.roughness,
			selected: selected.selected?.slot ?? null,
			cleared: cleared.selected,
			frames: stats.frames,
			fps: stats.presentedFps,
			graph: graph.graph.startsWith('digraph'),
			errors: errors.errors,
			preset: quality.preset,
			pngBytes: capture.bytes,
		};
	} finally {
		await engine.destroy();
	}
});
