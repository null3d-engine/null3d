// The add-ons' work in each frame, for S1's allocation switches: the terrain add-on's ground,
// whose quadtree follows the orbiting camera in every frame, and a field of the impostors add-on's
// cards, which pick the view each one shows from the camera in every frame. Each step takes the
// camera's position in a typed array, as a game passes its camera's position.
import type { SketchContext } from '@null3d/engine';
import { createImpostors, octahedralAtlas } from '@null3d/impostors';
import { createTerrain, terrainTextures } from '@null3d/terrain';
import { S1_BOB_HEIGHT, S1_EXTENT, S1_ORBIT } from '../../scenes/spec';

/** The top of the add-ons' ground, below the lowest boxes of the swarm and their bobbing. */
const GROUND_TOP = -S1_EXTENT - S1_BOB_HEIGHT - 2;
/**
 * The terrain's width: about four times the camera's orbit across, so the finest blocks follow the
 * camera around its circle and the far blocks change level as it goes.
 */
const TERRAIN_SIZE = 1024;
/** How far the terrain's hills rise and fall about their middle, in meters. */
const HILLS = 10;

/** The terrain's height at a point: rolling hills below the swarm. */
const hills = (x: number, z: number) =>
	GROUND_TOP - HILLS + HILLS * Math.sin(x * 0.021) * Math.cos(z * 0.017);

/**
 * Adds a terrain under the swarm, and returns the step that updates its quadtree from the camera's
 * position in each frame.
 */
export function createTerrainGround(context: SketchContext): (eye: Float64Array) => void {
	const layers = terrainTextures(context.textures, { size: 64, seed: 5 });
	const terrain = createTerrain(context, {
		size: TERRAIN_SIZE,
		height: hills,
		layers: [
			{ map: layers.grass, tile: 5 },
			{ map: layers.soil, tile: 9 },
			{ map: layers.rock, tile: 6, roughness: 0.85 },
		],
		maxLevel: 6,
	});
	return (eye) => terrain.update(eye);
}

/** The views of the impostors' atlas, and the texels along each side of one view's cell. */
const IMPOSTOR_VIEWS = 64;
const CELL_TEXELS = 16;
/** The cards along each side of the field, which spreads out to the camera's orbit. */
const IMPOSTOR_ROWS = 48;
/** The width and height of each card, in meters. */
const CARD_SIZE = 6;

/**
 * Adds a field of impostor cards on the ground around the swarm, from an atlas made in code whose
 * views each have a shade of their own, and returns the step that picks every card's view from the
 * camera's position in each frame.
 */
export async function createImpostorField({
	scene,
	textures,
}: SketchContext): Promise<(eye: Float64Array) => void> {
	const atlas = octahedralAtlas(IMPOSTOR_VIEWS);
	const width = atlas.columns * CELL_TEXELS;
	const height = atlas.rows * CELL_TEXELS;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const view = Math.floor(y / CELL_TEXELS) * atlas.columns + Math.floor(x / CELL_TEXELS);
			// A tree's outline in each cell: a triangle that narrows toward the cell's top.
			const across = Math.abs((x % CELL_TEXELS) + 0.5 - CELL_TEXELS / 2) / (CELL_TEXELS / 2);
			const up = 1 - ((y % CELL_TEXELS) + 0.5) / CELL_TEXELS;
			const inside = across < 1 - up;
			const shade = 60 + ((view * 37) % 160);
			data.set([shade * 0.4, shade, shade * 0.5, inside ? 255 : 0], (y * width + x) * 4);
		}
	const texture = textures.fromData({ width, height, data, colorSpace: 'srgb' });
	const count = IMPOSTOR_ROWS * IMPOSTOR_ROWS;
	const positions = new Float32Array(count * 3);
	const spacing = (2 * S1_ORBIT.radius) / IMPOSTOR_ROWS;
	for (let k = 0; k < count; k++) {
		positions[k * 3] = ((k % IMPOSTOR_ROWS) + 0.5) * spacing - S1_ORBIT.radius;
		positions[k * 3 + 1] = GROUND_TOP;
		positions[k * 3 + 2] = (Math.floor(k / IMPOSTOR_ROWS) + 0.5) * spacing - S1_ORBIT.radius;
	}
	const field = await createImpostors(scene, {
		texture,
		atlas,
		positions,
		size: CARD_SIZE,
		alphaMode: 'mask',
	});
	return (eye) => field.update(eye);
}
