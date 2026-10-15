// The car of the clear coat and sheen demo (sketch.ts), built in code. The body and the cabin are
// surfaces of rounded box sections swept along the car, so the coat's reflections flow along them:
// a body with sides that curve in toward the top, flares over the wheel arches and rounded ends,
// and a cabin of gloss-black glass framed by thin dark pillars and roof rails. A dark band runs
// round the bottom.
// The lamps glow, and each wheel has a tyre with a rubber sheen and a five-spoke metal rim.
import {
	type Material,
	type MeshGeometry,
	math,
	type Object3D,
	type SketchContext,
} from '@null3d/engine';
import { lathe } from '@null3d/geometry';

type Vec3 = [number, number, number];

/** The car runs along x, its nose toward +x; its wheels' places and radius. */
const [TAIL, NOSE] = [-1.65, 1.72];
const AXLES = [-1.02, 1.08];
const WHEEL = 0.3;
const ARCH = 0.37;
/** Texels on each side of the paint's flake map. */
const FLAKES = 64;
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
		if (d < ARCH) bottom = Math.max(bottom, WHEEL + Math.sqrt(ARCH * ARCH - d * d));
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

/** A wheel at `position`, its outer face toward `outward` (1 for +z, -1 for -z). */
function wheel(
	ctx: SketchContext,
	parent: Object3D,
	position: Vec3,
	outward: number,
	tyre: MeshGeometry,
	rim: MeshGeometry,
	looks: Record<'rubber' | 'metal' | 'dark', Material>,
) {
	const { scene, geometry } = ctx;
	// The wheel's axle is its local y, turned to point across the car.
	const hub = scene.createGroup({
		parent,
		position,
		rotation: [outward * Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	scene.createMesh({
		mesh: tyre,
		material: looks.rubber,
		parent: hub,
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({ mesh: rim, material: looks.metal, parent: hub });
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 0.17,
			radiusBottom: 0.17,
			height: 0.02,
			radialSegments: 32,
		}),
		material: looks.dark,
		parent: hub,
		position: [0, -0.02, 0],
	});
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 0.045,
			radiusBottom: 0.05,
			height: 0.05,
			radialSegments: 24,
		}),
		material: looks.metal,
		parent: hub,
		position: [0, 0.08, 0],
	});
	const spoke = geometry.box({ width: 0.15, height: 0.025, depth: 0.04 });
	for (let k = 0; k < 5; k++) {
		const turn = (k / 5) * Math.PI * 2;
		scene.createMesh({
			mesh: spoke,
			material: looks.metal,
			parent: hub,
			position: [Math.cos(turn) * 0.115, 0.08, -Math.sin(turn) * 0.115],
			rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
		});
	}
}

/**
 * Candy red metallic paint. A normal map of small random tilts gives it metal flakes, which the
 * smooth coat covers.
 */
function flakePaint({ materials, textures }: SketchContext): Material {
	math.seed(7);
	const data = new Uint8Array(FLAKES * FLAKES * 4);
	for (let k = 0; k < FLAKES * FLAKES; k++) {
		const [x, y] = [math.randFloat(-0.35, 0.35), math.randFloat(-0.35, 0.35)];
		data.set([(x * 0.5 + 0.5) * 255, (y * 0.5 + 0.5) * 255, 255, 255], k * 4);
	}
	const flakes = textures.fromData({
		width: FLAKES,
		height: FLAKES,
		data,
		colorSpace: 'linear',
		wrap: 'repeat',
		mipmaps: true,
	});
	return materials.standard({
		color: '#9e0b16',
		metalness: 0.7,
		roughness: 0.38,
		normalMap: flakes,
		normalScale: [0.6, 0.6],
		uvTransform: { repeat: [24, 12] },
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
}

/** Builds the car under `parent`, its body and roof in candy red paint. */
export function createCar(ctx: SketchContext, parent: Object3D): void {
	const { scene, materials, geometry } = ctx;
	const paint = flakePaint(ctx);
	const trim = materials.standard({
		color: '#0b0c0e',
		roughness: 0.45,
		clearcoat: 0.6,
		clearcoatRoughness: 0.2,
	});
	const glass = materials.standard({
		color: '#020304',
		roughness: 0.05,
		clearcoat: 1,
		clearcoatRoughness: 0,
	});
	const shadows = { parent, castShadows: true, receiveShadows: true };
	// The body, with the lowest part of each section, the sills and bumpers, in the dark trim.
	const [painted, lower] = sweep(
		ctx,
		body,
		[TAIL, NOSE, -Math.PI / 2, (Math.PI * 3) / 2],
		260,
		72,
		(_, a) => ((section(a)[1] ?? 0) < -0.55 ? 1 : 0),
	);
	for (const [mesh, material] of [
		[painted, paint],
		[lower, trim],
	] as const)
		if (mesh) scene.createMesh({ mesh, material, ...shadows });
	// The cabin: glass, with each side framed in the trim.
	const frame = (x: number, angle: number) => {
		const a = Math.min(angle, Math.PI - angle);
		const [[af, at], [cf, ct]] = PILLARS;
		const [ta, tc] = [(x - af) / (at - af), (x - cf) / (ct - cf)];
		const pillar = (t: number) => t >= 0 && t <= 1 && Math.abs(a - t * RAIL) < FRAME;
		const rail = x > ct && x < at && Math.abs(a - RAIL) < FRAME;
		return pillar(ta) || pillar(tc) || rail ? 1 : 0;
	};
	const [windows, pillars] = sweep(ctx, cabin, [REAR, FRONT, 0, Math.PI], 280, 120, frame);
	for (const [mesh, material] of [
		[windows, glass],
		[pillars, trim],
	] as const)
		if (mesh) scene.createMesh({ mesh, material, ...shadows });
	// Headlamps at the nose's corners, a lamp bar at each corner of the tail.
	const lamp = (color: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity });
	const bulb = geometry.sphere({ radius: 1, widthSegments: 24, heightSegments: 12 });
	const lamps = [
		[1.6, 0.25, lamp('#eaf3ff', 6), [0.05, 0.035, 0.16]],
		[-1.585, 0.42, lamp('#ff0000', 2), [0.03, 0.028, 0.2]],
	] as const;
	for (const side of [1, -1])
		for (const [x, a, material, scale] of lamps) {
			const [px, py, pz] = body(x, side > 0 ? a : Math.PI - a);
			scene.createMesh({ mesh: bulb, material, parent, position: [px, py, pz], scale: [...scale] });
		}
	// Tyres: a rounded section turned about the axle. Rims: a barrel seen from inside the tyre.
	const tread = Array.from({ length: 17 }, (_, k): [number, number] => {
		const [across = 0, up = 0] = section(-Math.PI / 2 + (k / 16) * Math.PI);
		return [0.245 + 0.055 * across, 0.115 * up];
	});
	const tyre = ctx.geometry.fromArrays(
		lathe({ points: [[0.19, -0.115], ...tread, [0.19, 0.115]], segments: 64 }),
	);
	const rim = ctx.geometry.fromArrays(
		lathe({
			points: [
				[0.205, 0.1],
				[0.19, 0.09],
				[0.19, -0.1],
			],
			segments: 48,
		}),
	);
	const looks = {
		rubber: materials.standard({
			color: '#101113',
			roughness: 0.8,
			sheenColor: '#4a4f57',
			sheenRoughness: 0.5,
		}),
		metal: materials.standard({ color: '#cfd3da', metalness: 1, roughness: 0.22 }),
		dark: materials.standard({ color: '#2a2c30', metalness: 1, roughness: 0.5 }),
	};
	for (const x of AXLES)
		for (const side of [1, -1])
			wheel(ctx, parent, [x, WHEEL, side * 0.645], side, tyre, rim, looks);
}
