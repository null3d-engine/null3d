// The asset tool's test scene twice in one place: the tool's output with its defaults, whose meshes
// are too small for stored trees, and its output with a stored tree for every part. Each copy has
// a layer of its own, so a raycast finds one copy alone. The same seeded rays must give the same
// hits through both, since a stored tree answers as the tree that the engine builds. The sketch
// posts the comparison as `results` when the page asks.
import {
	defineSketch,
	type InstanceBatch,
	type Object3D,
	type QueryTarget,
	type RaycastHit,
} from '@null3d/engine';
import { mulberry32 } from '../../../bench/scenes/spec';
import type { StoredTreeResults } from '../lib/stored-trees';

const FILES = {
	built: new URL('../assets/models/optimized/asset-scene.glb', import.meta.url).href,
	stored: new URL('../assets/models/optimized/asset-scene-trees.glb', import.meta.url).href,
};

/** The layer of each copy. */
const LAYERS = { built: 1 << 1, stored: 1 << 2 };

const RAYS = 2000;

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [4.5, 4.5, 7], target: [0, 0.9, 0] }),
	);
	const [built, stored] = await Promise.all([
		assets.loadGltf(FILES.built),
		assets.loadGltf(FILES.stored),
	]);
	const copies = { built: scene.instantiate(built), stored: scene.instantiate(stored) };
	for (const copy of ['built', 'stored'] as const)
		for (const part of [...copies[copy].objects, ...copies[copy].batches])
			part.setLayers(LAYERS[copy]);
	/** A hit's object as its place in its copy, which both copies share. */
	const placeOf = (copy: keyof typeof copies, object: QueryTarget | null) => {
		const { objects, batches } = copies[copy];
		const k = objects.indexOf(object as Object3D);
		return k >= 0 ? `object ${k}` : `batch ${batches.indexOf(object as InstanceBatch)}`;
	};
	const random = mulberry32(11);
	const range = (lo: number, hi: number) => lo + (hi - lo) * random();
	const hits = { built: [] as RaycastHit[], stored: [] as RaycastHit[] };
	const results: StoredTreeResults = { rays: 0, hits: 0, mismatches: 0, examples: [] };

	/** Casts one ray through each copy, and records how their hits differ. */
	const compare = (r: number) => {
		const origin = [range(-6, 6), range(0.5, 6), range(-6, 6)];
		const target = [range(-3, 3), range(-0.2, 2.5), range(-3, 3)];
		const direction = target.map((v, k) => v - (origin[k] as number));
		const seen = (copy: keyof typeof copies) => {
			const count = scene.raycastAll(origin, direction, { layers: LAYERS[copy] }, hits[copy]);
			return hits[copy]
				.slice(0, count)
				.map(
					(h) =>
						`${placeOf(copy, h.object)}/${h.instance}/${h.triangle} at ${h.distance} point ${Array.from(h.point as ArrayLike<number>)} normal ${Array.from(h.normal as ArrayLike<number>)}`,
				)
				.sort();
		};
		const a = seen('built');
		const b = seen('stored');
		results.rays++;
		results.hits += a.length;
		if (a.join('\n') !== b.join('\n')) {
			results.mismatches++;
			if (results.examples.length < 8)
				results.examples.push(`ray ${r}: built [${a.join('; ')}], stored [${b.join('; ')}]`);
		}
	};

	let frame = 0;
	let asked = false;
	page.onMessage((name) => {
		if (name === 'results') asked = true;
	});
	return {
		onLateUpdate() {
			frame++;
			// By the second frame, every object and the instancing node's rows have their places.
			if (frame === 2) for (let r = 0; r < RAYS; r++) compare(r);
			if (frame >= 2 && asked) {
				asked = false;
				page.post('results', results);
			}
		},
	};
});
