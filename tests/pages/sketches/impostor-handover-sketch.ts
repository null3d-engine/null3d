// A row of pines at the hand-over distance: each one draws as its mesh and as its card at the same
// place, with the mesh's distance range ending at the switch and the card's range starting just
// before it. The engine fades a standard material's range edge with the 4 x 4 dither, and the card
// material takes no fading build, so the card stands at full coverage behind the mesh while the
// mesh's pixels dither out over it. A card that faded as well would lose the pixels that both
// dithered away, and the background would show through the crown as a dotted hole.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';
import { handOverToCards } from '@null3d/vegetation';
import { pineArrays } from '../../../examples/lib/pines';

/** The distance from the camera at which the meshes hand over to the cards, in meters. */
const SWITCH = 30;

/** The trees across the row, and the spacing between them, in meters. */
const COUNT = 3;
const SPACING = 3.4;

/** The height of each tree, in meters. */
const HEIGHT = 4.5;

/** The turn of each tree, so the hand-over shows crowns that are actually turned. */
const TURNS = [0, Math.PI / 3, (2 * Math.PI) / 3] as const;

/** The pine's triangles as a mesh, with its vertex colours and computed normals. */
function pineMesh(arrays: {
	positions: number[];
	colors: number[];
	indices: number[];
}): MeshArrays {
	return {
		positions: new Float32Array(arrays.positions),
		colors: new Float32Array(arrays.colors),
		indices: new Uint32Array(arrays.indices),
		computeNormals: true,
	};
}

export default defineSketch((ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	const arrays = pineArrays(0);
	scene.setBackground('#20262f');
	scene.createDirectionalLight({ direction: [-0.7, -0.45, -0.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.45 });
	// The camera stands inside the band, where about half of each crown's pixels belong to the mesh
	// and half to its card. A tree's distance is to the nearest point of its bounds, so the camera
	// stands one radius past the band's middle.
	// `?at=` places the camera at a share of the switch distance instead, which the filmstrip walks
	// from before the band to past it. `?only=` hides the meshes, the cards or both, so a test can
	// compare each against the ground alone, and `?cardTurn=` offsets the cards' turns alone, which
	// a test uses to show that a wrong turn is visible.
	const params = new URL(import.meta.url).searchParams;
	const at = Number(params.get('at') ?? 0.96);
	const only = params.get('only');
	const cardTurn = (Number(params.get('cardTurn') ?? 0) * Math.PI) / 180;
	const camera = scene.createPerspectiveCamera({
		fov: 22,
		position: [0, 3.5, SWITCH * at + HEIGHT * sphereRadius(arrays.positions)],
		target: [0, 2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 30 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The bake draws the same pine that the near mesh draws, with its own vertex colours.
	const bake = bakeImpostorAtlas({
		atlas: octahedralAtlas(16),
		texels: 64,
		parts: [
			{
				positions: arrays.positions,
				colors: arrays.colors,
				indices: arrays.indices,
				doubleSided: true,
			},
		],
		min: bounds(arrays.positions).min,
		max: bounds(arrays.positions).max,
	});
	const color = textures.fromData({
		width: bake.color.width,
		height: bake.color.height,
		data: bake.color.data,
		colorSpace: 'srgb',
		wrap: 'clamp',
		mipmaps: false,
	});
	const surface = textures.fromData({
		width: bake.surface.width,
		height: bake.surface.height,
		data: bake.surface.data,
		colorSpace: 'linear',
		wrap: 'clamp',
		mipmaps: false,
	});
	const [cardWidth, cardHeight] = bake.size;
	const positions: number[] = [];
	for (let k = 0; k < COUNT; k++) positions.push((k - (COUNT - 1) / 2) * SPACING, 0, 0);

	const trees = scene.createInstances(geometry.fromArrays(pineMesh(arrays)), COUNT, {
		material: materials.standard({ vertexColors: true, roughness: 0.9 }),
	});
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color,
			surface,
			atlas: bake.atlas,
			positions,
			turn: TURNS.map((turn) => turn + cardTurn),
			depth: bake.depth,
			alphaMode: 'mask',
			roughness: 0.9,
		},
	);
	for (let k = 0; k < COUNT; k++) {
		const turn = TURNS[k] ?? 0;
		trees.positions.set([positions[k * 3] as number, 0, 0], k * 3);
		trees.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], k * 4);
		trees.scales.set([HEIGHT, HEIGHT, HEIGHT], k * 3);
		cards.batch.scales.set([HEIGHT * cardWidth, HEIGHT * cardHeight, 1], k * 3);
	}
	trees.markDirty();
	cards.markDirty();
	handOverToCards(trees, cards.batch, SWITCH);
	if (only === 'mesh' || only === 'none') cards.batch.setActiveCount(0);
	if (only === 'card' || only === 'none') trees.setActiveCount(0);
	return {};
});

/** The radius of a mesh's own sphere about its origin, in the mesh's units. */
function sphereRadius(positions: readonly number[]): number {
	let radius = 0;
	for (let at = 0; at < positions.length; at += 3)
		radius = Math.max(
			radius,
			Math.hypot(positions[at] ?? 0, positions[at + 1] ?? 0, positions[at + 2] ?? 0),
		);
	return radius;
}

/** The smallest and largest corner of a list of positions. */
function bounds(positions: readonly number[]): {
	min: [number, number, number];
	max: [number, number, number];
} {
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (let at = 0; at < positions.length; at += 3)
		for (let axis = 0; axis < 3; axis++) {
			const value = positions[at + axis] as number;
			if (value < (min[axis] as number)) min[axis] = value;
			if (value > (max[axis] as number)) max[axis] = value;
		}
	return { min, max };
}
