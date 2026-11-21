// The Creek garden's built things and its big rocks: the bronze Buddha on its oval slab, over a raised
// ledge of rough dark rock on the terrace; the roofed gate on its landing on the ridge, with a lantern
// on each side; the lanterns by the creek and at the front; and the mossy boulders by the gravel and
// on the slopes. Each is a model finished in Blender from a Tripo3D base
// (tools/samples/blender/creek_tripo.py), which the asset tool optimized and the sample-assets
// repository holds. Each part carries its own lower levels, so every copy picks its own level of
// detail. Places follow the concept picture, read from the opening view onto this land, and every
// model is seated on the lowest ground under its footprint, so no part of it hangs over a slope.
import type { MeshArrays, SketchContext } from '@null3d/engine';
import { type Part, partsOf, type Stand, standPart, tintedPart } from '../../lib/blender-models';
import { Noise, random } from '../../lib/procedural';
import { sampleUrl } from '../../lib/samples';
import { rockMaps } from './cliff';
import {
	alongFlight,
	bearingOf,
	flights,
	groundHeight,
	LANDING,
	onTop,
	rimRadius,
	STAIRS,
	statueYaw,
	TERRACE,
} from './land';
import { MOSS_MUTE } from './stones';

/** The models that the garden places. */
export interface GardenModels {
	readonly slab: Part;
	readonly statue: Part;
	readonly lantern: Part;
	readonly gate: Part;
	/** The boulders, largest first; the third is the bank stone. */
	readonly boulders: readonly [Part, Part, Part];
}

/** Loads every model at once. */
export async function loadGarden({ assets }: SketchContext): Promise<GardenModels> {
	const [statue, lantern, gate, first, second, third] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/statue/statue.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/lantern/lantern.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/gate/gate.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/boulder-1/boulder-1.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/boulder-2/boulder-2.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden/boulder-3/boulder-3.glb')),
	]);
	const statueParts = partsOf(statue);
	return {
		slab: statueParts('slab'),
		statue: statueParts('statue'),
		lantern: partsOf(lantern)('lantern'),
		gate: partsOf(gate)('gate'),
		boulders: [
			partsOf(first)('boulder-1'),
			partsOf(second)('boulder-2'),
			partsOf(third)('boulder-3'),
		],
	};
}

/** The turn about y that faces a model's front, its +z, from one point toward another. */
const facing = (from: readonly [number, number], to: readonly [number, number]) =>
	Math.atan2(to[0] - from[0], to[1] - from[1]);

/**
 * The models' footprints at their own size: how far each reaches from its middle on the ground, in
 * meters. The boulders' are a little inside their widest, since they taper to the ground.
 */
const REACH = { lantern: 0.88, gate: 2.4, boulder: [2.1, 1.4] } as const;
/** The two big boulders' heights at their own size, in meters. */
const BOULDER_HEIGHT = [3.9, 2.3] as const;
/** How far below the lowest ground under its footprint each model's foot stands, in meters. */
const SEAT = 0.03;

/**
 * The lowest ground under a footprint: its middle and two rings round it, so a model seated there
 * never hangs over the downhill side of a slope.
 */
export function lowestGround(x: number, z: number, reach: number): number {
	let low = groundHeight(x, z);
	for (const share of [0.5, 1])
		for (let k = 0; k < 12; k++) {
			const angle = (k / 12) * Math.PI * 2;
			const r = reach * share;
			low = Math.min(low, groundHeight(x + Math.cos(angle) * r, z + Math.sin(angle) * r));
		}
	return low;
}

/**
 * The raised ledge of rough dark rock under the statue's slab, as the concept's base has: its half
 * length and half width, in meters, a little past the slab's own; how far its flat top stands over
 * the highest ground under it; how far its foot reaches below the lowest; how much its outline
 * wanders, as a share; and how many points its outline has.
 */
const LEDGE = { long: 5, wide: 3.4, rise: 0.4, foot: 0.35, rough: 0.07, points: 48 } as const;

/** Where the statue stands: the terrace's middle, facing down its flights. */
const STATUE_AT = [TERRACE.x, TERRACE.z] as const;
/** The placed statue and slab's size, against the model's own. */
const STATUE_SIZE = 1;
/** How far the slab model's rim stands below its own origin, in meters at its own size. */
const SLAB_FOOT = 0.05;

/** The gate faces along its line down the ridge, so the steps pass through it. */
const GATE_YAW = facing([TERRACE.x, TERRACE.z], [LANDING.x, LANDING.z]);
/** How far each gate lantern stands to the side of the gate's middle, and toward the creek. */
const GATE_LANTERN = { side: 3.9, front: 0.9 } as const;

/** The lanterns away from the gate: one on the creek's near bank, and one at the front rim. */
const LANTERNS: readonly (readonly [number, number, number])[] = [
	[11.9, 20.8, 2.6],
	[3.6, 23.6, 0.4],
];

/** A rock that the garden stands: which boulder, its place, its turn, its size and its sink. */
interface RockPlace {
	model: 0 | 1;
	x: number;
	z: number;
	yaw: number;
	size: number;
	/** How deep its foot sinks below the lowest ground under it, as a share of its height. */
	sink: number;
}

/**
 * The big boulders. The largest stands beside the gravel garden; the others lie on the slopes under
 * the terrace and on the banks' far side.
 */
const BOULDERS: readonly RockPlace[] = [
	{ model: 0, x: -9.3, z: 3.6, yaw: 0.6, size: 0.6, sink: 0.06 },
	{ model: 1, x: -17.6, z: 9.4, yaw: 2.1, size: 0.5, sink: 0.06 },
	{ model: 1, x: 17.4, z: 6.2, yaw: 4.4, size: 0.5, sink: 0.06 },
	{ model: 1, x: 4.2, z: -11.5, yaw: 1.2, size: 0.55, sink: 0.06 },
	{ model: 0, x: 15.2, z: -12.5, yaw: 3.3, size: 0.45, sink: 0.06 },
	{ model: 1, x: 6.4, z: 5.8, yaw: 5.1, size: 0.4, sink: 0.06 },
];

/**
 * The rock of the hill under the terrace, as the concept's mossy rock between its shrubs: how many
 * outcrops, each a group of a few rocks close together, and how many rocks to a group, from least
 * to most; how far a group's rocks spread; how far out from the terrace's middle the outcrops lie
 * (from the terrace's edge to near the slope's foot); the rocks' sizes; how deep they sink, as a
 * share of their height; and how far they keep from the steps' middle line and from the landing's
 * middle, in meters.
 */
const HILL = {
	groups: 12,
	group: [2, 4],
	spread: 1.6,
	reach: [TERRACE.top + 0.2, TERRACE.top + TERRACE.slope * 0.85],
	size: [0.22, 0.55],
	sink: [0.3, 0.55],
	stairs: STAIRS.half + 1.4,
	landing: LANDING.radius + 0.6,
} as const;

/** True for a footprint that would lie on or beside a flight of steps. */
const onStairs = (x: number, z: number, reach: number) =>
	flights().some((flight) => {
		const { t, side } = alongFlight(flight, x, z);
		return t > -0.15 && t < 1.15 && side < HILL.stairs + reach;
	});

/** The outcrops on the hill: groups of small copies of the big boulders, sunk deep so they read as bedrock. */
function hillRocks(): RockPlace[] {
	const next = random(97);
	const rocks: RockPlace[] = [];
	for (let group = 0, tries = 0; group < HILL.groups && tries < HILL.groups * 40; tries++) {
		const bearing = next() * Math.PI * 2;
		const out = HILL.reach[0] + (HILL.reach[1] - HILL.reach[0]) * Math.sqrt(next());
		const [gx, gz] = [TERRACE.x + Math.cos(bearing) * out, TERRACE.z + Math.sin(bearing) * out];
		const count = HILL.group[0] + Math.floor(next() * (HILL.group[1] - HILL.group[0] + 1));
		const mine: RockPlace[] = [];
		for (let k = 0; k < count; k++) {
			const [x, z] = [gx + (next() - 0.5) * 2 * HILL.spread, gz + (next() - 0.5) * 2 * HILL.spread];
			const size =
				HILL.size[0] + (HILL.size[1] - HILL.size[0]) * next() ** 1.5 * (k === 0 ? 1 : 0.7);
			const model = next() < 0.45 ? 0 : 1;
			const reach = REACH.boulder[model] * size;
			if (!onTop(x, z) || Math.hypot(x, z) > rimRadius(bearingOf(x, z)) - reach - 0.5) continue;
			if (Math.hypot(x - LANDING.x, z - LANDING.z) < HILL.landing + reach) continue;
			if (Math.hypot(x - TERRACE.x, z - TERRACE.z) < LEDGE.long + reach + 0.3) continue;
			if (onStairs(x, z, reach)) continue;
			const sink = HILL.sink[0] + (HILL.sink[1] - HILL.sink[0]) * next();
			mine.push({ model, x, z, yaw: next() * Math.PI * 2, size, sink });
		}
		if (mine.length === 0) continue;
		rocks.push(...mine);
		group++;
	}
	return rocks;
}

/** A model placed in the garden: its stand, and how far its footprint reaches on the ground. */
export interface Placed extends Stand {
	readonly reach: number;
}

/** The ledge under the statue: its middle, its turn, its outline in meters, and its top and foot. */
export interface Ledge {
	readonly x: number;
	readonly z: number;
	readonly yaw: number;
	/** The outline's points about the middle, in the ledge's own frame: across, then along. */
	readonly outline: readonly (readonly [number, number])[];
	readonly top: number;
	readonly foot: number;
}

/** Every placed thing in the garden, found from the land alone, so a test can check them. */
export interface GardenPlaces {
	readonly ledge: Ledge;
	readonly statue: Placed;
	readonly gate: Placed;
	readonly lanterns: readonly Placed[];
	readonly rocks: readonly (Placed & { readonly model: 0 | 1 })[];
}

/** A point of a ledge's outline, in world meters. */
export function ledgePoint(ledge: Ledge, point: readonly [number, number]): [number, number] {
	const [c, s] = [Math.cos(ledge.yaw), Math.sin(ledge.yaw)];
	// The ledge's own x runs across the statue, and its z along the statue's facing.
	return [ledge.x + point[0] * c + point[1] * s, ledge.z - point[0] * s + point[1] * c];
}

let placeList: GardenPlaces | undefined;

/** Where everything stands, found once. */
export function gardenPlaces(): GardenPlaces {
	if (placeList) return placeList;
	const noise = new Noise(93);
	const yaw = statueYaw();
	const outline = Array.from({ length: LEDGE.points }, (_, k) => {
		const angle = (k / LEDGE.points) * Math.PI * 2;
		const wander = 1 + LEDGE.rough * noise.fbm2(Math.cos(angle) * 2 + 7, Math.sin(angle) * 2, 3);
		return [Math.cos(angle) * LEDGE.long * wander, Math.sin(angle) * LEDGE.wide * wander] as const;
	});
	const shape = { x: STATUE_AT[0], z: STATUE_AT[1], yaw, outline, top: 0, foot: 0 };
	let [high, low] = [-Infinity, Infinity];
	for (const point of [[0, 0] as const, ...outline]) {
		const [x, z] = ledgePoint(shape, point);
		high = Math.max(high, groundHeight(x, z));
		low = Math.min(low, groundHeight(x, z));
	}
	const ledge: Ledge = { ...shape, top: high + LEDGE.rise, foot: low - LEDGE.foot };
	const seated = (x: number, z: number, turn: number, size: number, reach: number, sink = 0) => ({
		x,
		y: lowestGround(x, z, reach) - SEAT - sink,
		z,
		yaw: turn,
		size,
		reach,
	});
	const [sx, sz] = [Math.cos(GATE_YAW), -Math.sin(GATE_YAW)];
	const [fx, fz] = [Math.sin(GATE_YAW), Math.cos(GATE_YAW)];
	const gateLanterns = [-1, 1].map((side) =>
		seated(
			LANDING.x + sx * side * GATE_LANTERN.side + fx * GATE_LANTERN.front,
			LANDING.z + sz * side * GATE_LANTERN.side + fz * GATE_LANTERN.front,
			GATE_YAW,
			1,
			REACH.lantern,
		),
	);
	placeList = {
		ledge,
		statue: {
			x: STATUE_AT[0],
			y: ledge.top + SLAB_FOOT * STATUE_SIZE,
			z: STATUE_AT[1],
			yaw,
			size: STATUE_SIZE,
			reach: LEDGE.long,
		},
		gate: seated(LANDING.x, LANDING.z, GATE_YAW, 1, REACH.gate),
		lanterns: [
			...gateLanterns,
			...LANTERNS.map(([x, z, turn]) => seated(x, z, turn, 1, REACH.lantern)),
		],
		rocks: [...BOULDERS, ...hillRocks()].map((rock) => ({
			...seated(
				rock.x,
				rock.z,
				rock.yaw,
				rock.size,
				REACH.boulder[rock.model] * rock.size,
				rock.sink * BOULDER_HEIGHT[rock.model] * rock.size,
			),
			model: rock.model,
		})),
	};
	return placeList;
}

/** Linear colors of the ledge: dark rock, and the moss on its top's rim and its upper sides. */
const LEDGE_ROCK = [0.05, 0.042, 0.033] as const;
const LEDGE_MOSS = [0.09, 0.085, 0.025] as const;

/**
 * The ledge's mesh: a flat top inside its outline, a rough chamfer, and sides that flare a little
 * out and down to its foot, with moss over the top's rim and patches on the upper sides.
 */
function ledgeArrays(ledge: Ledge): MeshArrays {
	const noise = new Noise(95);
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const n = ledge.outline.length;
	// The rings, from the top's middle out and down: the top's rim, the chamfer, and the foot.
	const rings = [
		{ out: 0, down: 0, moss: 0.85 },
		{ out: 0.08, down: 0.1, moss: 0.6 },
		{ out: 0.2, down: ledge.top - ledge.foot, moss: 0 },
	];
	const add = (x: number, y: number, z: number, moss: number, u: number, v: number) => {
		const shade = 0.8 + 0.35 * noise.value2(x * 2.3, z * 2.3 + y);
		const m = Math.min(1, Math.max(0, moss + 0.35 * noise.value2(x * 1.4 + 3, z * 1.4)));
		positions.push(x, y, z);
		for (let c = 0; c < 3; c++)
			colors.push(
				((LEDGE_ROCK[c] as number) + ((LEDGE_MOSS[c] as number) - (LEDGE_ROCK[c] as number)) * m) *
					shade,
			);
		uvs.push(u, v);
	};
	// The top: a fan from the middle, flat.
	add(ledge.x, ledge.top, ledge.z, 0, ledge.x * 0.4, ledge.z * 0.4);
	for (let k = 0; k < n; k++) {
		const [x, z] = ledgePoint(ledge, ledge.outline[k] as readonly [number, number]);
		add(x, ledge.top, z, 0.4, x * 0.4, z * 0.4);
	}
	for (let k = 0; k < n; k++) indices.push(0, 1 + ((k + 1) % n), 1 + k);
	// The sides: each ring of the outline pushed out and down, with rough wander, joined by quads.
	const side = positions.length / 3;
	let around = 0;
	for (let k = 0; k <= n; k++) {
		const point = ledge.outline[k % n] as readonly [number, number];
		const length = Math.hypot(point[0], point[1]);
		const prev = ledge.outline[(k + n - 1) % n] as readonly [number, number];
		if (k > 0) around += Math.hypot(point[0] - prev[0], point[1] - prev[1]);
		rings.forEach(({ out, down, moss }, ring) => {
			const wander = ring === 0 ? 0 : 0.06 * noise.value2(k * 0.7, ring * 3.1);
			const grow = (length + out + wander) / length;
			const [x, z] = ledgePoint(ledge, [point[0] * grow, point[1] * grow]);
			add(x, ledge.top - down, z, moss, around * 0.4, (ledge.top - down) * 0.4);
		});
	}
	const per = rings.length;
	for (let k = 0; k < n; k++)
		for (let ring = 0; ring < per - 1; ring++) {
			const a = side + k * per + ring;
			const b = side + (k + 1) * per + ring;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	return {
		positions: new Float32Array(positions),
		colors: new Float32Array(colors),
		uvs: new Float32Array(uvs),
		indices: new Uint32Array(indices),
		computeNormals: true,
	};
}

/**
 * Stands the garden's models: the statue on its slab over the rock ledge, the gate and its two
 * lanterns, the other lanterns and the boulders. Returns a test of whether a point lies under one of
 * them, where nothing grows.
 */
export function createGarden(
	ctx: SketchContext,
	models: GardenModels,
	textureSize: number,
): (x: number, z: number) => boolean {
	const { scene, geometry, materials, textures } = ctx;
	const places = gardenPlaces();
	scene.createMesh({
		mesh: geometry.fromArrays(ledgeArrays(places.ledge)),
		material: materials.standard({
			vertexColors: true,
			...rockMaps(textures, textureSize),
			roughness: 0.95,
		}),
		castShadows: true,
		receiveShadows: true,
	});
	standPart(ctx, models.slab, [places.statue], models.slab.material);
	standPart(ctx, models.statue, [places.statue], models.statue.material);
	standPart(ctx, models.gate, [places.gate], models.gate.material);
	standPart(ctx, models.lantern, places.lanterns, models.lantern.material);
	for (const model of [0, 1] as const)
		standPart(
			ctx,
			models.boulders[model],
			places.rocks.filter((rock) => rock.model === model),
			tintedPart(materials, models.boulders[model], MOSS_MUTE, 0.95),
		);
	const feet = [places.statue, places.gate, ...places.lanterns, ...places.rocks];
	return (x, z) => feet.some((f) => Math.hypot(x - f.x, z - f.z) < f.reach);
}
