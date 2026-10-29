// The hero car's body, with a cockpit: the shell of the lane vehicles' hull, lofted through the same
// four sections, with a well cut into its roof where the driver sits. A tinted glass canopy closes
// the well. Inside sit a floor, a seat, a yoke and a dashboard, which carries the car's screens.
//
// Everything is in the body's own units, the lane hull's: the nose points along +Z, the belly sits
// just above y = 0, and the roof rises to 0.84. The hero car scales the body to its size.
import type { MeshGeometry, SketchContext } from '@null3d/engine';

/** The cockpit well: its half width, its back and its front, and the height of its floor. */
export const WELL = { half: 0.42, back: -0.95, front: 0.95, floor: 0.36 };
/** The canopy's ridge over the well: its height, and the half width of its top. */
const RIDGE = { height: 1.12, half: 0.32 };

/** The hull's sections, from the tail to the nose, as the lane hull lofts them. */
const SECTIONS = [
	{ z: -2.0, half: 0.74, top: 0.54 },
	{ z: -1.2, half: 0.96, top: 0.84 },
	{ z: 1.2, half: 0.9, top: 0.74 },
	{ z: 2.0, half: 0.52, top: 0.38 },
] as const;
const BELLY = 0.12;

/** The roof's height at `z` along the middle section, where the well opens. */
const roofAt = (z: number): number => {
	const a = SECTIONS[1];
	const b = SECTIONS[2];
	return a.top + ((z - a.z) / (b.z - a.z)) * (b.top - a.top);
};
/** The hull's half width at `z` along the middle section. */
const halfAt = (z: number): number => {
	const a = SECTIONS[1];
	const b = SECTIONS[2];
	return a.half + ((z - a.z) / (b.z - a.z)) * (b.half - a.half);
};

/** A list of quads, each four corners wound from the side that faces out. */
class Quads {
	readonly positions: number[] = [];
	readonly indices: number[] = [];
	add(
		a: readonly number[],
		b: readonly number[],
		c: readonly number[],
		d: readonly number[],
	): void {
		const first = this.positions.length / 3;
		this.positions.push(...a, ...b, ...c, ...d);
		this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	}
	/**
	 * The mesh. Its texture coordinates carry each vertex's place in the body's own space: x and y in
	 * the first set, and z in the second. A surface then paints the body from its own axes, however
	 * the car turns.
	 */
	mesh(ctx: SketchContext): MeshGeometry {
		const count = this.positions.length / 3;
		const uvs = new Float32Array(count * 2);
		const uvs1 = new Float32Array(count * 2);
		for (let k = 0; k < count; k++) {
			uvs[k * 2] = this.positions[k * 3] as number;
			uvs[k * 2 + 1] = this.positions[k * 3 + 1] as number;
			uvs1[k * 2] = this.positions[k * 3 + 2] as number;
		}
		return ctx.geometry.fromArrays({
			positions: new Float32Array(this.positions),
			uvs,
			uvs1,
			indices: new Uint32Array(this.indices),
			computeNormals: true,
		});
	}
}

/**
 * The shell: the lane hull's loft, with the well cut out of the roof of its middle section and the
 * well's walls and floor inside. Its faces are flat panels, as the full lane hull's are.
 */
export function createShell(ctx: SketchContext): MeshGeometry {
	const q = new Quads();
	const corners = (s: (typeof SECTIONS)[number]) => ({
		bl: [-s.half, BELLY, s.z],
		br: [s.half, BELLY, s.z],
		tr: [s.half, s.top, s.z],
		tl: [-s.half, s.top, s.z],
	});
	for (let k = 0; k < SECTIONS.length - 1; k++) {
		const a = corners(SECTIONS[k] as (typeof SECTIONS)[number]);
		const b = corners(SECTIONS[k + 1] as (typeof SECTIONS)[number]);
		q.add(a.bl, a.br, b.br, b.bl);
		q.add(a.bl, b.bl, b.tl, a.tl);
		q.add(a.br, a.tr, b.tr, b.br);
		if (k !== 1) q.add(a.tl, b.tl, b.tr, a.tr);
	}
	const tail = corners(SECTIONS[0]);
	const nose = corners(SECTIONS[3]);
	q.add(tail.bl, tail.tl, tail.tr, tail.br);
	q.add(nose.bl, nose.br, nose.tr, nose.tl);

	// The middle section's roof, around the well: a strip behind it, one in front, and one each side.
	const z0 = SECTIONS[1].z;
	const z1 = SECTIONS[2].z;
	const { half, back, front, floor } = WELL;
	const roof = (x: number, z: number) => [x, roofAt(z), z];
	q.add(
		roof(-halfAt(z0), z0),
		roof(-halfAt(back), back),
		roof(halfAt(back), back),
		roof(halfAt(z0), z0),
	);
	q.add(
		roof(-halfAt(front), front),
		roof(-halfAt(z1), z1),
		roof(halfAt(z1), z1),
		roof(halfAt(front), front),
	);
	q.add(
		roof(-halfAt(back), back),
		roof(-halfAt(front), front),
		roof(-half, front),
		roof(-half, back),
	);
	q.add(roof(half, back), roof(half, front), roof(halfAt(front), front), roof(halfAt(back), back));

	// The well's walls, facing in, and its floor.
	const low = (x: number, z: number) => [x, floor, z];
	q.add(roof(-half, back), roof(-half, front), low(-half, front), low(-half, back));
	q.add(roof(half, front), roof(half, back), low(half, back), low(half, front));
	q.add(roof(half, back), roof(-half, back), low(-half, back), low(half, back));
	q.add(roof(-half, front), roof(half, front), low(half, front), low(-half, front));
	q.add(low(-half, back), low(-half, front), low(half, front), low(half, back));
	return q.mesh(ctx);
}

/** The glass canopy over the well: a windshield, a roof, two sides and a back pane. */
export function createCanopy(ctx: SketchContext): MeshGeometry {
	const q = new Quads();
	const { half, back, front } = WELL;
	const base = (x: number, z: number) => [x, roofAt(z), z];
	// The ridge runs from just behind the windshield's top to just ahead of the back pane's.
	const ridgeFront = front - 0.75;
	const ridgeBack = back + 0.15;
	const top = (x: number, z: number) => [x, RIDGE.height, z];
	q.add(
		base(-half, front),
		base(half, front),
		top(RIDGE.half, ridgeFront),
		top(-RIDGE.half, ridgeFront),
	);
	q.add(
		top(-RIDGE.half, ridgeFront),
		top(RIDGE.half, ridgeFront),
		top(RIDGE.half, ridgeBack),
		top(-RIDGE.half, ridgeBack),
	);
	q.add(
		base(-half, back),
		base(-half, front),
		top(-RIDGE.half, ridgeFront),
		top(-RIDGE.half, ridgeBack),
	);
	q.add(
		base(half, front),
		base(half, back),
		top(RIDGE.half, ridgeBack),
		top(RIDGE.half, ridgeFront),
	);
	q.add(
		base(half, back),
		base(-half, back),
		top(-RIDGE.half, ridgeBack),
		top(RIDGE.half, ridgeBack),
	);
	return q.mesh(ctx);
}

/** One block of the cockpit's inside: its middle and its size, in the body's units. */
export interface Fitting {
	at: readonly [number, number, number];
	size: readonly [number, number, number];
}

/** The cockpit's fittings: the seat's cushion and back, the yoke's column and bar, and the dash. */
export const FITTINGS: readonly Fitting[] = [
	{ at: [0, WELL.floor + 0.08, -0.32], size: [0.5, 0.12, 0.46] },
	{ at: [0, WELL.floor + 0.34, -0.58], size: [0.5, 0.5, 0.09] },
	{ at: [0, 0.5, 0.44], size: [0.05, 0.05, 0.26] },
	{ at: [0, 0.55, 0.32], size: [0.32, 0.04, 0.04] },
	{ at: [0, 0.71, 0.74], size: [0.82, 0.1, 0.4] },
];

/**
 * The console: the touchscreen on the dashboard's face, below the three screens, in the body's
 * units. Its middle, its width and height, and how far it leans back toward the seat, in radians.
 */
export const CONSOLE = { at: [0, 0.62, 0.45] as const, size: [0.56, 0.21] as const, lean: 0.45 };
