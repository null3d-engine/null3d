// A grove of generated oaks in the scene's one wind field: the leaf and bark materials sway, the
// leaves flutter, and the sun's shadows follow them. Two held times show the trees move, and
// ?motion draws the motion view, whose pixels carry the sway's motion. ?still holds the air, for a
// reference picture. ?sway=<metres> sets how far from the camera the plants move, and ?autumn=<0 to
// 1> turns their leaves.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
	plantWind,
	treeValues,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';

const params = new URL(import.meta.url).searchParams;
/** True to draw the motion view, where each pixel shows how far its surface moved. */
const MOTION = params.has('motion');
/** True to draw the same grove with still air. */
const STILL = params.has('still');
const AUTUMN = Math.min(1, Math.max(0, Number(params.get('autumn') ?? 0)));
/** How far from the camera the plants sway, in meters: 0 moves them at every distance. */
const SWAY = Math.max(0, Number(params.get('sway') ?? 16));
/** The scene's seed, which the plants' shapes and their tints come from. */
const SEED = 12;
const VARIANTS = 4;
/** The copies of each variant, one behind another along the view. */
const COPIES = 7;
/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, quality, debug } = ctx;
	if (MOTION) debug.view('motion');
	// The far cascades take their turns, which the shadow redraw count reads, so the governor must
	// not move the preset's interval under it.
	void quality.set({ governor: false });
	scene.setBackground('#9fc0dd');
	scene.createAmbientLight({ intensity: 0.5 });
	// The sun stands in front of the camera, so the far cascades lie along its direction ahead of
	// the near plants: a near plant that sways does not reach the farthest box, and the far plants
	// stand still past the sway distance.
	scene.createDirectionalLight({
		direction: [0.15, -0.3, 1],
		color: '#fff3dc',
		intensity: 2.7,
		castShadows: true,
		shadow: { cascades: 3, mapSize: 2048, distance: 200 },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 500, height: 500 }),
		material: materials.standard({ color: '#4a5137', roughness: 1, metalness: 0 }),
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: true,
	});

	const camera = scene.createPerspectiveCamera({
		// A long lens keeps the far cascades small across the light, so the near plants that sway
		// stand outside their boxes and those cascades keep the layers they hold.
		fov: 20,
		near: 0.1,
		far: 600,
		position: [0, 5, 8],
		target: [0, 7, -80],
	});
	scene.setActiveCamera(camera);
	const wind = createWind(ctx, {
		camera,
		box: 128,
		grid: 64,
		air: STILL ? { speed: 0, gustStrength: 0, swirl: 0 } : {},
	});

	const species = builtInSpecies('oak');
	if (!species) throw new Error('the vegetation add-on has no oak');
	const atlases = bakePlantAtlases(ctx);
	const cell = leafCellFor(species);
	for (let variant = 0; variant < VARIANTS; variant++) {
		const asset = generatePlant(species, { seed: SEED, variant, levels: 1 });
		const field = plantWind(ctx, asset, wind.field, { swayDistance: SWAY });
		const bark = plantMaterial(ctx, {
			atlases,
			part: 'wood',
			color: species.color.bark,
			wind: field,
		});
		const leaves = plantMaterial(ctx, {
			atlases,
			part: 'leaves',
			cell,
			color: species.color.leaf,
			transmission: species.color.transmission,
			wind: field,
			morph: { crownRadius: asset.crown.radius },
		});
		for (const part of asset.levels[0]?.parts ?? []) {
			const batch = scene.createInstances(geometry.fromArrays(part.arrays), COPIES, {
				material: part.name === 'wood' ? bark : leaves,
				values: true,
				castShadows: true,
				receiveShadows: true,
			});
			if (!batch.values) throw new Error('the batch of a plant carries no values');
			for (let row = 0; row < COPIES; row++) {
				// The rows stand behind one another along the view, so the near plants are inside
				// the sway distance and the far ones past it.
				const x = (variant - (VARIANTS - 1) / 2) * 7 + (row - (COPIES - 1) / 2) * 1.5;
				const z = -3 - row * 16 - variant * 1.5;
				batch.positions.set([x, 0, z], row * 3);
				const yaw = (row + variant) * 0.7;
				batch.rotations.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], row * 4);
				batch.values.set(treeValues(x, z, SEED, AUTUMN), row * 4);
			}
			batch.markDirty();
		}
	}

	return {
		onUpdate() {
			// The field's box follows the camera, and a gust and a push fade, so it steps every frame.
			wind.update();
		},
	};
});
