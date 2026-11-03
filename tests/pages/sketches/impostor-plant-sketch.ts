// A grown oak beside the far card that `bakeFarPlant` makes from it, the core's own oak until the
// species folders land (render/near-oak.fixture.ts). The left copy draws
// the plant's first card level, its wood and its shoot cards, with the plant material; the right
// copy draws only its far card, which the bake drew on the CPU from that same level, with the card
// atlas's colours and the bark's mean. The two must show the same crown in the same colour, which
// proves the far bake and the leaf coverage it reads.
import { defineSketch } from '@null3d/engine';
import {
	bakeFarPlant,
	growPlant,
	type PlantAsset,
	type PlantCopies,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';
import { nearOak } from '../../../packages/vegetation/src/render/near-oak.fixture';

/** The camera's vertical field of view in degrees, and the picture's height in pixels. */
const FOV = 42;
const HEIGHT = 270;

/** One copy at `x`, unturned. */
function copyAt(x: number): PlantCopies {
	return {
		count: 1,
		position: new Float32Array([x, 0, 0]),
		turn: new Float32Array([0]),
		scale: new Float32Array([1]),
		variant: new Uint8Array([0]),
	};
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry } = ctx;
	scene.setBackground('#20262f');
	scene.createDirectionalLight({ direction: [-0.6, -0.7, -0.45], intensity: 3.2 });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		position: [0, 10, 64],
		target: [0, 9, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 120, height: 80 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	const kit = await prepareSpecies(ctx, nearOak());
	const asset = await growPlant(kit, { seed: 7, variant: 0, near: true });
	const far = await bakeFarPlant(kit, asset);
	const looks = plantMaterials(ctx, kit);
	// The left copy shows the first card level at every distance, as the bake's source.
	const none = (level: 1 | 2) => ({ level, parts: [], from: 0, triangles: 0, bytes: 0 });
	const source: PlantAsset = {
		...asset,
		levels: [{ ...asset.levels[1], level: 0 }, none(1), none(2)],
	};
	placePlants(ctx, kit, [source], copyAt(-17), {
		materials: looks,
		view: { height: HEIGHT, fov: FOV },
	});
	// The right copy's impostor starts at once, so it draws its far card alone.
	const card: PlantAsset = { ...asset, impostor: { ...asset.impostor, from: 0 } };
	placePlants(ctx, kit, [card], copyAt(17), {
		materials: looks,
		far: [far],
		view: { height: HEIGHT, fov: FOV },
	});
	return {};
});
