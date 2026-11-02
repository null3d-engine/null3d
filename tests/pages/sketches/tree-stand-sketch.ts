// A stand of one review species, drawn as a scene draws the add-on: instance batches with the
// plant's three levels, the wind field, shadows and the generated atlases. ?species= names the
// review tree, ?count= the copies, ?fill= scales the filled crown, ?spacing= the grid step and
// ?governor=off holds the render scale, so a timing says whether the frame budget moved it.
import { defineSketch, type InstanceBatch, math } from '@null3d/engine';
import {
	bakePlantAtlases,
	generatePlant,
	leafCellFor,
	type PlantMaterial,
	plantMaterial,
	plantWind,
	setWindLayer,
	shadowCasterLevel,
	treeValues,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { reviewTree } from '../lib/tree-corpus';

const params = new URL(import.meta.url).searchParams;
const base = reviewTree(params.get('species') ?? 'review-pine');
if (!base) throw new Error(`the review has no ${params.get('species')} tree`);
const COUNT = Math.max(1, Math.min(100, Number(params.get('count') ?? 20)));
const FILL = Math.max(0, Number(params.get('fill') ?? 1));
const SPACING = Math.max(2, Number(params.get('spacing') ?? 8));
const SPECIES =
	base.leaf && FILL !== 1
		? { ...base, leaf: { ...base.leaf, fill: (base.leaf.fill ?? 0) * FILL } }
		: base;

/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, quality } = ctx;
	// The governor lowers the live settings when frames take too long, so a timing that leaves it on
	// measures the engine's own adjustment as much as the stand. A run names which of the two it is.
	if (params.get('governor') === 'off') quality.set({ governor: false });
	// A cost run holds the render scale or turns shadows off, one at a time, so the difference a
	// preset makes can be pinned on a setting rather than guessed at.
	const SCALE = Number(params.get('scale') ?? 0);
	if (SCALE > 0) quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE });
	const SHADOWS = params.get('shadows') !== 'off';
	// A shadow proxy casts from the coarsest level alone, and a low sun stretches whatever the proxy
	// leaves out across the ground where it shows.
	// Every stand casts from the level the record names, so a cost run measures the shipping
	// arrangement rather than a variant of it.
	const SHADOW_PROXY = true;
	const LOW_SUN = params.get('sun') === 'low';
	scene.setBackground('#9fc0dd');
	scene.createDirectionalLight({
		direction: LOW_SUN ? [-0.85, -0.35, -0.4] : [-0.5, -1, -0.35],
		intensity: 3.1,
		castShadows: SHADOWS,
		shadow: { distance: 60, mapSize: 1024 },
	});
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createHemisphereLight({ skyColor: '#cfe0ea', groundColor: '#7d7462', intensity: 1.1 });
	const ground = materials.standard({ color: '#8c8a80', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: ground,
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: true,
	});

	const asset = generatePlant(SPECIES, { seed: 11, variant: 0 });
	const atlases = bakePlantAtlases(ctx);
	const side = Math.ceil(Math.sqrt(COUNT));
	const reach = side * SPACING;
	const camera = scene.createPerspectiveCamera({
		fov: 48,
		near: 0.1,
		far: 500,
		position: [reach * 0.85, asset.crown.max[1] * 0.75, reach * 1.15],
		target: [0, asset.crown.max[1] * 0.35, 0],
	});
	scene.setActiveCamera(camera);
	const wind = createWind(ctx, { camera, box: 96, grid: 64 });
	const field = plantWind(ctx, asset, wind.field, { swayDistance: 0 });
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(SPECIES),
		color: SPECIES.color.leaf as [number, number, number],
		transmission: SPECIES.color.transmission,
		alphaCutoff: SPECIES.leaf?.kind === 'needle' ? 0.2 : 0.24,
		wind: field,
	});
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: SPECIES.color.bark as [number, number, number],
		wind: field,
	});
	const batches: InstanceBatch[] = [];
	const proxyBatches: InstanceBatch[] = [];
	// The shadow casts from the level the record names, unless the plant is too small for a coarse one.
	const coarseLevel = asset.levels[shadowCasterLevel(asset)];
	for (const part of asset.levels[0]?.parts ?? []) {
		const baseMesh = geometry.fromArrays(part.arrays);
		baseMesh.setLevels(
			asset.levels.slice(1).map((level) => {
				const coarser = level.parts.find((other) => other.name === part.name);
				if (!coarser) throw new Error(`a ${part.name} part has no coarser level`);
				return { mesh: geometry.fromArrays(coarser.arrays), error: level.error };
			}),
			{ fade: false },
		);
		batches.push(
			scene.createInstances(baseMesh, COUNT, {
				material: part.name === 'wood' ? bark : leaves,
				values: true,
				castShadows: !SHADOW_PROXY,
				receiveShadows: true,
			}),
		);
		if (SHADOW_PROXY) {
			const coarse = coarseLevel?.parts.find((other) => other.name === part.name);
			if (coarse) {
				proxyBatches.push(
					scene.createInstances(geometry.fromArrays(coarse.arrays), COUNT, {
						material: part.name === 'wood' ? bark : leaves,
						values: true,
						castShadows: true,
						receiveShadows: false,
					}),
				);
			}
		}
	}
	math.seed(11);
	for (let k = 0; k < COUNT; k++) {
		const column = k % side;
		const row = Math.floor(k / side);
		const [x, z] = [(column - (side - 1) / 2) * SPACING, (row - (side - 1) / 2) * SPACING];
		const scale = 0.9 + 0.2 * ((k * 0.6180339887498949) % 1);
		const turn = (k * 2.399963229728653) % (Math.PI * 2);
		for (const batch of [...batches, ...proxyBatches]) {
			batch.positions.set([x, 0, z], k * 3);
			batch.scales.fill(scale, k * 3, k * 3 + 3);
			batch.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], k * 4);
			batch.values?.set(treeValues(x, z, 11, 0), k * 4);
		}
	}
	for (const batch of [...batches, ...proxyBatches]) batch.markDirty(0, COUNT);

	return {
		onUpdate() {
			wind.update();
			setWindLayer([leaves, bark] as PlantMaterial[], wind.field);
		},
	};
});
