// A row of impostor cards beside their shadows, on one sun: the cards stand on a ground plane and
// cast the sun's shadow through a second batch that only the light draws. The shadow has the
// crown's shape rather than the quad's, and a card is lit where the sun reaches it, because its
// shadow lookup reads the surface that its stored depth shows rather than the card's own plane.
// The two faults that the picture holds are a shadow of whole rectangles, and a card that shadows
// itself as a whole.
import { defineSketch } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';
import { pineArrays } from '../../../examples/lib/pines';

/** The layer that only the sun draws: the cast-only cards. */
const CASTER_LAYER = 2;

/** The height of each tree, in meters. */
const HEIGHT = 4.5;

/** The columns and rows of cards, and the spacing between them, in meters. */
const COLUMNS = 4;
const ROWS = 2;
const SPACING = 5;

export default defineSketch((ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	const arrays = pineArrays(0);
	scene.setBackground('#20262f');
	const sun = scene.createDirectionalLight({
		direction: [-0.5, -0.33, 0.4],
		intensity: 4.0,
		castShadows: true,
		shadow: { cascades: 3, mapSize: 1024, distance: 40 },
	});
	// The sun sees the cards that cast, and no camera draws them.
	sun.setLayers(1 | CASTER_LAYER);
	scene.createAmbientLight({ intensity: 0.22 });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 5.5, 26],
		target: [0, 2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 40 }),
		material: materials.standard({ color: '#8a94a4', roughness: 0.9 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The bake draws the same pine that the cards show, with its own vertex colours.
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
	for (let row = 0; row < ROWS; row++)
		for (let column = 0; column < COLUMNS; column++)
			positions.push((column - (COLUMNS - 1) / 2) * SPACING, 0, (row - (ROWS - 1) / 2) * SPACING);
	const common = { color, surface, atlas: bake.atlas, positions, depth: bake.depth } as const;
	const cards = createImpostors(
		{ scene, materials, geometry },
		{ ...common, alphaMode: 'mask', roughness: 0.9, receiveShadows: true },
	);
	const casters = createImpostors(
		{ scene, materials, geometry },
		{ ...common, alphaMode: 'mask', layers: CASTER_LAYER, castShadows: true },
	);
	for (const batch of [cards, casters]) {
		for (let k = 0; k < positions.length / 3; k++)
			batch.batch.scales.set([HEIGHT * cardWidth, HEIGHT * cardHeight, 1], k * 3);
		batch.markDirty();
	}
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
