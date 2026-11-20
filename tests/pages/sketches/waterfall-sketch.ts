// A waterfall drawn by @null3d/water. A creek 5.6 m wide runs between two banks to the edge of a dark
// cliff, and falls 18 m from its lip: glassy for a short way, then white in ropes of streaks with
// ragged edges, thinning into mist toward its foot, with a froth at the lip, mist down the fall and
// a plume where it thins away. The light is an overcast morning's. The sheet's streaks move with the
// time alone and the spray's systems start full, so the held frame shows the running fall.
import { defineSketch } from '@null3d/engine';
import { createWater, createWaterfall } from '@null3d/water';

/** The creek's half width at the lip, its current there, and how far the fall drops, in meters. */
const HALF = 2.8;
const SPEED = 1.4;
const DROP = 18;
/** The height of the rock under the creek's bed, and of the banks on each side of it. */
const BED = -0.7;
const BANK = 0.45;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials } = ctx;
	scene.setBackground({ sky: { sunPosition: [-0.35, 0.55, -0.75], cloudCoverage: 0.85 } });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.15 });
	// Fog that thickens below the cliff's top, as the cloud sea that the fall drops into.
	scene.setFog({ color: '#d9dcde', density: 0.05, height: -9, heightFalloff: 0.35 });
	scene.createDirectionalLight({ direction: [-0.75, -0.55, -0.35], intensity: 4.5 });
	scene.createHemisphereLight({ skyColor: '#d8d8d6', groundColor: '#38352f', intensity: 2.4 });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 400,
		position: [16, 10, 14],
		target: [0, -7, 0],
	});
	scene.setActiveCamera(camera);
	// The cliff: a block whose face drops straight below the lip, the creek's rock bed on its top,
	// and a bank on each side of the creek.
	const rock = materials.standard({ color: '#2b2a27', roughness: 0.95 });
	const moss = materials.standard({ color: '#4f5a2c', roughness: 1 });
	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 40, depth: 40 }),
		material: rock,
		position: [-20, BED - 20, 0],
	});
	for (const side of [-1, 1])
		scene.createMesh({
			mesh: geometry.box({ width: 40, height: BANK - BED, depth: 17 }),
			material: moss,
			position: [-20, (BANK + BED) / 2, side * (HALF + 8.5)],
		});
	// The creek runs along +x and ends at the lip, where the fall takes over.
	const water = createWater(ctx, {
		shapes: {
			kind: 'river',
			middle: [
				[-40, 0],
				[0, 0],
			],
			halfWidth: HALF,
			depth: -BED,
			speed: SPEED,
		},
		waveAmplitude: 0.2,
	});
	const fall = await createWaterfall(ctx, {
		lip: [0, 0],
		direction: [1, 0],
		halfWidth: HALF,
		speed: SPEED,
		drop: DROP,
		spread: 0.2,
	});
	fall.setLight([0.9, 0.91, 0.93]);
	return {
		onUpdate() {
			water.update();
		},
		onLateUpdate() {
			fall.update();
		},
	};
});
