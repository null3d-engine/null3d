// The add-ons' work in each frame, for S1's allocation switches: the terrain add-on's ground,
// whose quadtree follows the orbiting camera in every frame, a field of the impostors add-on's
// cards, which pick the view each one shows from the camera in every frame, and a cloud of the
// splats add-on's Gaussians, whose chunks a job worker selects for each camera position. Each step
// takes the camera's position in a typed array, as a game passes its camera's position.
import type { Camera, SketchContext } from '@null3d/engine';
import { createImpostors, encodeImpostorSurface, octahedralAtlas } from '@null3d/impostors';
import { createSplats, type SplatData } from '@null3d/splats';
import { createTerrain, terrainTextures } from '@null3d/terrain';
import { createWind } from '@null3d/wind';
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
 * Adds a field of impostor cards on the ground around the swarm, from atlases made in code whose
 * views each have a shade of their own. The cards blend the three nearest views and take their
 * light from the surface atlas, so nothing runs in a frame.
 */
export async function createImpostorField({
	scene,
	textures,
	materials,
	geometry,
}: SketchContext): Promise<void> {
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
	// The surface of the same cells: every view faces the viewer, with no depth, and the cards cut
	// the same outline out of it.
	const surfaceData = new Uint8Array(width * height * 4);
	const normal: [number, number, number] = [0, 0, 1];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const across = Math.abs((x % CELL_TEXELS) + 0.5 - CELL_TEXELS / 2) / (CELL_TEXELS / 2);
			const up = 1 - ((y % CELL_TEXELS) + 0.5) / CELL_TEXELS;
			const inside = across < 1 - up;
			const texel = encodeImpostorSurface(normal, 0, inside ? 1 : 0);
			surfaceData.set(texel, (y * width + x) * 4);
		}
	const texture = textures.fromData({ width, height, data, colorSpace: 'srgb' });
	const surface = textures.fromData({ width, height, data: surfaceData, colorSpace: 'linear' });
	const count = IMPOSTOR_ROWS * IMPOSTOR_ROWS;
	const positions = new Float32Array(count * 3);
	const spacing = (2 * S1_ORBIT.radius) / IMPOSTOR_ROWS;
	for (let k = 0; k < count; k++) {
		positions[k * 3] = ((k % IMPOSTOR_ROWS) + 0.5) * spacing - S1_ORBIT.radius;
		positions[k * 3 + 1] = GROUND_TOP;
		positions[k * 3 + 2] = (Math.floor(k / IMPOSTOR_ROWS) + 0.5) * spacing - S1_ORBIT.radius;
	}
	createImpostors(
		{ scene, materials, geometry },
		{
			color: texture,
			surface,
			atlas,
			positions,
			size: CARD_SIZE,
			alphaMode: 'mask',
		},
	);
}

/** The splats of the check's cloud, cut into several chunks so the task orders more than one. */
const SPLAT_COUNT = 50_000;
/** The splats that the cloud draws, which keeps the frame's sort small while the task still runs. */
const SPLAT_BUDGET = 20_000;
/** The radius of the knot's centre line, about half the camera's orbit. */
const KNOT_RADIUS = 60;
/** The radius of the tube around the knot's centre line, in meters. */
const TUBE_RADIUS = 6;

/** A repeatable number from an index and a channel, from 0 to 1, without a random generator. */
function splatHash(index: number, channel: number): number {
	let x = (index * 374761393 + channel * 668265263) >>> 0;
	x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The cloud: splats in a tube around a knot above the swarm, as the picture tests make one. */
function splatCloud(count: number): SplatData {
	const positions = new Float32Array(count * 3);
	const scales = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const colors = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		const t = (i / count) * Math.PI * 2;
		// The knot's centre line, which crosses itself as its angle and its turn differ.
		const ring = Math.cos(3 * t);
		const cx = ring * Math.cos(2 * t) * KNOT_RADIUS;
		const cy = Math.sin(3 * t) * KNOT_RADIUS * 0.4 + 20;
		const cz = ring * Math.sin(2 * t) * KNOT_RADIUS;
		// A point in the tube's ball around that line, at a spread of its own.
		let ox = splatHash(i, 1) * 2 - 1;
		let oy = splatHash(i, 2) * 2 - 1;
		let oz = splatHash(i, 3) * 2 - 1;
		const length = Math.hypot(ox, oy, oz) || 1;
		const radius = TUBE_RADIUS * (0.5 + 0.5 * splatHash(i, 4));
		ox = (ox / length) * radius;
		oy = (oy / length) * radius;
		oz = (oz / length) * radius;
		positions[i * 3] = cx + ox;
		positions[i * 3 + 1] = cy + oy;
		positions[i * 3 + 2] = cz + oz;
		const size = 0.25 + 0.15 * splatHash(i, 5);
		scales[i * 3] = size;
		scales[i * 3 + 1] = size;
		scales[i * 3 + 2] = size;
		// A unit quaternion, from three numbers in the unit ball.
		const qx = splatHash(i, 6) * 2 - 1;
		const qy = splatHash(i, 7) * 2 - 1;
		const qz = splatHash(i, 8) * 2 - 1;
		const ql = Math.hypot(qx, qy, qz) || 1;
		rotations[i * 4] = qx / ql;
		rotations[i * 4 + 1] = qy / ql;
		rotations[i * 4 + 2] = qz / ql;
		rotations[i * 4 + 3] = 1;
		const hue = splatHash(i, 9);
		colors[i * 4] = 0.3 + 0.7 * hue;
		colors[i * 4 + 1] = 0.4 + 0.6 * (1 - hue);
		colors[i * 4 + 2] = 0.8;
		colors[i * 4 + 3] = 0.5;
	}
	return { count, positions, scales, rotations, colors };
}

/** The wind's box across the ground, and how often its step sends a gust, in seconds. */
const WIND_BOX = 128;
const WIND_GUST_SECONDS = 2;

/**
 * Adds the wind add-on's field about the swarm, and returns the step that sets its base wind, sends
 * a gust, pushes the air where a body passes, samples it and places its box. The places and the
 * result are made once, here, so the step allocates nothing, as a page's own frame does not.
 */
export function createWindAir(context: SketchContext, camera: Camera): (t: number) => void {
	const wind = createWind(context, { camera, box: WIND_BOX, grid: 64 });
	const gustAt: [number, number] = [-S1_EXTENT, 0];
	const pushAt: [number, number] = [0, 0];
	const air: [number, number, number] = [0, 0, 0];
	let nextGust = 0;
	return (t) => {
		if (t >= nextGust) {
			wind.gust(gustAt);
			nextGust = t + WIND_GUST_SECONDS;
		}
		pushAt[0] = Math.cos(t) * S1_EXTENT;
		pushAt[1] = Math.sin(t) * S1_EXTENT;
		wind.push(pushAt);
		wind.sample(pushAt[0], 1, pushAt[1], air);
		wind.setBase(4, Math.sin(t * 0.1));
		wind.update();
	};
}

/**
 * Adds a cloud of the splats add-on above the swarm, cut into chunks that a job worker selects for
 * the camera's position in each frame, and returns the step that asks for the next selection.
 */
export async function createSplatCloud(
	context: SketchContext,
	asked?: number,
): Promise<(eye: Float64Array) => void> {
	// The switch may name a smaller cloud, which the software renderer's run asks for.
	const count =
		asked !== undefined && Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : SPLAT_COUNT;
	const splats = await createSplats(context, { data: splatCloud(count) });
	splats.setBudget(Math.min(SPLAT_BUDGET, Math.ceil(count / 2.5)));
	await splats.ready;
	return (eye) => splats.update(eye);
}
