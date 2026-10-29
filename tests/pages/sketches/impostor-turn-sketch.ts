// A turned tree beside its own card, on one sun: the near mesh of the shared pine turned by an
// angle, and the card baked from that same mesh and turned by the same angle. The two must show
// the same side of the crown and the same light, which proves that the card picks its views and
// lights its normals in the tree's own frame. The `?sun=back` switch puts the sun behind the row,
// so the pair that showed a lit side in the first picture shows a dark side in the second.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';
import { pineArrays } from '../../../examples/lib/pines';

/** The turn of each pair: none, a third of a turn, two thirds of a turn. */
const TURNS = [0, Math.PI / 3, (2 * Math.PI) / 3];

/** The height of each tree, in meters. */
const HEIGHT = 4.5;

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

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	const arrays = pineArrays(0);
	scene.setBackground('#20262f');
	const behind = new URL(import.meta.url).searchParams.get('sun') === 'back';
	scene.createDirectionalLight({
		direction: behind ? [0.6, -0.45, 0.8] : [-0.7, -0.45, -0.5],
		intensity: 3,
	});
	scene.createAmbientLight({ intensity: 0.45 });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		position: [0, 4.5, 24],
		target: [0, 2.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 24 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
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
				// The near material draws both sides, so the bake does too.
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

	const wood = materials.standard({ vertexColors: true, roughness: 0.9 });
	const trees = scene.createInstances(geometry.fromArrays(pineMesh(arrays)), TURNS.length, {
		material: wood,
	});
	const positions: number[] = [];
	for (const [k, turn] of TURNS.entries()) {
		const x = -9 + k * 8;
		trees.positions.set([x - 2, 0, 0], k * 3);
		trees.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], k * 4);
		trees.scales.set([HEIGHT, HEIGHT, HEIGHT], k * 3);
		positions.push(x + 2, 0, 0);
	}
	trees.markDirty();
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color,
			surface,
			atlas: bake.atlas,
			positions,
			turn: TURNS,
			alphaMode: 'mask',
			roughness: 0.9,
		},
	);
	for (let k = 0; k < TURNS.length; k++)
		cards.batch.scales.set([HEIGHT * cardWidth, HEIGHT * cardHeight, 1], k * 3);
	cards.markDirty();
	return {};
});

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
