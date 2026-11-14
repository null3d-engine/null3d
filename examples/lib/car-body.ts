// A car made in code: a body and a cabin swept from rounded box sections, a dark band round the
// bottom, head and tail lamps, and four wheels with tyres and five-spoke rims. The body's sections
// curve in toward the top and flare over the wheel arches, so a clear coat's reflections flow along
// them. The caller gives every material, so one demo paints the car glossy red and another repaints
// it from a configurator. The car runs along x with its nose toward +x, its wheels' places at the
// constants below, and it stands with its tyres on y = 0.
import type { Material, Mesh, MeshGeometry, Object3D, SketchContext } from '@null3d/engine';
import { lathe } from '@null3d/geometry';

type Vec3 = [number, number, number];

/** The car's length along x, its wheel radius, and the x of each axle. */
export const CAR_LENGTH = [-1.65, 1.72] as const;
export const WHEEL_RADIUS = 0.3;
export const AXLES = [-1.02, 1.08] as const;
const [TAIL, NOSE] = CAR_LENGTH;
const ARCH = 0.37;
/** The cabin's ends, the share of its length where the roof peaks, and the roof's height. */
const [REAR, FRONT, PEAK, ROOF] = [-1.1, 0.8, 0.38, 1.16];

const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
/** How far a rounded end lets the section reach, at `d` from the end with radius `r`. */
const rounding = (d: number, r: number) =>
	Math.sqrt(1 - (1 - Math.min(1, Math.max(0, d / r))) ** 2);
/** A rounded box section (a superellipse): its across and up parts at angle `a`, each -1 to 1. */
const section = (a: number) => [
	Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.5,
	Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.5,
];
/**
 * The pillars and roof rails of the cabin's side, as a line from its foot to its top in (x, angle):
 * the A pillar leans back from the windscreen's foot, the C pillar forward from the rear window's.
 */
const PILLARS = [
	[0.76, -0.12],
	[-1.04, -0.52],
] as const;
/** The angle of the roof rails, and the half width of a pillar or rail, as angles of the section. */
const [RAIL, FRAME] = [1.2, 0.07];

/** The height of the body's shoulder line: a raised tail, a long deck and a hood that falls to the nose. */
const shoulder = (x: number) => 0.82 - 0.09 * smooth(0.4, NOSE, x) + 0.03 * smooth(-0.9, TAIL, x);
/** How high the cabin rises at x, from 0 at its ends to 1 under the roof. */
function rise(x: number): number {
	const s = Math.min(1, Math.max(0, (x - REAR) / (FRONT - REAR)));
	return s < PEAK
		? Math.sin((s / PEAK) * Math.PI * 0.5) ** 0.5
		: Math.cos(((s - PEAK) / (1 - PEAK)) * Math.PI * 0.5) ** 0.7;
}

/** The body's surface at x along the car and angle a around it. */
function body(x: number, a: number): Vec3 {
	let bottom = 0.2 + 0.07 * smooth(1.2, NOSE, x) + 0.07 * smooth(-1.2, TAIL, x);
	let flare = 0;
	for (const axle of AXLES) {
		const d = Math.abs(x - axle);
		if (d < ARCH) bottom = Math.max(bottom, WHEEL_RADIUS + Math.sqrt(ARCH * ARCH - d * d));
		flare += 0.035 * Math.exp(-(((x - axle) / 0.42) ** 2));
	}
	const top = shoulder(x);
	const end = rounding(x - TAIL, 0.32) * rounding(NOSE - x, 0.5);
	const [across = 0, up = 0] = section(a);
	const width = (0.78 + flare * (1 - Math.max(0, up))) * (1 - 0.14 * Math.max(0, up));
	return [x, (top + bottom) / 2 + ((top - bottom) / 2) * up * end, width * across * end];
}

/** The cabin's surface at x along the car and angle a over it, from one side at 0 to the other at pi. */
function cabin(x: number, a: number): Vec3 {
	const r = rise(x);
	const base = shoulder(x) - 0.07;
	const [across = 0, up = 0] = section(a);
	return [x, base + (ROOF - base) * r * up, 0.55 * (0.8 + 0.2 * r) * (1 - 0.3 * up) * across];
}

/**
 * A surface swept along x from `x0` to `x1` in `rows` steps, at `columns` angles from `a0` to `a1`,
 * with normals from its slopes. `part` puts each quad in one of the meshes it returns.
 */
function sweep(
	ctx: SketchContext,
	at: (x: number, a: number) => Vec3,
	[x0, x1, a0, a1]: number[],
	rows: number,
	columns: number,
	part: (x: number, a: number) => number,
): MeshGeometry[] {
	const [positions, normals, uvs] = [[], [], []] as number[][];
	const point = (u: number, v: number) => at(x0 + (x1 - x0) * u, a0 + (a1 - a0) * v);
	for (let i = 0; i <= rows; i++)
		for (let j = 0; j <= columns; j++) {
			const [u, v, e] = [i / rows, j / columns, 1e-3];
			const uc = Math.min(1 - e, Math.max(e, u));
			const [p, pu, mu, pv, mv] = [
				point(u, v),
				point(uc + e, v),
				point(uc - e, v),
				point(uc, v + e),
				point(uc, v - e),
			];
			const du = pu.map((c, k) => c - (mu[k] ?? 0));
			const dv = pv.map((c, k) => c - (mv[k] ?? 0));
			const [ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0] = [...du, ...dv];
			const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
			const length = Math.hypot(...n) || 1;
			positions.push(...p);
			normals.push(...n.map((c) => c / length));
			uvs.push(u, v);
		}
	const parts: number[][] = [];
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < columns; j++) {
			const [a, b, c, d] = [
				i * (columns + 1) + j,
				(i + 1) * (columns + 1) + j,
				(i + 1) * (columns + 1) + j + 1,
				i * (columns + 1) + j + 1,
			];
			const k = part(x0 + ((x1 - x0) * (i + 0.5)) / rows, a0 + ((a1 - a0) * (j + 0.5)) / columns);
			const list = parts[k] ?? [];
			parts[k] = list;
			list.push(a, b, d, b, c, d);
		}
	return parts.map((indices) =>
		ctx.geometry.fromArrays({
			positions: new Float32Array(positions),
			normals: new Float32Array(normals),
			uvs: new Float32Array(uvs),
			indices: new Uint32Array(indices),
		}),
	);
}

/** The materials that draw the car. A configurator swaps one for another to change its look. */
export interface CarLooks {
	/** The body's paint. */
	paint: Material;
	/** The sills, bumpers, pillars and roof rails. */
	trim: Material;
	/** The cabin's glass. */
	glass: Material;
	/** The head lamps' glow. */
	headlamp: Material;
	/** The tail lamps' glow. */
	taillamp: Material;
	/** The tyres. */
	rubber: Material;
	/** The rims, which a configurator recolours. */
	rim: Material;
	/** The wheel hubs behind the rims. */
	dark: Material;
}

/** One wheel: the group that spins about the axle, and the side that its axle points to. */
export interface CarWheel {
	/** The group to turn about its local y to roll the wheel. */
	readonly spin: Object3D;
	/** 1 for the right side of the car and -1 for the left, whose axle points the other way. */
	readonly outward: 1 | -1;
}

/** The car's meshes whose material a configurator may change. */
export interface CarBody {
	/** The painted body. */
	painted: Mesh;
	/** The sills and bumpers in the trim. */
	lower: Mesh;
	/** The cabin's glass. */
	glass: Mesh;
	/** The cabin's pillars and roof rails in the trim. */
	pillars: Mesh;
	/** The four wheels, in the order of the axles and then the right side before the left. */
	wheels: CarWheel[];
}

/**
 * Builds the car under `parent`, drawn with `looks`. The body and the cabin are split into meshes by
 * their part: paint, trim and glass, so a configurator can change one part and leave the rest. Give
 * `layers` to put every mesh on a layer of its own, as a reflection probe that must leave the car
 * out asks.
 */
export function createCarBody(
	ctx: SketchContext,
	parent: Object3D,
	looks: CarLooks,
	layers?: number,
): CarBody {
	const { scene, geometry } = ctx;
	const only = layers === undefined ? {} : { layers };
	const shadows = { parent, castShadows: true, receiveShadows: true, ...only };
	// The body, with the lowest part of each section, the sills and bumpers, in the dark trim.
	const [paintedMesh, lowerMesh] = sweep(
		ctx,
		body,
		[TAIL, NOSE, -Math.PI / 2, (Math.PI * 3) / 2],
		260,
		72,
		(_, a) => ((section(a)[1] ?? 0) < -0.55 ? 1 : 0),
	);
	if (!paintedMesh || !lowerMesh) throw new Error('the car body has no sweep');
	const painted = scene.createMesh({ mesh: paintedMesh, material: looks.paint, ...shadows });
	const lower = scene.createMesh({ mesh: lowerMesh, material: looks.trim, ...shadows });

	// The cabin: glass, with each side framed in the trim.
	const frame = (x: number, angle: number) => {
		const a = Math.min(angle, Math.PI - angle);
		const [[af, at], [cf, ct]] = PILLARS;
		const [ta, tc] = [(x - af) / (at - af), (x - cf) / (ct - cf)];
		const pillar = (t: number) => t >= 0 && t <= 1 && Math.abs(a - t * RAIL) < FRAME;
		const rail = x > ct && x < at && Math.abs(a - RAIL) < FRAME;
		return pillar(ta) || pillar(tc) || rail ? 1 : 0;
	};
	const [windowsMesh, pillarsMesh] = sweep(ctx, cabin, [REAR, FRONT, 0, Math.PI], 280, 120, frame);
	if (!windowsMesh || !pillarsMesh) throw new Error('the car cabin has no sweep');
	const glass = scene.createMesh({ mesh: windowsMesh, material: looks.glass, ...shadows });
	const pillars = scene.createMesh({ mesh: pillarsMesh, material: looks.trim, ...shadows });

	// Headlamps at the nose's corners, a lamp bar at each corner of the tail.
	const bulb = geometry.sphere({ radius: 1, widthSegments: 24, heightSegments: 12 });
	const lamps = [
		[1.6, 0.25, looks.headlamp, [0.05, 0.035, 0.16]],
		[-1.585, 0.42, looks.taillamp, [0.03, 0.028, 0.2]],
	] as const;
	for (const side of [1, -1])
		for (const [x, a, material, scale] of lamps) {
			const [px, py, pz] = body(x, side > 0 ? a : Math.PI - a);
			scene.createMesh({
				mesh: bulb,
				material,
				parent,
				position: [px, py, pz],
				scale: [...scale],
				...only,
			});
		}

	// Tyres: a rounded section turned about the axle. Rims: a barrel seen from inside the tyre.
	const tread = Array.from({ length: 17 }, (_, k): [number, number] => {
		const [across = 0, up = 0] = section(-Math.PI / 2 + (k / 16) * Math.PI);
		return [0.245 + 0.055 * across, 0.115 * up];
	});
	const tyre = geometry.fromArrays(
		lathe({ points: [[0.19, -0.115], ...tread, [0.19, 0.115]], segments: 64 }),
	);
	const rim = geometry.fromArrays(
		lathe({
			points: [
				[0.205, 0.1],
				[0.19, 0.09],
				[0.19, -0.1],
			],
			segments: 48,
		}),
	);
	const wheels: CarWheel[] = [];
	for (const x of AXLES)
		for (const side of [1, -1] as const)
			wheels.push(
				wheel(ctx, parent, [x, WHEEL_RADIUS, side * 0.645], side, tyre, rim, looks, layers),
			);

	return { painted, lower, glass, pillars, wheels };
}

/** Builds a wheel at `position`, its outer face toward `outward` (1 for +z, -1 for -z). */
function wheel(
	ctx: SketchContext,
	parent: Object3D,
	position: Vec3,
	outward: 1 | -1,
	tyre: MeshGeometry,
	rim: MeshGeometry,
	looks: CarLooks,
	layers?: number,
): CarWheel {
	const { scene, geometry } = ctx;
	const only = layers === undefined ? {} : { layers };
	// The wheel's axle is its local y, turned to point across the car.
	const hub = scene.createGroup({
		parent,
		position,
		rotation: [outward * Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	// A group inside the hub turns about the axle, so the tyre and the rim roll together.
	const spin = scene.createGroup({ parent: hub });
	scene.createMesh({
		mesh: tyre,
		material: looks.rubber,
		parent: spin,
		castShadows: true,
		receiveShadows: true,
		...only,
	});
	scene.createMesh({ mesh: rim, material: looks.rim, parent: spin, ...only });
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 0.17,
			radiusBottom: 0.17,
			height: 0.02,
			radialSegments: 32,
		}),
		material: looks.dark,
		parent: spin,
		position: [0, -0.02, 0],
		...only,
	});
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 0.045,
			radiusBottom: 0.05,
			height: 0.05,
			radialSegments: 24,
		}),
		material: looks.rim,
		parent: spin,
		position: [0, 0.08, 0],
		...only,
	});
	const spoke = geometry.box({ width: 0.15, height: 0.025, depth: 0.04 });
	for (let k = 0; k < 5; k++) {
		const turn = (k / 5) * Math.PI * 2;
		scene.createMesh({
			mesh: spoke,
			material: looks.rim,
			parent: spin,
			position: [Math.cos(turn) * 0.115, 0.08, -Math.sin(turn) * 0.115],
			rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
			...only,
		});
	}
	return { spin, outward };
}
