// A leaned, asymmetric pine drawn beside its own card, seen from the side: the two stand across the
// view at the same distance, turned by the same angle, and one sun lights them both. The camera's
// default azimuth is 90 degrees from the world's forward, where a card that turned its stored normal
// with the camera's own frame would light the opposite side of its crown to its mesh. A card that
// turns only with its tree lights the same side as the mesh, so the pair matches at any azimuth. The
// camera circles about the pair, which stays across its view, so `?azimuth=` shows the same pair
// from another side.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';
import { pineArrays } from '../../../examples/lib/pines';

/** The height of each tree, in meters. */
const HEIGHT = 4.5;
/** The turn of the tree and its card about the world's up, in radians. */
const TURN = Math.PI;
/** How far the crown leans across its own z axis for each meter of height. */
const LEAN = 0.45;
/** The distance from the pair's middle to each of the two, in meters. */
const PAIR = 2.2;
/** The camera's distance from the pair, in meters. */
const REACH = 16;

/** The pine's positions leaned across z, so its crown is not symmetric about its trunk. */
function leaned(positions: readonly number[]): Float32Array {
	const out = new Float32Array(positions.length);
	for (let at = 0; at < positions.length; at += 3) {
		out[at] = positions[at] as number;
		out[at + 1] = positions[at + 1] as number;
		out[at + 2] = (positions[at + 2] as number) + LEAN * (positions[at + 1] as number);
	}
	return out;
}

export default defineSketch((ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	const arrays = pineArrays(0);
	const positions = leaned(arrays.positions);
	const bounds = boundsOf(positions);
	scene.setBackground('#20262f');
	scene.createDirectionalLight({ direction: [-0.7, -0.45, -0.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.45 });
	const params = new URL(import.meta.url).searchParams;
	const azimuth = (Number(params.get('azimuth') ?? 90) * Math.PI) / 180;
	const camera = scene.createPerspectiveCamera({
		fov: 30,
		position: [Math.sin(azimuth) * REACH, 4.5, Math.cos(azimuth) * REACH],
		target: [0, 2.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 24 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// The bake draws the same leaned pine that the near mesh draws.
	const bake = bakeImpostorAtlas({
		atlas: octahedralAtlas(25),
		texels: 96,
		parts: [
			{
				positions,
				colors: arrays.colors,
				indices: arrays.indices,
				doubleSided: true,
			},
		],
		min: bounds.min,
		max: bounds.max,
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
	// The pair lies across the camera's view, so both stand the same distance from it.
	const right: [number, number, number] = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
	const mesh: MeshArrays = {
		positions,
		colors: new Float32Array(arrays.colors),
		indices: new Uint32Array(arrays.indices),
		computeNormals: true,
	};
	const trees = scene.createInstances(geometry.fromArrays(mesh), 1, {
		material: materials.standard({ vertexColors: true, roughness: 0.9 }),
	});
	const turn: [number, number, number, number] = [0, Math.sin(TURN / 2), 0, Math.cos(TURN / 2)];
	trees.positions.set([-right[0] * PAIR, 0, -right[2] * PAIR]);
	trees.rotations.set(turn);
	trees.scales.set([HEIGHT, HEIGHT, HEIGHT]);
	trees.markDirty();
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color,
			surface,
			atlas: bake.atlas,
			positions: [right[0] * PAIR, 0, right[2] * PAIR],
			turn: [TURN],
			alphaMode: 'mask',
			roughness: 0.9,
		},
	);
	cards.batch.scales.set([HEIGHT * cardWidth, HEIGHT * cardHeight, 1]);
	cards.markDirty();
	return {};
});

/** The smallest and largest corner of a list of positions. */
function boundsOf(positions: ArrayLike<number>): {
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
