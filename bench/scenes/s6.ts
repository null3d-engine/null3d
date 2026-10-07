// S6, the city: the generated city of the sample content, a grid of 144 blocks with towers, kit
// buildings, roads and street props, about 19,000 objects in 200 materials. A sun low in the
// evening sky casts shadows, 32 street lights light the camera's route, and an environment lights
// the rest. The camera drives the streets on a closed route, so buildings hide most of the city.
// Clicks pick buildings, and labels follow the tallest towers.
//
// The layout comes from the sample content (`sources/city/layout/layout.json`); the pages load it
// as a file, and pass it to `createS6`. The models come from the city's two model files, which
// bench/lib/city-files.ts builds from the layout. Everything here is plain data and pure functions
// with no engine imports, as in spec.ts. The per-frame functions write into arrays that the caller
// owns, so they allocate nothing.
import type { OutArray, SceneLights } from './spec';

/** The layout file of the sample content, as its generator writes it. */
export interface S6Layout {
	generator: string;
	seed: number;
	units: string;
	up: string;
	size: [number, number];
	counts: { objects: number; buildings: number; models: number; materials: number; lights: number };
	/** The Kenney models that the rows place, as paths in the sample content. */
	models: string[];
	materials: S6Material[];
	lights: {
		position: [number, number, number];
		color: [number, number, number];
		intensity: number;
		range: number;
	}[];
	/** A closed route along road centre lines, at a height and speed, in metres and metres per second. */
	camera: { height: number; speed: number; closed: boolean; path: [number, number][] };
	/** Names for the tallest towers: the tower's building and its highest box's row. */
	labels: { building: number; object: number; text: string }[];
	/** One row per object, with the fields that `fields` names. */
	objects: { fields: string[]; rows: number[][] };
}

/** One of the layout's materials: an ambientCG texture set in a tint. */
export interface S6Material {
	set: string;
	family: string;
	maps: Partial<
		Record<'color' | 'normal' | 'roughness' | 'occlusion' | 'metalness' | 'emission', string>
	>;
	/** A linear colour that multiplies the colour map. */
	tint: [number, number, number];
	/** The metres that one repeat of the texture covers. */
	metresPerRepeat: number;
}

/** A model of -1 marks a unit box, and a building of -1 an object of no building. */
export const S6_BOX = -1;

/**
 * The street tiles: the road models that cover the streets edge to edge, one tile wide at their
 * row's scale. Where two tiles meet, a pixel on their shared edge can fall inside both at the same
 * depth, and WebGPU draws the copies of one mesh in any order, so either tile could win it in any
 * frame. Every other tile stands a step higher, so the higher one wins such a pixel in every frame.
 */
export const S6_STREET_TILES = /\/road-(straight|crossroad)\.glb$/;

/** The step between neighbouring street tiles, in metres: far below what a pixel shows. */
export const S6_TILE_STEP = 0.01;

/** The objects of the whole city: the pinned layout's rows. */
export const S6_FULL_COUNT = 19_173;

/**
 * The engine objects that the whole city makes, with room to spare: one mesh for each part of each
 * row's model, a box for each box row, and the lights, the camera and the label's marker. The page
 * asks the engine for this room at its start, so its object tables never grow during play.
 */
export const S6_ENGINE_OBJECTS = 21_000;

/** The messages that S6's sketch sends its page. */
export const S6_MESSAGES = {
	/** The labels' ids and texts, once, at the setup. */
	labels: 's6-labels',
	/** The city is whole: the seconds of each stage from the setup's start, and the bytes loaded. */
	loaded: 's6-loaded',
	/** A click picked a building: its number. */
	picked: 's6-picked',
} as const;

/** The label that names the picked building. */
export const S6_PICKED_LABEL = 'picked';

/** The id of the label on the tallest towers' tower k. */
export const s6LabelId = (k: number) => `tower-${k}`;

/** The clear colour, behind the sky while it loads: a dusk blue. */
export const S6_BACKGROUND = '#6f7f96';

/**
 * The sun: low in the west of an evening sky, so long shadows cross the streets. Its direction is
 * the way its light travels.
 */
export const S6_VIEW_LIGHTS: SceneLights = {
	sun: { direction: [0.62, -0.42, 0.66], color: '#ffd9a8', intensity: 2.2, castShadows: true },
	ambient: { color: '#9fb4d0', intensity: 0.15 },
};

/**
 * The sky behind the city, three.js's `Sky` with its uniforms: its sun stands where the light comes
 * from. It lights nothing, so the environment lights the scene.
 */
export const S6_SKY = {
	turbidity: 4,
	rayleigh: 2,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.8,
} as const;

/** The sky's sun position, a unit vector toward the sun. */
export const S6_SUN_POSITION: readonly [number, number, number] = (() => {
	const [x, y, z] = S6_VIEW_LIGHTS.sun.direction as readonly [number, number, number];
	const length = Math.hypot(x, y, z);
	return [-x / length, -y / length, -z / length];
})();

/** How strongly the environment lights the city. */
export const S6_ENVIRONMENT_INTENSITY = 0.5;

/** Bloom: what glows, such as the lit windows and street lights, spreads a little. */
export const S6_BLOOM = { intensity: 0.15, threshold: 1 } as const;

/** Ambient occlusion, in GTAOPass's meanings, at the preset's resolution. */
export const S6_AO = { radius: 0.5, intensity: 1 } as const;

/** The camera's lens: wide enough to see a street, and far enough to see across the city. */
export const S6_CAMERA = { fov: 60, near: 0.5, far: 1500 } as const;

/**
 * How far from the camera the sun's shadows reach, in meters: null3D's default, and the far end of
 * the three.js twin's cascades.
 */
export const S6_SHADOW_DISTANCE = 200;

/**
 * Where the camera looks: a point `ahead` metres further along the route, `drop` metres below the
 * camera's height, so it looks down the street and turns before each corner.
 */
export const S6_LOOK = { ahead: 30, drop: 1.5 } as const;

/** Where a label sits: this far above its tower's top, in metres. */
export const S6_LABEL_RISE = 4;

/** Where the picked building's label sits: this far above the point that the click hit, in metres. */
export const S6_PICK_RISE = 2;

/** S6's objects and route, from the layout. */
export interface S6Data {
	/** The rows that the scene creates: every row of the layout, or the nearest ones it asks for. */
	count: number;
	/** The model of each row, or `S6_BOX` for a box. */
	model: Int16Array;
	/** The material of each box, or -1 for a kit model's own. */
	material: Int16Array;
	/** The building of each row, or -1. */
	building: Int32Array;
	/** The centre of each row's base, 3 floats per row. */
	position: Float32Array;
	/** Each row's turn about +Y, in radians. */
	rotationY: Float32Array;
	/** Each row's scale, 3 floats per row: a box's size, or a kit model's scale. */
	scale: Float32Array;
	/** The rows of kit models, nearest the route's start first. */
	kitOrder: Uint32Array;
	/** The rows of boxes, nearest the route's start first. */
	boxOrder: Uint32Array;
	/** The building count. */
	buildings: number;
	/** The route's corners, 2 floats each (x, z), and the distance along the route at each corner. */
	route: Float64Array;
	routeDistance: Float64Array;
	/** The route's length in metres, the camera's height and speed. */
	routeLength: number;
	height: number;
	speed: number;
	/**
	 * The labels whose towers the scene creates: each one's text, its row and the height of its
	 * tower's top above that row's base.
	 */
	labels: { text: string; row: number; building: number; height: number }[];
	lights: S6Layout['lights'];
}

/**
 * Makes S6's data from the layout. With `count`, only the `count` rows nearest the route's start
 * are created, kit models and boxes alike, so the city can grow from the camera's first view for a
 * sweep. Throws for a layout whose rows lack a field.
 */
export function createS6(layout: S6Layout, count = layout.objects.rows.length): S6Data {
	const { fields, rows } = layout.objects;
	const field = (name: string) => {
		const at = fields.indexOf(name);
		if (at < 0) throw new Error(`S6's layout has no row field ${name}.`);
		return at;
	};
	const f = {
		model: field('model'),
		material: field('material'),
		building: field('building'),
		x: field('x'),
		y: field('y'),
		z: field('z'),
		rotationY: field('rotationY'),
		sx: field('sx'),
		sy: field('sy'),
		sz: field('sz'),
	};
	if (!(Number.isSafeInteger(count) && count > 0))
		throw new RangeError(`S6 needs a whole number of objects above 0, not ${count}.`);
	const total = rows.length;
	const data: S6Data = {
		count: Math.min(count, total),
		model: new Int16Array(total),
		material: new Int16Array(total),
		building: new Int32Array(total),
		position: new Float32Array(total * 3),
		rotationY: new Float32Array(total),
		scale: new Float32Array(total * 3),
		kitOrder: new Uint32Array(0),
		boxOrder: new Uint32Array(0),
		buildings: layout.counts.buildings,
		route: new Float64Array(layout.camera.path.flat()),
		routeDistance: new Float64Array(layout.camera.path.length + 1),
		routeLength: 0,
		height: layout.camera.height,
		speed: layout.camera.speed,
		labels: [],
		lights: layout.lights,
	};
	const streetTile = layout.models.map((path) => S6_STREET_TILES.test(path));
	rows.forEach((row, i) => {
		const model = row[f.model] as number;
		const x = row[f.x] as number;
		const z = row[f.z] as number;
		// Neighbouring tiles differ by one in one of their grid places, so they get different steps.
		const step =
			streetTile[model] &&
			(Math.round(x / (row[f.sx] as number)) + Math.round(z / (row[f.sz] as number))) % 2 !== 0
				? S6_TILE_STEP
				: 0;
		data.model[i] = model;
		data.material[i] = row[f.material] as number;
		data.building[i] = row[f.building] as number;
		data.position.set([x, (row[f.y] as number) + step, z], i * 3);
		data.rotationY[i] = row[f.rotationY] as number;
		data.scale.set([row[f.sx] as number, row[f.sy] as number, row[f.sz] as number], i * 3);
	});

	const corners = layout.camera.path;
	let length = 0;
	corners.forEach((a, k) => {
		const b = corners[(k + 1) % corners.length] as [number, number];
		data.routeDistance[k] = length;
		length += Math.hypot(b[0] - a[0], b[1] - a[1]);
	});
	data.routeDistance[corners.length] = length;
	data.routeLength = length;

	// Rows nearest the route's start come first, so a page that creates objects in turns shows the
	// camera's first view soonest.
	const [sx, sz] = corners[0] as [number, number];
	const distance = (i: number) =>
		Math.hypot((data.position[i * 3] as number) - sx, (data.position[i * 3 + 2] as number) - sz);
	const nearest = Array.from({ length: total }, (_, i) => i)
		.sort((a, b) => distance(a) - distance(b) || a - b)
		.slice(0, data.count);
	data.kitOrder = Uint32Array.from(nearest.filter((i) => data.model[i] !== S6_BOX));
	data.boxOrder = Uint32Array.from(nearest.filter((i) => data.model[i] === S6_BOX));

	const created = new Set(nearest);
	data.labels = layout.labels
		.filter(({ object }) => created.has(object))
		.map(({ text, object, building }) => {
			if (data.model[object] !== S6_BOX) throw new Error(`S6's label ${text} is not on a box.`);
			return { text, row: object, building, height: data.scale[object * 3 + 1] as number };
		});
	return data;
}

/** Writes the point at `distance` metres along the closed route, at height `y`, into `out`. */
function routePoint(data: S6Data, distance: number, y: number, out: OutArray): void {
	const { route, routeDistance, routeLength } = data;
	const corners = route.length / 2;
	let d = distance % routeLength;
	if (d < 0) d += routeLength;
	let k = 0;
	while (k < corners - 1 && d >= (routeDistance[k + 1] as number)) k++;
	const next = (k + 1) % corners;
	const span = (routeDistance[k + 1] as number) - (routeDistance[k] as number);
	const t = span > 0 ? (d - (routeDistance[k] as number)) / span : 0;
	const ax = route[k * 2] as number;
	const az = route[k * 2 + 1] as number;
	out[0] = ax + ((route[next * 2] as number) - ax) * t;
	out[1] = y;
	out[2] = az + ((route[next * 2 + 1] as number) - az) * t;
}

/**
 * Writes S6's camera at time t: on the route at the layout's speed and height, looking at a point
 * further along it, so the view turns smoothly into each corner.
 */
export function s6Camera(
	data: S6Data,
	t: number,
	outPosition: OutArray,
	outTarget: OutArray,
): void {
	const distance = t * data.speed;
	routePoint(data, distance, data.height, outPosition);
	routePoint(data, distance + S6_LOOK.ahead, data.height - S6_LOOK.drop, outTarget);
}

/** The seconds that the camera takes to drive the whole route once. */
export const s6LoopSeconds = (data: S6Data): number => data.routeLength / data.speed;

/**
 * Writes the world place, turn and scale of one part of a row's kit model: the row's place, its
 * turn about +Y and its scale, applied to the part's place in its model (`partPosition`,
 * `partRotation` as a quaternion x, y, z, w, and `partScale`). The rows scale kit models evenly, so
 * the part keeps its own scale's shape.
 */
export function s6PartTransform(
	data: S6Data,
	row: number,
	partPosition: ArrayLike<number>,
	partRotation: ArrayLike<number>,
	partScale: ArrayLike<number>,
	outPosition: OutArray,
	outRotation: OutArray,
	outScale: OutArray,
): void {
	const s = data.scale[row * 3] as number;
	const half = (data.rotationY[row] as number) / 2;
	const ry = Math.sin(half);
	const rw = Math.cos(half);
	const px = (partPosition[0] as number) * s;
	const py = (partPosition[1] as number) * s;
	const pz = (partPosition[2] as number) * s;
	// A turn of angle a about +Y takes (x, z) to (x cos a + z sin a, -x sin a + z cos a).
	const cos = rw * rw - ry * ry;
	const sin = 2 * ry * rw;
	outPosition[0] = (data.position[row * 3] as number) + px * cos + pz * sin;
	outPosition[1] = (data.position[row * 3 + 1] as number) + py;
	outPosition[2] = (data.position[row * 3 + 2] as number) - px * sin + pz * cos;
	// The row's turn times the part's: (0, ry, 0, rw) * (x, y, z, w).
	const x = partRotation[0] as number;
	const y = partRotation[1] as number;
	const z = partRotation[2] as number;
	const w = partRotation[3] as number;
	outRotation[0] = rw * x + ry * z;
	outRotation[1] = rw * y + ry * w;
	outRotation[2] = rw * z - ry * x;
	outRotation[3] = rw * w - ry * y;
	outScale[0] = s * (partScale[0] as number);
	outScale[1] = s * (partScale[1] as number);
	outScale[2] = s * (partScale[2] as number);
}
