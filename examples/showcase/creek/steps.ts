// The flights of stone steps from the creek's far bank through the gate to the terrace: worn grey
// slabs, uneven in length and edge, pale on the tread and dark on the riser, with moss creeping in at
// their ends, and a low wall of dark stacked rock along each side. Each step sits on the even ramp
// that the land lays under its flight, with its body sunk below the ramp, so none floats above the
// ground or sinks into it.
import type { MeshArrays, SketchContext } from '@null3d/engine';
import { Noise, random, rock } from '../../lib/procedural';
import { alongFlight, type Flight, flights, groundHeight, STAIRS } from './land';
import { mossy } from './stones';

/**
 * The slabs: how far each reaches past its tread's length, so the steps overlap a little; how far its
 * body sinks below the ramp; how much its width, its front edge and its height wander, in meters;
 * how far it turns off the flight's line, in radians; and how many strips its tread has across, so
 * the moss can creep in at the ends.
 */
const SLAB = {
	overlap: 0.08,
	sink: 0.35,
	width: 0.12,
	edge: 0.05,
	height: 0.025,
	turn: 0.04,
} as const;
const STRIPS = 6;

/** Linear colors of the steps: the worn tread, the shaded riser and the moss at the ends. */
const TREAD = [0.26, 0.225, 0.165] as const;
const RISER = [0.05, 0.04, 0.028] as const;
const MOSS = [0.12, 0.11, 0.028] as const;

/** The side walls: how far out from the steps' edge they stand, their stones' spacing and sizes. */
const WALL = { out: 0.45, spacing: 0.55, size: [0.22, 0.38], rows: 2 } as const;

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
	corners.forEach((corner, k) => {
		built.positions.push(...corner);
		built.normals.push(...normal);
		built.colors.push(...(shades[k] as readonly [number, number, number]));
		built.uvs.push(corner[0] * 0.5, corner[2] * 0.5);
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

/** The slabs of one flight, added to the arrays being built. */
function flightSlabs(built: Parameters<typeof face>[0], flight: Flight, next: () => number): void {
	const [dx, dz] = [flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]];
	const length = Math.hypot(dx, dz);
	const tread = length / flight.steps;
	const rise = (flight.high - flight.low) / flight.steps;
	for (let k = 0; k < flight.steps; k++) {
		const turn = Math.atan2(dz, dx) + (next() * 2 - 1) * SLAB.turn;
		const [fx, fz] = [Math.cos(turn), Math.sin(turn)];
		const [sx, sz] = [-fz, fx];
		const along = (k + 0.5) * tread;
		const [cx, cz] = [
			flight.from[0] + (dx / length) * along,
			flight.from[1] + (dz / length) * along,
		];
		const half = STAIRS.half + (next() * 2 - 1) * SLAB.width;
		const back = (tread / 2) * (1 + SLAB.overlap);
		const top = flight.low + (k + 1) * rise;
		const bottom = top - rise - SLAB.sink;
		// The tread: strips across, each corner a little off level, the ends mossy.
		const corner = (a: number, b: number, y: number): [number, number, number] => [
			cx + sx * a * half + fx * b,
			y,
			cz + sz * a * half + fz * b,
		];
		const front = -back - (next() * 2 - 1) * SLAB.edge;
		const lift = () => top + (next() * 2 - 1) * SLAB.height;
		const edgeLift = Array.from({ length: STRIPS + 1 }, lift);
		const backLift = Array.from({ length: STRIPS + 1 }, lift);
		for (let strip = 0; strip < STRIPS; strip++) {
			const [a0, a1] = [(strip / STRIPS) * 2 - 1, ((strip + 1) / STRIPS) * 2 - 1];
			const corners = [
				corner(a0, front, edgeLift[strip] as number),
				corner(a0, back, backLift[strip] as number),
				corner(a1, back, backLift[strip + 1] as number),
				corner(a1, front, edgeLift[strip + 1] as number),
			];
			const shades = corners.map(([x, , z], c) => {
				const a = c < 2 ? a0 : a1;
				const moss = Math.min(
					1,
					Math.max(0, (Math.abs(a) - 0.6) / 0.4 + 0.3 * noise.value2(x * 2, z * 2)),
				);
				const base = tone(TREAD, x, z, 0.25);
				return [0, 1, 2].map(
					(i) => (base[i] as number) + ((MOSS[i] as number) - (base[i] as number)) * moss,
				) as [number, number, number];
			});
			face(built, corners, shades, [0, 1, 0]);
		}
		// The riser, facing down the flight, and the two ends and the back, all in shade.
		const low = [
			corner(-1, front, bottom),
			corner(1, front, bottom),
			corner(1, back, bottom),
			corner(-1, back, bottom),
		];
		const high = [
			corner(-1, front, edgeLift[0] as number),
			corner(1, front, edgeLift[STRIPS] as number),
			corner(1, back, backLift[STRIPS] as number),
			corner(-1, back, backLift[0] as number),
		];
		const dark = (p: readonly [number, number, number]) => tone(RISER, p[0], p[2], 0.3);
		const sides: [number, number, number, number, [number, number, number]][] = [
			[0, 1, 1, 0, [-fx, 0, -fz]],
			[1, 2, 2, 1, [sx, 0, sz]],
			[2, 3, 3, 2, [fx, 0, fz]],
			[3, 0, 0, 3, [-sx, 0, -sz]],
		];
		for (const [a, b, , , normal] of sides) {
			const corners = [low[a], low[b], high[b], high[a]] as [number, number, number][];
			face(built, corners, corners.map(dark), normal);
		}
	}
}

/**
 * Lays the flights of steps and the low walls of stacked rock along their sides. Returns a test of
 * whether a point lies on the steps or under their walls, where nothing grows.
 */
export function createSteps(
	{ scene, geometry, materials }: SketchContext,
	detail: number,
): (x: number, z: number) => boolean {
	const next = random(73);
	const built = { positions: [], normals: [], colors: [], uvs: [], indices: [] } as Parameters<
		typeof face
	>[0];
	for (const flight of flights()) flightSlabs(built, flight, next);
	const arrays: MeshArrays = {
		positions: new Float32Array(built.positions),
		normals: new Float32Array(built.normals),
		colors: new Float32Array(built.colors),
		uvs: new Float32Array(built.uvs),
		indices: new Uint32Array(built.indices),
	};
	scene.createMesh({
		mesh: geometry.fromArrays(arrays),
		material: materials.standard({ vertexColors: true, roughness: 0.92 }),
		castShadows: true,
		receiveShadows: true,
	});
	// The walls: a row of dark mossy stones each side, two courses high, sunk into the moss band.
	const stone = geometry.fromArrays(mossy(rock(77, detail, [1, 0.6, 0.85], 0.12), 78, 0.3));
	const places: { x: number; y: number; z: number; size: number; turn: number }[] = [];
	for (const flight of flights()) {
		const [dx, dz] = [flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]];
		const length = Math.hypot(dx, dz);
		const [fx, fz] = [dx / length, dz / length];
		for (const side of [-1, 1])
			for (let d = 0; d < length; d += WALL.spacing)
				for (let row = 0; row < WALL.rows; row++) {
					const size = WALL.size[0] + (WALL.size[1] - WALL.size[0]) * next();
					const out = STAIRS.half + WALL.out + size * 0.5 + (next() - 0.5) * 0.1;
					const along = d + (row === 1 ? WALL.spacing / 2 : 0);
					if (along > length) continue;
					const x = flight.from[0] + fx * along - fz * side * out;
					const z = flight.from[1] + fz * along + fx * side * out;
					const y = groundHeight(x, z) + (row === 1 ? size * 0.55 : -size * 0.2);
					places.push({ x, y, z, size, turn: next() * Math.PI * 2 });
				}
	}
	const walls = scene.createInstances(stone, places.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.95 }),
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
