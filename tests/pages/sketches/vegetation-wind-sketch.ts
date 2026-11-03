// A grove of grown oaks, the core's own oak until the species folders land
// (render/near-oak.fixture.ts), in the scene's one wind field: the plant material sways their
// wood, cards and real shoots, the leaves flutter, and the sun's shadows follow them. Two held times
// show the trees move, ?motion draws the motion view, whose pixels carry the sway's motion, and
// ?still holds the air, for a reference picture. The rows stand one behind another along the view,
// so the nearest draw real shoots in the near pool and the farthest stand past the sway distance.
import { defineSketch } from '@null3d/engine';
import {
	createNearPool,
	growPlant,
	type PlantCopies,
	placePlants,
	plantMaterials,
	prepareSpecies,
	setWindLayer,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { nearOak } from '../../../packages/vegetation/src/render/near-oak.fixture';

const params = new URL(import.meta.url).searchParams;
/** True to draw the motion view, where each pixel shows how far its surface moved. */
const MOTION = params.has('motion');
/** True to draw the same grove with still air. */
const STILL = params.has('still');
/** The scene's seed, which the plants' shapes come from. */
const SEED = 12;
/** The variants, and the copies of each one behind another along the view, at most. */
const VARIANTS = 4;
const COPIES = 7;
/** How far from the camera the plants sway, in metres. */
const SWAY = 70;
/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** The camera's place and the point it looks at. */
const EYE = [0, 4, 10] as const;
const TARGET = [0, 5, -40] as const;
/** The vertical field of view in degrees, and the render height of the pictures. */
const FOV = 40;
const HEIGHT = 720;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, debug, quality } = ctx;
	if (MOTION) debug.view('motion');
	// The Low preset, which a software GPU draws, grows a smaller grove with a smaller shadow map.
	const light = quality.preset === 'low';
	const variants = light ? 2 : VARIANTS;
	const rows = light ? 2 : COPIES;
	scene.setBackground('#9fc0dd');
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createDirectionalLight({
		direction: [0.15, -0.3, 1],
		color: '#fff3dc',
		intensity: 2.7,
		castShadows: true,
		shadow: { cascades: light ? 2 : 3, mapSize: light ? 1024 : 2048, distance: 200 },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 500, height: 500 }),
		material: materials.standard({ color: '#4a5137', roughness: 1, metalness: 0 }),
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: true,
	});
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.1,
		far: 600,
		position: [...EYE],
		target: [...TARGET],
	});
	scene.setActiveCamera(camera);
	const wind = createWind(ctx, {
		camera,
		box: 128,
		grid: 64,
		air: STILL ? { speed: 0, gustStrength: 0, swirl: 0 } : {},
	});

	const kit = await prepareSpecies(ctx, nearOak());
	const assets = await Promise.all(
		Array.from({ length: variants }, (_, variant) =>
			growPlant(kit, { seed: SEED, variant, near: true }),
		),
	);
	const count = variants * rows;
	const copies: PlantCopies = {
		count,
		position: new Float32Array(count * 3),
		turn: new Float32Array(count),
		// Copies at about half the oak's size, so a row of crowns fits the view.
		scale: new Float32Array(count).fill(0.55),
		variant: new Uint8Array(count),
	};
	for (let variant = 0; variant < variants; variant++)
		for (let row = 0; row < rows; row++) {
			const k = variant * rows + row;
			copies.position.set(
				[
					(variant - (VARIANTS - 1) / 2) * 9 + (row - (COPIES - 1) / 2) * 1.5,
					0,
					-6 - row * 16 - variant * 1.5,
				],
				k * 3,
			);
			copies.turn[k] = (row + variant) * 0.7;
			copies.variant[k] = variant;
		}
	const looks = plantMaterials(ctx, kit, { wind: wind.field, swayDistance: SWAY });
	const near = createNearPool(ctx, {
		camera: {
			getWorldPosition(out) {
				out[0] = EYE[0];
				out[1] = EYE[1];
				out[2] = EYE[2];
			},
		},
	});
	placePlants(ctx, kit, assets, copies, {
		materials: looks,
		near,
		view: { height: HEIGHT, fov: FOV },
		castShadows: true,
	});
	near.update();
	await near.settled();
	const swaying = Object.values(looks);

	return {
		onUpdate() {
			// The field's box follows the camera, and a gust fades, so it steps every frame.
			wind.update();
			// The pass keeps two states, so the plants read the one that this frame's run wrote.
			setWindLayer(swaying, wind.field);
			near.update();
		},
	};
});
