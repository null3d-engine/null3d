// A lone oak under a steady wind that stops a second in: the branch poses keep their spring, so a
// branch keeps turning after the air stops and settles again. The page reads one branch's turn from
// the pose pass every few frames and posts the series, which `poses-spring.spec.ts` judges.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
	plantPoses,
	plantWind,
	setWindLayer,
	treeValues,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';

/** The sketch time at which the air stops, in seconds. */
const STOP = 1;
/** The sketch time at which the page posts its samples, in seconds. */
const END = 2.6;
/** The sketch time between two samples, in seconds. */
const EVERY = 0.1;

export default defineSketch((ctx) => {
	const { scene, geometry, quality, page } = ctx;
	void quality.set({ governor: false });
	scene.setBackground('#9fc0dd');
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createDirectionalLight({
		direction: [0.15, -0.3, 1],
		color: '#fff3dc',
		intensity: 2.7,
	});
	const camera = scene.createPerspectiveCamera({
		fov: 30,
		near: 0.1,
		far: 200,
		position: [0, 6, 16],
		target: [0, 6, 0],
	});
	scene.setActiveCamera(camera);
	// No grid: the steady field alone moves the air, so the stop is exact.
	const wind = createWind(ctx, { camera, box: 0, air: { speed: 6, heading: 0 } });
	const species = builtInSpecies('oak');
	if (!species) throw new Error('the vegetation add-on has no oak');
	const atlases = bakePlantAtlases(ctx);
	const asset = generatePlant(species, { seed: 3, variant: 0, levels: 1 });
	const field = plantWind(ctx, asset, wind.field, { swayDistance: 0 });
	const poses = plantPoses(ctx, field, asset, wind.field, {
		trees: 1,
		slots: 1,
		name: 'springPoses',
	});
	if (!poses) throw new Error('this device keeps no 16-bit float target, so it draws no poses');
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: species.color.bark,
		wind: field,
		poses,
	});
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(species),
		color: species.color.leaf,
		transmission: species.color.transmission,
		wind: field,
		poses,
		morph: { crownRadius: asset.crown.radius },
	});
	let attached = false;
	for (const part of asset.levels[0]?.parts ?? []) {
		const batch = scene.createInstances(geometry.fromArrays(part.arrays), 1, {
			material: part.name === 'wood' ? bark : leaves,
			values: true,
		});
		if (!attached) {
			poses.attach(batch);
			attached = true;
		}
		batch.positions.set([0, 0, 0], 0);
		batch.rotations.set([0, 0, 0, 1], 0);
		batch.values?.set(treeValues(0, 0, 3), 0);
		batch.markDirty();
	}

	const samples: { t: number; angle: number }[] = [];
	let stopped = false;
	let reading = false;
	let posted = false;
	let next = EVERY;
	return {
		onUpdate() {
			const now = ctx.time.now;
			if (!stopped && now >= STOP) {
				stopped = true;
				wind.setBase(0, 0);
			}
			wind.update();
			poses.update(camera);
			setWindLayer([bark, leaves], wind.field);
			if (posted || reading || now < next) return;
			next = now + EVERY;
			reading = true;
			// The turn of the first branch, which the first slot's row holds: the texel after its
			// quaternion keeps the angle in its fourth number.
			void ctx.render.readPass(poses.pass, { x: 1, y: 2, width: 1, height: 1 }).then(
				(result) => {
					reading = false;
					samples.push({ t: now, angle: result.data[3] as number });
					if (now >= END) {
						posted = true;
						page.post('spring', { stop: STOP, samples });
					}
				},
				() => {
					reading = false;
				},
			);
		},
	};
});
