// The flights of stone steps from the creek's far bank through the gate to the terrace: worn grey
// slabs, uneven in length and edge, pale on the tread and dark on the riser, with moss creeping in
// at their ends, and a low wall of stacked rock along each side. Each step sits on the even ramp
// that the land lays under its flight, with its body sunk below the ramp, so none floats above the
// ground or sinks into it.
import type { MeshArrays, SketchContext } from '@null3d/engine';
import { Noise, random, rock } from '../../lib/procedural';
import { rockMaps } from './cliff';
import { gardenPlaces, lowestGround, nearLedge } from './garden';
import { alongFlight, flights, STAIRS } from './land';
import { mossy } from './stones';

/**
 * The slabs: how far each reaches past its tread's length, so the steps overlap a little; how far its
 * body sinks below the ramp; how far its tread stands over the ramp; how much the step's width, a slab's edges and its height wander, in
 * meters; how far a slab turns off the flight's line, in radians; how much its length wanders, as a
 * share; half the joint between two slabs of a step, in meters; and the share of steps laid in three
 * slabs rather than two. A step's tread has up to as many strips across as the constant below, so
 * the moss can creep in at the ends.
 */
const SLAB = {
	overlap: 0.08,
	sink: 0.35,
	lift: 0.03,
	width: 0.12,
	edge: 0.06,
	height: 0.025,
	turn: 0.05,
	length: 0.12,
	joint: 0.025,
	three: 0.4,
} as const;
const STRIPS = 6;

/**
 * Linear colors of the steps: the worn tread, the shaded riser and the moss at the ends. The tread
 * leans cool, so the rock texture's warm cast leaves it a pale, near-grey stone, paler than the
 * moss.
 */
const TREAD = [0.82, 0.84, 0.9] as const;
const RISER = [0.1, 0.092, 0.08] as const;
const MOSS = [0.12, 0.11, 0.028] as const;
/**
 * Linear colors of the wall stones: a grey stone, and moss as light as the ground's. The rock
 * texture darkens and warms both, so they stand lighter and greener than they draw.
 */
const WALL_TONES = { stone: [0.3, 0.29, 0.28], moss: [0.2, 0.2, 0.06] } as const;

/**
 * The side walls: how far out from the steps' edge they stand, their stones' spacing and sizes, the
 * courses, how far a stone's footprint reaches on the ground, as a share of its size, and how far
 * past the ledge's oval they stop, in meters, so the rock round the ledge flanks the cut steps.
 */
const WALL = {
	out: 0.45,
	spacing: 0.5,
	size: [0.24, 0.36],
	rows: 2,
	reach: 1.2,
	ledge: 0.8,
} as const;

const noise = new Noise(71);

/** Adds one face of four corners, each with a color, to the arrays being built. */
function face(
	built: {
		positions: number[];
		normals: number[];
		colors: number[];
		uvs: number[];
		indices: number[];
	},
	corners: readonly (readonly [number, number, number])[],
	shades: readonly (readonly [number, number, number])[],
	normal: readonly [number, number, number],
): void {
	const first = built.positions.length / 3;
	// An upright face takes its texture along itself and up, so the grain does not run in streaks.
	const upright = Math.abs(normal[1]) < 0.5;
	corners.forEach((corner, k) => {
		built.positions.push(...corner);
		built.normals.push(...normal);
		built.colors.push(...(shades[k] as readonly [number, number, number]));
		if (upright)
			built.uvs.push((corner[0] * -normal[2] + corner[2] * normal[0]) * 0.5, corner[1] * 0.5);
		else built.uvs.push(corner[0] * 0.5, corner[2] * 0.5);
	});
	// The triangles wind so that their front faces the given normal.
	const [a, b, c] = corners as readonly [
		readonly [number, number, number],
		readonly [number, number, number],
		readonly [number, number, number],
	];
	const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	const facing =
		(uy * vz - uz * vy) * normal[0] +
		(uz * vx - ux * vz) * normal[1] +
		(ux * vy - uy * vx) * normal[2];
	if (facing >= 0) built.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	else built.indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
}

/** A tone of a color, darkened or lightened by the noise at a point. */
const tone = (color: readonly [number, number, number], x: number, z: number, depth: number) => {
	const shade = 1 + depth * noise.value2(x * 3.1, z * 3.1);
	return [color[0] * shade, color[1] * shade, color[2] * shade] as const;
};

/**
 * Every slab of every flight, found from the land alone, so a test can check them: each step lies in
 * two or three slabs of uneven length across the flight, with narrow joints between them, so no step
 * reads as one long plank. Each tread stands a little over the ramp under it, so no ground shows
 * through the top one.
 */
export function slabPlaces(): SlabPlace[] {
	const next = random(73);
	const places: SlabPlace[] = [];
	for (const flight of flights()) {
		const [dx, dz] = [flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]];
		const length = Math.hypot(dx, dz);
		const tread = length / flight.steps;
		const rise = (flight.high - flight.low) / flight.steps;
		for (let k = 0; k < flight.steps; k++) {
			const along = (k + 0.5) * tread;
			const middle: [number, number] = [
				flight.from[0] + (dx / length) * along,
				flight.from[1] + (dz / length) * along,
			];
			const half = STAIRS.half + (next() * 2 - 1) * SLAB.width;
			const top = flight.low + (k + 1) * rise + SLAB.lift;
			const pieces = next() < SLAB.three ? 3 : 2;
			const cuts = [-1];
			for (let p = 1; p < pieces; p++)
				cuts.push(-1 + (2 * p) / pieces + (next() - 0.5) * (1.2 / pieces));
			cuts.push(1);
			const joint = SLAB.joint / half;
			for (let p = 0; p < pieces; p++)
				places.push({
					middle,
					heading: Math.atan2(dz, dx),
					half,
					from: (cuts[p] as number) + (p > 0 ? joint : 0),
					to: (cuts[p + 1] as number) - (p < pieces - 1 ? joint : 0),
					depth: tread / 2,
					top,
					bottom: top - rise - SLAB.sink,
				});
		}
	}
	return places;
}

/** One slab of a step: its share of the step's width, from `from` to `to` across it, from -1 to 1. */
export interface SlabPlace {
	middle: readonly [number, number];
	heading: number;
	half: number;
	from: number;
	to: number;
	depth: number;
	top: number;
	bottom: number;
}

/**
 * One slab, added to the arrays being built: its tread in strips across, each corner a little off
 * level and its front edge broken; moss creeping in from the step's ends and in patches; its riser,
 * ends and back in shade.
 */
function slab(built: Parameters<typeof face>[0], next: () => number, place: SlabPlace): void {
	const turn = place.heading + (next() * 2 - 1) * SLAB.turn;
	const [fx, fz] = [Math.cos(turn), Math.sin(turn)];
	const [sx, sz] = [-fz, fx];
	const [cx, cz] = place.middle;
	const corner = (a: number, b: number, y: number): [number, number, number] => [
		cx + sx * a * place.half + fx * b,
		y,
		cz + sz * a * place.half + fz * b,
	];
	const strips = Math.max(2, Math.round((STRIPS * (place.to - place.from)) / 2));
	const across = (i: number) => place.from + ((place.to - place.from) * i) / strips;
	const reach = place.depth * (1 + SLAB.overlap) * (1 + (next() * 2 - 1) * SLAB.length);
	const back = Array.from({ length: strips + 1 }, () => reach + (next() * 2 - 1) * SLAB.edge * 0.5);
	const front = Array.from({ length: strips + 1 }, () => -reach - (next() * 2 - 1) * SLAB.edge);
	const lift = () => place.top + (next() * 2 - 1) * SLAB.height;
	const frontLift = Array.from({ length: strips + 1 }, lift);
	const backLift = Array.from({ length: strips + 1 }, lift);
	const dark = (p: readonly [number, number, number]) => tone(RISER, p[0], p[2], 0.3);
	for (let strip = 0; strip < strips; strip++) {
		const [a0, a1] = [across(strip), across(strip + 1)];
		const corners = [
			corner(a0, front[strip] as number, frontLift[strip] as number),
			corner(a0, back[strip] as number, backLift[strip] as number),
			corner(a1, back[strip + 1] as number, backLift[strip + 1] as number),
			corner(a1, front[strip + 1] as number, frontLift[strip + 1] as number),
		];
		const shades = corners.map(([x, , z], c) => {
			const a = c < 2 ? a0 : a1;
			// Moss creeps in from the step's ends and lies in patches over its worn middle.
			const ends = (Math.abs(a) - 0.45) / 0.4 + 0.35 * noise.value2(x * 2, z * 2);
			const patches = (noise.value2(x * 1.3 + 5, z * 1.3) - 0.42) * 2.5;
			const moss = Math.min(1, Math.max(0, ends, patches));
			const base = tone(TREAD, x, z, 0.3);
			return [0, 1, 2].map(
				(i) => (base[i] as number) + ((MOSS[i] as number) - (base[i] as number)) * moss,
			) as [number, number, number];
		});
		face(built, corners, shades, [0, 1, 0]);
		// The riser under this strip's front edge, and the back under its back edge.
		const riser = [
			corner(a0, front[strip] as number, place.bottom),
			corner(a1, front[strip + 1] as number, place.bottom),
			corner(a1, front[strip + 1] as number, frontLift[strip + 1] as number),
			corner(a0, front[strip] as number, frontLift[strip] as number),
		];
		face(built, riser, riser.map(dark), [-fx, 0, -fz]);
		const rear = [
			corner(a1, back[strip + 1] as number, place.bottom),
			corner(a0, back[strip] as number, place.bottom),
			corner(a0, back[strip] as number, backLift[strip] as number),
			corner(a1, back[strip + 1] as number, backLift[strip + 1] as number),
		];
		face(built, rear, rear.map(dark), [fx, 0, fz]);
	}
	// The slab's two ends.
	for (const [i, sign] of [
		[0, -1],
		[strips, 1],
	] as const) {
		const a = across(i);
		const end = [
			corner(a, front[i] as number, place.bottom),
			corner(a, back[i] as number, place.bottom),
			corner(a, back[i] as number, backLift[i] as number),
			corner(a, front[i] as number, frontLift[i] as number),
		];
		face(built, end, end.map(dark), [sx * sign, 0, sz * sign]);
	}
}

/** One stone of a side wall: its place, its size and its turn about y. */
export interface WallStone {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly size: number;
	readonly turn: number;
}

/**
 * The side walls' stones, found from the land alone: two low courses each side, the upper course
 * smaller and set back over the joints of the lower, each stone seated on the lowest ground under it.
 */
export function wallPlaces(): WallStone[] {
	const next = random(75);
	const { ledge } = gardenPlaces();
	const places: WallStone[] = [];
	for (const flight of flights()) {
		const [dx, dz] = [flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]];
		const length = Math.hypot(dx, dz);
		const [fx, fz] = [dx / length, dz / length];
		for (const side of [-1, 1])
			for (let d = 0; d < length; d += WALL.spacing)
				for (let row = 0; row < WALL.rows; row++) {
					const size =
						(WALL.size[0] + (WALL.size[1] - WALL.size[0]) * next()) * (row === 1 ? 0.8 : 1);
					const out = STAIRS.half + WALL.out + size * 0.6 + (next() - 0.5) * 0.08 - row * 0.05;
					const along = d + (row === 1 ? WALL.spacing / 2 : 0);
					if (along > length) continue;
					const x = flight.from[0] + fx * along - fz * side * out;
					const z = flight.from[1] + fz * along + fx * side * out;
					if (nearLedge(ledge, x, z, WALL.ledge)) continue;
					// The lower course sits down in the ground; the upper rests on it.
					const y = lowestGround(x, z, size * WALL.reach) + (row === 1 ? size * 0.3 : -size * 0.15);
					// Each stone lies along the flight, its long side with the wall.
					const turn = Math.atan2(fx, fz) + Math.PI / 2 + (next() - 0.5) * 0.4;
					places.push({ x, y, z, size, turn });
				}
	}
	return places;
}

/**
 * Lays the flights of steps and the low walls of stacked rock along their sides. Returns a test of
 * whether a point lies on the steps or under their walls, where nothing grows.
 */
export function createSteps(
	{ scene, geometry, materials, textures }: SketchContext,
	detail: number,
	textureSize: number,
): (x: number, z: number) => boolean {
	const next = random(74);
	const built = { positions: [], normals: [], colors: [], uvs: [], indices: [] } as Parameters<
		typeof face
	>[0];
	for (const place of slabPlaces()) slab(built, next, place);
	const arrays: MeshArrays = {
		positions: new Float32Array(built.positions),
		normals: new Float32Array(built.normals),
		colors: new Float32Array(built.colors),
		uvs: new Float32Array(built.uvs),
		indices: new Uint32Array(built.indices),
	};
	scene.createMesh({
		mesh: geometry.fromArrays(arrays),
		// The rock's grain over the slabs' colours, so no slab reads as smooth, under a cool tint
		// that takes out the rock texture's warmth: the steps are pale grey cut stone.
		material: materials.standard({
			vertexColors: true,
			...rockMaps(textures, textureSize),
			color: '#eef2f8',
			roughness: 0.95,
		}),
		castShadows: true,
		receiveShadows: true,
	});
	// The walls: low courses of rounded stones laid along each side, beyond a band of moss, with moss
	// over their tops, so each side reads as a low mossy rock wall.
	const stone = geometry.fromArrays(
		mossy(rock(77, Math.max(1, detail - 2), [1, 0.7, 0.9], 0.12), 78, 0.75, WALL_TONES),
	);
	const places = wallPlaces();
	const walls = scene.createInstances(stone, places.length, {
		// The stones' own colors, with the rock's grain: grey rock under moss, darker than the treads.
		material: materials.standard({
			vertexColors: true,
			...rockMaps(textures, textureSize),
			roughness: 0.95,
		}),
		castShadows: true,
		receiveShadows: true,
	});
	places.forEach(({ x, y, z, size, turn }, row) => {
		walls.positions.set([x, y, z], row * 3);
		walls.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], row * 4);
		walls.scales.set([size, size, size], row * 3);
	});
	walls.markDirty();
	const reach = STAIRS.half + WALL.out + WALL.size[1];
	return (x, z) =>
		flights().some((flight) => {
			const { t, side } = alongFlight(flight, x, z);
			return t > -0.05 && t < 1.05 && side < reach;
		});
}
