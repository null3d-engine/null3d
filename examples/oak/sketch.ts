// The pedunculate oak grown by the vegetation package, alone in a meadow under a noon sky, on an
// orbit camera: drag to turn round it, and the wheel to step nearer. The tree is the game's own
// asset, grown from the species record through the package's public functions, so what turns here is
// what a scene would draw. Press R to regrow it from another seed.
import { defineSketch, timeOfDay } from '@null3d/engine';
import {
	growPlant,
	loadSpeciesOrStandIn,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';
import { interact } from '../lib/interact';

const SPECIES = 'pedunculate-oak';
const HEIGHT_EYE = 1.7;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, input } = ctx;
	const day = timeOfDay('afternoon', { heading: 0.6 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	scene.setFog({ ...day.fog, density: 0.0005 });
	post.set({ exposure: day.exposure });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 80 } });
	scene.createAmbientLight(day.ambient);

	const module = await loadSpeciesOrStandIn(SPECIES);
	const kit = await prepareSpecies(ctx, module, { detail: 'high', placeholders: 'missing' });
	const materialsFor = plantMaterials(ctx, kit, {});
	const growth = { seed: 11, variant: 0, near: true };

	/** Grows another tree of the species and stands it on the same ground. */
	let planted: { destroy(): void } | undefined;
	const plant = async (seed: number) => {
		planted?.destroy();
		const asset = await growPlant(kit, { ...growth, seed });
		planted = placePlants(
			ctx,
			kit,
			[asset],
			{
				count: 1,
				position: new Float32Array([0, 0, 0]),
				turn: new Float32Array([0]),
				scale: new Float32Array([1]),
				variant: new Uint8Array([0]),
			},
			{ materials: materialsFor, view: { height: 1080, fov: 45 }, castShadows: true },
		);
	};
	await plant(growth.seed);

	// A meadow under the tree, so the foot has a ground to stand on.
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 400, height: 400 }),
		material: ctx.materials.standard({ color: [0.32, 0.36, 0.18], roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 400 });
	camera.setPosition(0, 15, 58);
	scene.setActiveCamera(camera);
	// The turns and nods orbit the tree's middle; the wheel steps in and out of it.
	const view = interact(ctx, camera, { target: [0, 12, 0], groundY: HEIGHT_EYE });
	let seed = growth.seed;
	let regrowing = false;

	return {
		onUpdate(dt) {
			view.update(dt);
			if (input.wasPressed('KeyR') && !regrowing) {
				regrowing = true;
				seed++;
				void plant(seed).finally(() => {
					regrowing = false;
				});
			}
		},
	};
});
