// The Creek garden's built things and its big rocks: the bronze Buddha on its oval slab, over a rough
// stone step on the terrace; the roofed gate on its landing on the ridge, with a lantern on each side;
// the lanterns by the creek and at the front; and the mossy boulders by the gravel and on the slopes.
// Each is a model finished in Blender from a Tripo3D base (tools/samples/blender/creek_tripo.py), which
// the asset tool optimized and the sample-assets repository holds. Each part carries its own lower
// levels, so every copy picks its own level of detail. Places follow the concept picture, read from
// the opening view onto this land.
import type { SketchContext } from '@null3d/engine';
import { type Part, partsOf, type Stand, standPart, tintedPart } from '../../lib/blender-models';
import { random, rock } from '../../lib/procedural';
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
	TERRACE,
} from './land';
import { MOSS_MUTE, mossy } from './stones';

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

/** Where the statue stands: the terrace's middle, facing down the ridge toward the gate. */
const STATUE_AT = [TERRACE.x, TERRACE.z] as const;
const STATUE_YAW = facing(STATUE_AT, [LANDING.x, LANDING.z]);

/**
 * The rough stone step under the statue's slab, as the concept's base has: its half length and
 * half width, in meters, a little past the slab's own, how far its top stands over the terrace, how
 * thick it is, how far the moss reaches down from its top over its edges, and how roughly its faces
 * break: a dark mossy ledge, not a plate.
 */
const STEP = { long: 5, wide: 3.4, rise: 0.35, thick: 0.9, moss: 0.3, rough: 0.16 } as const;

/** The gate faces down the ridge, as the statue does, so the steps pass through it. */
const GATE_YAW = STATUE_YAW;
/** How far each gate lantern stands to the side of the gate's middle, and toward the creek. */
const GATE_LANTERN = { side: 3.9, front: 0.9 } as const;

/** The lanterns away from the gate: one on the creek's near bank, and one at the front rim. */
const LANTERNS: readonly (readonly [number, number, number])[] = [
	[11.9, 20.8, 2.6],
	[3.6, 23.6, 0.4],
];

/**
 * The big boulders: which model, its place, its turn and its size. The largest stands beside the
 * gravel garden; the others lie on the slopes under the terrace and on the banks' far side.
 */
/** A rock that the garden stands: which model, its place, its turn, its size and how deep it sinks. */
interface RockStand {
	model: 0 | 1;
	x: number;
	z: number;
	yaw: number;
	size: number;
	/** How deep its foot sinks, in meters for each unit of size. */
	sink?: number;
}

const BOULDERS: readonly RockStand[] = [
	{ model: 0, x: -9.3, z: 3.6, yaw: 0.6, size: 0.6 },
	{ model: 1, x: -17.6, z: 9.4, yaw: 2.1, size: 0.5 },
	{ model: 1, x: 17.4, z: 6.2, yaw: 4.4, size: 0.5 },
	{ model: 1, x: 4.2, z: -11.5, yaw: 1.2, size: 0.55 },
	{ model: 0, x: 15.2, z: -12.5, yaw: 3.3, size: 0.45 },
	{ model: 1, x: 6.4, z: 5.8, yaw: 5.1, size: 0.4 },
];

/** The heights of the two big boulder models at their own size, in meters. */
const MODEL_HEIGHT = [3.9, 2.3] as const;

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
	landing: LANDING.radius + 1.2,
} as const;

/** The outcrops on the hill: groups of small copies of the big boulders, sunk deep so they read as bedrock. */
function hillRocks(): RockStand[] {
	const next = random(97);
	const rocks: RockStand[] = [];
	for (let group = 0, tries = 0; group < HILL.groups && tries < HILL.groups * 40; tries++) {
		const bearing = next() * Math.PI * 2;
		const out = HILL.reach[0] + (HILL.reach[1] - HILL.reach[0]) * Math.sqrt(next());
		const [gx, gz] = [TERRACE.x + Math.cos(bearing) * out, TERRACE.z + Math.sin(bearing) * out];
		const count = HILL.group[0] + Math.floor(next() * (HILL.group[1] - HILL.group[0] + 1));
		const mine: RockStand[] = [];
		for (let k = 0; k < count; k++) {
			const [x, z] = [gx + (next() - 0.5) * 2 * HILL.spread, gz + (next() - 0.5) * 2 * HILL.spread];
			const size =
				HILL.size[0] + (HILL.size[1] - HILL.size[0]) * next() ** 1.5 * (k === 0 ? 1 : 0.7);
			const model = next() < 0.45 ? 0 : 1;
			const reach = (model === 0 ? 2.8 : 1.8) * size;
			if (!onTop(x, z) || Math.hypot(x, z) > rimRadius(bearingOf(x, z)) - reach - 0.5) continue;
			if (Math.hypot(x - LANDING.x, z - LANDING.z) < HILL.landing + reach) continue;
			if (
				flights().some((flight) => {
					const { t, side } = alongFlight(flight, x, z);
					return t > -0.15 && t < 1.15 && side < HILL.stairs + reach;
				})
			)
				continue;
			const share = HILL.sink[0] + (HILL.sink[1] - HILL.sink[0]) * next();
			mine.push({
				model,
				x,
				z,
				yaw: next() * Math.PI * 2,
				size,
				sink: share * MODEL_HEIGHT[model],
			});
		}
		if (mine.length === 0) continue;
		rocks.push(...mine);
		group++;
	}
	return rocks;
}

/** How far a model's foot sinks into the ground, so it never stands on the slope's air. */
const SINK = 0.08;

/** A stand on the ground at a point, sunk a little. */
const onGround = (x: number, z: number, yaw: number, size: number, sink = SINK): Stand => ({
	x,
	y: groundHeight(x, z) - sink * size,
	z,
	yaw,
	size,
});

/** The gate lanterns' places: one each side of the gate, a little toward the creek. */
function gateLanterns(): Stand[] {
	const [sx, sz] = [Math.cos(GATE_YAW), -Math.sin(GATE_YAW)];
	const [fx, fz] = [Math.sin(GATE_YAW), Math.cos(GATE_YAW)];
	return [-1, 1].map((side) =>
		onGround(
			LANDING.x + sx * side * GATE_LANTERN.side + fx * GATE_LANTERN.front,
			LANDING.z + sz * side * GATE_LANTERN.side + fz * GATE_LANTERN.front,
			GATE_YAW,
			1,
		),
	);
}

/**
 * Stands the garden's models: the statue on its slab over the stone step, the gate and its two
 * lanterns, the other lanterns and the big boulders. Returns a test of whether a point lies under
 * one of them, where nothing grows.
 */
export function createGarden(
	ctx: SketchContext,
	models: GardenModels,
	textureSize: number,
): (x: number, z: number) => boolean {
	const { scene, geometry, materials } = ctx;
	// The step: a flattened rough rock under the slab, whose top stands a little over the terrace.
	const terrace = groundHeight(STATUE_AT[0], STATUE_AT[1]);
	const step = scene.createMesh({
		mesh: geometry.fromArrays(
			mossy(
				rock(91, 4, [1, STEP.thick / STEP.long, STEP.wide / STEP.long], STEP.rough),
				92,
				STEP.moss,
			),
		),
		// Darker than the bank stones' colours: the ledge is dark rock with moss on its top.
		material: materials.standard({
			vertexColors: true,
			...rockMaps(ctx.textures, textureSize),
			color: '#7d756b',
			roughness: 0.95,
		}),
		castShadows: true,
		receiveShadows: true,
	});
	step.setPosition(STATUE_AT[0], terrace + STEP.rise - STEP.thick, STATUE_AT[1]);
	step.setScale(STEP.long, STEP.long, STEP.long);
	step.setRotationEuler(0, STATUE_YAW, 0);
	const top = terrace + STEP.rise;
	const statueStand: Stand = { x: STATUE_AT[0], y: top, z: STATUE_AT[1], yaw: STATUE_YAW, size: 1 };
	standPart(ctx, models.slab, [statueStand], models.slab.material);
	standPart(ctx, models.statue, [statueStand], models.statue.material);
	standPart(ctx, models.gate, [onGround(LANDING.x, LANDING.z, GATE_YAW, 1)], models.gate.material);
	const lanterns = [...gateLanterns(), ...LANTERNS.map(([x, z, yaw]) => onGround(x, z, yaw, 1))];
	standPart(ctx, models.lantern, lanterns, models.lantern.material);
	const outcrops = hillRocks();
	for (const model of [0, 1] as const) {
		const mine = [...BOULDERS, ...outcrops]
			.filter((b) => b.model === model)
			.map((b) => onGround(b.x, b.z, b.yaw, b.size, b.sink ?? 0.15));
		standPart(
			ctx,
			models.boulders[model],
			mine,
			tintedPart(materials, models.boulders[model], MOSS_MUTE, 0.95),
		);
	}
	// Footprints, in meters about each foot: the step, the gate, the lanterns and the boulders.
	const feet = [
		{ x: STATUE_AT[0], z: STATUE_AT[1], r: STEP.long },
		{ x: LANDING.x, z: LANDING.z, r: 3 },
		...lanterns.map(({ x, z }) => ({ x, z, r: 0.9 })),
		...[...BOULDERS, ...outcrops].map(({ x, z, size, model }) => ({
			x,
			z,
			r: (model === 0 ? 2.8 : 1.8) * size,
		})),
	];
	return (x, z) => feet.some((f) => Math.hypot(x - f.x, z - f.z) < f.r);
}
