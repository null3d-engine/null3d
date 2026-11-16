// The scene's building kit: the shapes of its houses, its gardens, its church and its small objects,
// as vertex arrays in real meters. Each house has walls with deep framed windows, louvred shutters,
// panelled doors in stone surrounds, a tiled roof on rafters, and the parts that give it its character:
// a balcony, an arcade, a porch, a pergola, a chimney or a roof terrace. A mesh holds one kind, and an
// instance batch stands every copy, so the town costs few draw calls. Each kind also has a plain far
// version. Walls and roofs take their surface from a map that a material carries, with texture
// coordinates in meters. Other parts keep the coordinates of the map's plain corner, so only their
// color shows. The walls' vertex colors stay white wherever an instance's own color should show.

/** A color, as linear values. */
export type Color = readonly [number, number, number];

/** Vertex arrays that grow as a shape is built. */
export interface Build {
	positions: number[];
	colors: number[];
	uvs: number[];
	indices: number[];
	/** True while the faces that are added should take the map's surface. */
	mapped: boolean;
	/** The house's plain far mesh, which takes a plain form of what casts a shadow that shows. */
	far?: Build;
}

/** An empty set of arrays. */
export const build = (): Build => ({
	positions: [],
	colors: [],
	uvs: [],
	indices: [],
	mapped: false,
});

/** The arrays as a mesh takes them. Flat faces share no vertices, so their normals stay crisp. */
export const finish = ({ positions, colors, uvs, indices }: Build) => ({
	positions,
	colors,
	uvs,
	indices,
	computeNormals: true,
});

/** Adds faces that take the map's surface, by a function that adds them. */
function mapped(b: Build, add: () => void): void {
	b.mapped = true;
	add();
	b.mapped = false;
}

const WHITE: Color = [1, 1, 1];
const SHUTTER_GREEN: Color = [0.1, 0.24, 0.16];
const SHUTTER_BLUE: Color = [0.1, 0.2, 0.34];
const SHUTTER_TEAL: Color = [0.07, 0.28, 0.27];
const GLASS: Color = [0.1, 0.13, 0.17];
const WOOD: Color = [0.22, 0.13, 0.07];
const DOOR_GREEN: Color = [0.08, 0.2, 0.14];
const STONE: Color = [0.62, 0.55, 0.44];
/** A plot's low wall of weathered dry stone, which keeps plots from reading as pale squares from above. */
const DRY_WALL: Color = [0.44, 0.39, 0.31];
const PALE: Color = [0.74, 0.67, 0.55];
const IRON: Color = [0.05, 0.05, 0.05];
const TILE: Color = [1, 1, 1];
const CORNICE: Color = [0.8, 0.74, 0.63];
const TERRACOTTA: Color = [0.45, 0.2, 0.11];
const LEAF: Color = [0.1, 0.22, 0.06];
const BLOOM: Color = [0.62, 0.05, 0.3];
const POOL: Color = [0.05, 0.32, 0.45];
const PAVING: Color = [0.46, 0.4, 0.31];
const RAFTER: Color = [0.2, 0.13, 0.08];

const span3 = (a: readonly number[], b: readonly number[]) =>
	Math.hypot(
		(b[0] as number) - (a[0] as number),
		(b[1] as number) - (a[1] as number),
		(b[2] as number) - (a[2] as number),
	);

/** Adds one flat four-sided face, whose corners run counter-clockwise from its outside. */
export function quad(
	b: Build,
	p0: readonly number[],
	p1: readonly number[],
	p2: readonly number[],
	p3: readonly number[],
	color: Color,
): void {
	const at = b.positions.length / 3;
	for (const p of [p0, p1, p2, p3]) {
		b.positions.push(p[0] as number, p[1] as number, p[2] as number);
		b.colors.push(color[0], color[1], color[2]);
	}
	if (b.mapped) {
		// The map runs along the face's first edge and up its side, a repeat per meter, and each face
		// starts it from its own place, so that neighbours do not repeat one another.
		const [across, up] = [span3(p0, p1), span3(p0, p3)];
		const u = (p0[0] as number) + (p0[2] as number);
		const v = p0[1] as number;
		b.uvs.push(u, v, u + across, v, u + across, v + up, u, v + up);
	} else b.uvs.push(0, 0, 0, 0, 0, 0, 0, 0);
	b.indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
}

/** Adds one flat triangle. */
export function triangle(
	b: Build,
	p0: readonly number[],
	p1: readonly number[],
	p2: readonly number[],
	color: Color,
): void {
	const at = b.positions.length / 3;
	for (const p of [p0, p1, p2]) {
		b.positions.push(p[0] as number, p[1] as number, p[2] as number);
		b.colors.push(color[0], color[1], color[2]);
	}
	if (b.mapped) {
		const across = span3(p0, p1);
		const mid = [
			((p0[0] as number) + (p1[0] as number)) / 2,
			((p0[1] as number) + (p1[1] as number)) / 2,
			((p0[2] as number) + (p1[2] as number)) / 2,
		];
		b.uvs.push(0, 0, across, 0, across / 2, span3(mid, p2));
	} else b.uvs.push(0, 0, 0, 0, 0, 0);
	b.indices.push(at, at + 1, at + 2);
}

/** Adds a box between two corners, with its bottom left open when `base` is false. */
export function box(
	b: Build,
	x0: number,
	y0: number,
	z0: number,
	x1: number,
	y1: number,
	z1: number,
	color: Color,
	base = false,
): void {
	quad(b, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
	quad(b, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color);
	quad(b, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color);
	quad(b, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
	quad(b, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color);
	if (base) quad(b, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
}

/** A place on a wall that faces a direction: across the wall, up it, and out from it. */
type Wall = (across: number, up: number, out: number) => number[];

/** The frame of a wall, from a point on it and its outward direction. */
const wallAt =
	(cx: number, cy: number, cz: number, dx: number, dz: number): Wall =>
	(across, up, out) => [cx + dz * across + dx * out, cy + up, cz - dx * across + dz * out];

/** Adds a box on a wall, in the wall's own frame. */
function wallBox(
	b: Build,
	w: Wall,
	a0: number,
	a1: number,
	u0: number,
	u1: number,
	o0: number,
	o1: number,
	color: Color,
): void {
	quad(b, w(a0, u0, o1), w(a1, u0, o1), w(a1, u1, o1), w(a0, u1, o1), color);
	quad(b, w(a1, u0, o1), w(a1, u0, o0), w(a1, u1, o0), w(a1, u1, o1), color);
	quad(b, w(a0, u0, o0), w(a0, u0, o1), w(a0, u1, o1), w(a0, u1, o0), color);
	quad(b, w(a0, u1, o1), w(a1, u1, o1), w(a1, u1, o0), w(a0, u1, o0), color);
	quad(b, w(a0, u0, o0), w(a1, u0, o0), w(a1, u0, o1), w(a0, u0, o1), color);
}

/**
 * Adds a window on the wall that faces a direction: glass behind a deep frame, a stone sill and
 * lintel, glazing bars, and louvred shutters folded back on each side.
 */
function window(
	b: Build,
	cx: number,
	cy: number,
	cz: number,
	dx: number,
	dz: number,
	shutter: Color,
	width = 1,
	height = 1.5,
): void {
	const w = wallAt(cx, cy, cz, dx, dz);
	const [hw, hh] = [width / 2, height / 2];
	quad(b, w(-hw, -hh, 0.02), w(hw, -hh, 0.02), w(hw, hh, 0.02), w(-hw, hh, 0.02), GLASS);
	// The deep surround stands proud of the wall, so the glass lies well behind its face.
	const depth = 0.24;
	wallBox(b, w, -hw - 0.12, -hw, -hh, hh, 0, depth, CORNICE);
	wallBox(b, w, hw, hw + 0.12, -hh, hh, 0, depth, CORNICE);
	wallBox(b, w, -hw - 0.18, hw + 0.18, hh, hh + 0.14, 0, depth + 0.04, PALE);
	wallBox(b, w, -hw - 0.2, hw + 0.2, -hh - 0.14, -hh, 0, depth + 0.1, PALE);
	wallBox(b, w, -0.025, 0.025, -hh, hh, 0, 0.08, RAFTER);
	wallBox(b, w, -hw, hw, 0.1, 0.15, 0, 0.08, RAFTER);
	// Each shutter folds back flat, with a frame and louvres that catch the light in rows.
	for (const side of [-1, 1]) {
		const [s0, s1] = [side * (hw + 0.14), side * (hw + 0.14 + width * 0.52)];
		const [a0, a1] = side > 0 ? [s0, s1] : [s1, s0];
		wallBox(b, w, a0, a1, -hh, hh, 0, 0.05, shutter);
		const slats = Math.floor(height / 0.13);
		for (let k = 0; k < slats; k++) {
			const y = -hh + 0.05 + (k * (height - 0.1)) / slats;
			quad(
				b,
				w(a0 + 0.04, y, 0.09),
				w(a1 - 0.04, y, 0.09),
				w(a1 - 0.04, y + 0.075, 0.055),
				w(a0 + 0.04, y + 0.075, 0.055),
				[shutter[0] * 1.5, shutter[1] * 1.5, shutter[2] * 1.5],
			);
		}
	}
}

/** Adds a door on the wall that faces a direction: panels, a stone surround, a lintel and a step. */
function door(
	b: Build,
	cx: number,
	cz: number,
	dx: number,
	dz: number,
	color: Color,
	arched = false,
): void {
	const w = wallAt(cx, 0, cz, dx, dz);
	const [hw, top] = [0.6, 2.25];
	// The door stands proud of a window's pane, which a shop's front may run behind it.
	quad(b, w(-hw, 0, 0.03), w(hw, 0, 0.03), w(hw, top, 0.03), w(-hw, top, 0.03), color);
	const panel: Color = [color[0] * 0.65, color[1] * 0.65, color[2] * 0.65];
	for (const [u0, u1] of [
		[0.25, 1],
		[1.2, 2.05],
	] as const)
		for (const side of [-1, 1]) {
			const [a0, a1] = side < 0 ? [-hw + 0.12, -0.08] : [0.08, hw - 0.12];
			quad(b, w(a0, u0, 0.045), w(a1, u0, 0.045), w(a1, u1, 0.045), w(a0, u1, 0.045), panel);
		}
	const depth = 0.3;
	wallBox(b, w, -hw - 0.22, -hw, 0, top, 0, depth, STONE);
	wallBox(b, w, hw, hw + 0.22, 0, top, 0, depth, STONE);
	if (arched) {
		const steps = 7;
		for (let k = 0; k < steps; k++) {
			const [a0, a1] = [(k / steps) * Math.PI, ((k + 1) / steps) * Math.PI];
			const [r0, r1] = [hw, hw + 0.24];
			const y = top;
			const out = depth;
			quad(
				b,
				w(Math.cos(a1) * r0, y + Math.sin(a1) * r0, out),
				w(Math.cos(a0) * r0, y + Math.sin(a0) * r0, out),
				w(Math.cos(a0) * r1, y + Math.sin(a0) * r1, out),
				w(Math.cos(a1) * r1, y + Math.sin(a1) * r1, out),
				STONE,
			);
			triangle(
				b,
				w(0, y, 0.03),
				w(Math.cos(a1) * r0, y + Math.sin(a1) * r0, 0.03),
				w(Math.cos(a0) * r0, y + Math.sin(a0) * r0, 0.03),
				GLASS,
			);
		}
	} else wallBox(b, w, -hw - 0.26, hw + 0.26, top, top + 0.24, 0, depth + 0.04, STONE);
	wallBox(b, w, -hw - 0.35, hw + 0.35, -0.3, 0.13, 0, 0.75, STONE);
}

/** Adds walls, windows on every side and a rim under the eaves, around one block of a house. */
function walls(
	b: Build,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	floors: number,
	shutter: Color,
	skip = 0,
	spacing = 2.9,
): void {
	const top = floors * FLOOR;
	// The walls reach well under the ground, so a house on a slope never stands on air.
	// They stop inside the cornice, whose top alone closes a roof terrace, so no two faces meet there.
	mapped(b, () => box(b, x0, -SKIRT, z0, x1, top - 0.1, z1, WHITE));
	box(b, x0 - 0.06, -SKIRT, z0 - 0.06, x1 + 0.06, 0.34, z1 + 0.06, STONE);
	box(b, x0 - 0.14, top - 0.26, z0 - 0.14, x1 + 0.14, top, z1 + 0.14, CORNICE);
	for (let floor = 1; floor < floors; floor++)
		box(
			b,
			x0 - 0.04,
			floor * FLOOR - 0.06,
			z0 - 0.04,
			x1 + 0.04,
			floor * FLOOR + 0.05,
			z1 + 0.04,
			CORNICE,
		);
	const rows = (span: number) => Math.max(1, Math.floor(span / spacing));
	for (let floor = skip; floor < floors; floor++) {
		const y = floor * FLOOR + 1.7;
		const across = rows(x1 - x0);
		for (let k = 0; k < across; k++) {
			const x = x0 + ((k + 0.5) / across) * (x1 - x0);
			window(b, x, y, z1, 0, 1, shutter);
			window(b, x, y, z0, 0, -1, shutter);
		}
		const along = rows(z1 - z0);
		for (let k = 0; k < along; k++) {
			const z = z0 + ((k + 0.5) / along) * (z1 - z0);
			window(b, x1, y, z, 1, 0, shutter);
			window(b, x0, y, z, -1, 0, shutter);
		}
	}
}

/** Adds the rafter ends along an eave, from one corner to another. */
function rafters(
	b: Build,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	y: number,
	ox: number,
	oz: number,
): void {
	const length = Math.hypot(x1 - x0, z1 - z0);
	const count = Math.floor(length / 0.75);
	for (let k = 1; k < count; k++) {
		const t = k / count;
		const [x, z] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
		const [xa, xb] =
			oz === 0 ? [Math.min(x, x + ox * 0.6), Math.max(x, x + ox * 0.6)] : [x - 0.05, x + 0.05];
		const [za, zb] =
			ox === 0 ? [Math.min(z, z + oz * 0.6), Math.max(z, z + oz * 0.6)] : [z - 0.05, z + 0.05];
		box(b, xa, y - 0.14, za, xb, y - 0.03, zb, RAFTER, true);
	}
}

/** Adds a hip roof over a block, with deep eaves on rafters, and ridge and hip tiles. */
function hipRoof(
	b: Build,
	w: Build,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	y: number,
	pitch = 0.42,
): void {
	const e = 0.62;
	const [ax, bx, az, bz] = [x0 - e, x1 + e, z0 - e, z1 + e];
	const inset = Math.min(bx - ax, bz - az) / 2;
	const top = y + inset * pitch;
	const long = bx - ax >= bz - az;
	const [p0, p1] = (
		long
			? [
					[ax + inset, top, (az + bz) / 2],
					[bx - inset, top, (az + bz) / 2],
				]
			: [
					[(ax + bx) / 2, top, az + inset],
					[(ax + bx) / 2, top, bz - inset],
				]
	) as [number[], number[]];
	mapped(b, () => {
		if (long) {
			quad(b, [ax, y, bz], [bx, y, bz], p1, p0, TILE);
			quad(b, [bx, y, az], [ax, y, az], p0, p1, TILE);
			triangle(b, [bx, y, bz], [bx, y, az], p1, TILE);
			triangle(b, [ax, y, az], [ax, y, bz], p0, TILE);
		} else {
			quad(b, [bx, y, bz], [bx, y, az], p0, p1, TILE);
			quad(b, [ax, y, az], [ax, y, bz], p1, p0, TILE);
			triangle(b, [ax, y, bz], [bx, y, bz], p1, TILE);
			triangle(b, [bx, y, az], [ax, y, az], p0, TILE);
		}
	});
	const cap: Color = [0.78, 0.6, 0.52];
	const hip = (a: readonly number[], c: readonly number[]) => {
		const [nx, nz] = [0.07, 0.07];
		quad(
			b,
			[(a[0] as number) - nx, (a[1] as number) + 0.03, (a[2] as number) + nz],
			[(a[0] as number) + nx, (a[1] as number) + 0.03, (a[2] as number) - nz],
			[(c[0] as number) + nx, (c[1] as number) + 0.03, (c[2] as number) - nz],
			[(c[0] as number) - nx, (c[1] as number) + 0.03, (c[2] as number) + nz],
			cap,
		);
	};
	hip([ax, y, az], p0);
	hip([bx, y, bz], p1);
	hip(long ? [ax, y, bz] : [bx, y, az], p0);
	hip(long ? [bx, y, az] : [ax, y, bz], p1);
	box(
		b,
		Math.min(p0[0] as number, p1[0] as number) - 0.07,
		top - 0.03,
		Math.min(p0[2] as number, p1[2] as number) - 0.07,
		Math.max(p0[0] as number, p1[0] as number) + 0.07,
		top + 0.09,
		Math.max(p0[2] as number, p1[2] as number) + 0.07,
		cap,
	);
	// The soffit under the eaves, and the rafter ends along them.
	quad(w, [ax, y - 0.02, az], [bx, y - 0.02, az], [bx, y - 0.02, bz], [ax, y - 0.02, bz], CORNICE);
	rafters(w, x0, z1, x1, z1, y, 0, 1);
	rafters(w, x0, z0, x1, z0, y, 0, -1);
}

/** A balcony with an iron rail and flower boxes, on the wall that faces +z. */
function balcony(b: Build, x0: number, x1: number, y: number, z: number): void {
	box(b, x0, y - 0.14, z, x1, y, z + 1.05, STONE, true);
	for (const x of [x0 + 0.1, x1 - 0.25]) box(b, x, y - 0.42, z, x + 0.15, y - 0.14, z + 0.8, STONE);
	box(b, x0, y + 0.92, z + 1, x1, y + 0.97, z + 1.05, IRON);
	for (let x = x0; x <= x1 + 0.01; x += 0.14)
		box(b, x, y, z + 1.01, x + 0.022, y + 0.92, z + 1.03, IRON);
	for (const side of [x0, x1 - 0.03]) box(b, side, y + 0.92, z, side + 0.03, y + 0.97, z + 1, IRON);
	box(b, x0 + 0.3, y + 0.97, z + 0.92, x1 - 0.3, y + 1.12, z + 1.12, TERRACOTTA);
	for (let x = x0 + 0.35; x < x1 - 0.35; x += 0.32)
		box(b, x, y + 1.12, z + 0.94, x + 0.24, y + 1.3, z + 1.1, Math.floor(x * 7) % 2 ? BLOOM : LEAF);
}

/** A chimney with a pot-topped cap. */
function chimney(b: Build, x: number, z: number, y0: number, y1: number): void {
	box(b, x - 0.34, y0, z - 0.34, x + 0.34, y1, z + 0.34, CORNICE);
	box(b, x - 0.44, y1, z - 0.44, x + 0.44, y1 + 0.1, z + 0.44, STONE);
	box(b, x - 0.13, y1 + 0.1, z - 0.13, x + 0.13, y1 + 0.42, z + 0.13, TERRACOTTA);
	if (b.far) box(b.far, x - 0.34, y0, z - 0.34, x + 0.34, y1 + 0.1, z + 0.34, CORNICE);
}

/** A low wall around a garden or a roof, one meter high by default. */
function parapet(
	b: Build,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	y: number,
	color: Color,
	height = 0.9,
): void {
	const t = 0.18;
	box(b, x0, y, z1 - t, x1, y + height, z1, color);
	box(b, x0, y, z0, x1, y + height, z0 + t, color);
	box(b, x1 - t, y, z0, x1, y + height, z1, color);
	box(b, x0, y, z0, x0 + t, y + height, z1, color);
}

/** The height of one floor, and how far walls reach under the ground, in meters. */
const FLOOR = 3.05;
const SKIRT = 7;

/** A round pot of terracotta with a leafy plant in it, at a place on the ground. */
function pot(b: Build, x: number, y: number, z: number, big = 0.3, flowers = false): void {
	ring(b, x, z, big * 0.6, y, big, y + big * 1.4, 8, TERRACOTTA);
	ring(b, x, z, big * 0.95, y + big * 1.4, big * 1.02, y + big * 1.55, 8, TERRACOTTA);
	const [top, wide] = [y + big * 3.2, big * 1.3];
	for (let k = 0; k < 7; k++) {
		const a = (k / 7) * Math.PI * 2;
		const [cx, cz] = [Math.sin(a) * wide * 0.5, Math.cos(a) * wide * 0.5];
		const color = flowers && k % 2 ? BLOOM : k % 3 ? LEAF : [0.15, 0.3, 0.09];
		triangle(
			b,
			[x + cz * 0.4, y + big * 1.5, z - cx * 0.4],
			[x - cz * 0.4, y + big * 1.5, z + cx * 0.4],
			[x + cx * 1.5, top - k * big * 0.15, z + cz * 1.5],
			color as Color,
		);
		triangle(
			b,
			[x - cz * 0.4, y + big * 1.5, z + cx * 0.4],
			[x + cz * 0.4, y + big * 1.5, z - cx * 0.4],
			[x + cx * 1.5, top - k * big * 0.15, z + cz * 1.5],
			color as Color,
		);
	}
}

/** A row of arches on the wall that faces +z: stone piers, curved spandrels and dark openings. */
function arcade(b: Build, x0: number, x1: number, z: number, height: number, bays: number): void {
	const width = (x1 - x0) / bays;
	quad(
		b,
		[x0, 0.1, z + 0.01],
		[x1, 0.1, z + 0.01],
		[x1, height, z + 0.01],
		[x0, height, z + 0.01],
		[0.1, 0.08, 0.07],
	);
	for (let k = 0; k <= bays; k++) {
		const x = x0 + k * width;
		box(b, x - 0.24, 0, z, x + 0.24, height, z + 0.55, STONE);
		box(b, x - 0.32, height - 1.2, z, x + 0.32, height - 1.08, z + 0.62, PALE);
	}
	box(b, x0 - 0.24, height - 0.3, z, x1 + 0.24, height + 0.14, z + 0.6, STONE);
	// The arch's curve steps across each bay's top.
	for (let k = 0; k < bays; k++) {
		const [mid, r] = [x0 + (k + 0.5) * width, width / 2 - 0.24];
		const steps = 6;
		for (let s = 0; s < steps; s++) {
			const [a0, a1] = [(s / steps) * Math.PI, ((s + 1) / steps) * Math.PI];
			const base = height - 1.1;
			const [xa, xb] = [mid + Math.cos(a0) * r, mid + Math.cos(a1) * r];
			const [ya, yb] = [
				base + Math.sin(a0) * Math.min(r, 0.82),
				base + Math.sin(a1) * Math.min(r, 0.82),
			];
			quad(
				b,
				[xb, yb, z + 0.55],
				[xa, ya, z + 0.55],
				[xa, height - 0.3, z + 0.55],
				[xb, height - 0.3, z + 0.55],
				STONE,
			);
		}
	}
}

/** A pergola of timber posts and rafters over a terrace, with climbing leaves and flowers on it. */
function pergola(
	b: Build,
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	y: number,
	high = 2.5,
	vines = true,
): void {
	for (const x of [x0, x1 - 0.14])
		for (const z of [z0, z1 - 0.14]) box(b, x, y, z, x + 0.14, y + high, z + 0.14, WOOD);
	box(b, x0, y + high, z0, x0 + 0.14, y + high + 0.14, z1, WOOD);
	box(b, x1 - 0.14, y + high, z0, x1, y + high + 0.14, z1, WOOD);
	for (let x = x0; x <= x1; x += 0.7)
		box(b, x, y + high + 0.14, z0 - 0.2, x + 0.08, y + high + 0.22, z1 + 0.2, WOOD);
	if (!vines) return;
	for (let k = 0; k < 14; k++) {
		const t = (k * 0.618) % 1;
		const u = (k * 0.381) % 1;
		const [x, z] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * u];
		const size = 0.3 + (k % 3) * 0.12;
		box(
			b,
			x - size,
			y + high + 0.2,
			z - size,
			x + size,
			y + high + 0.42,
			z + size,
			k % 4 === 0 ? BLOOM : LEAF,
		);
	}
}

/** One kind of house: its walls and details, its roof, and the plot it takes on the ground. */
export interface HouseKind {
	/** The radius that the house takes on the ground, in meters. */
	readonly reach: number;
	/** True for a house that the town's rows use, and false for a house in the country. */
	readonly town: boolean;
	/** The half width of the walls along the road, and their half depth, in meters. */
	readonly half: readonly [number, number];
	/** True for walls of bare stone, and false for plastered walls that take an instance's color. */
	readonly stone: boolean;
	readonly walls: Build;
	readonly roof: Build;
	/** Plain blocks with dark windows, and plain roofs, for far views. */
	readonly farWalls: Build;
	readonly farRoof: Build;
}

/** A roof terrace's top room over a block: its near and far corners, in meters. */
type Room = readonly [number, number, number, number];

/** The height of a roof terrace's top room, in meters. */
const ROOM_HEIGHT = 2.3;

/** Adds a far house's plain hip roof over a block, from its eaves' height. */
function farHip(roof: Build, x0: number, z0: number, x1: number, z1: number, y: number): void {
	const e = 0.55;
	const top = y + Math.min(x1 - x0, z1 - z0) * 0.21;
	const long = x1 - x0 >= z1 - z0;
	const m = long ? (z0 + z1) / 2 : (x0 + x1) / 2;
	mapped(roof, () => {
		if (long) {
			const [a, c] = [x0 + (z1 - z0) / 2, x1 - (z1 - z0) / 2];
			quad(roof, [x0 - e, y, z1 + e], [x1 + e, y, z1 + e], [c, top, m], [a, top, m], TILE);
			quad(roof, [x1 + e, y, z0 - e], [x0 - e, y, z0 - e], [a, top, m], [c, top, m], TILE);
			triangle(roof, [x1 + e, y, z1 + e], [x1 + e, y, z0 - e], [c, top, m], TILE);
			triangle(roof, [x0 - e, y, z0 - e], [x0 - e, y, z1 + e], [a, top, m], TILE);
		} else {
			const [a, c] = [z0 + (x1 - x0) / 2, z1 - (x1 - x0) / 2];
			quad(roof, [x1 + e, y, z1 + e], [x1 + e, y, z0 - e], [m, top, a], [m, top, c], TILE);
			quad(roof, [x0 - e, y, z0 - e], [x0 - e, y, z1 + e], [m, top, c], [m, top, a], TILE);
			triangle(roof, [x0 - e, y, z1 + e], [x1 + e, y, z1 + e], [m, top, c], TILE);
			triangle(roof, [x1 + e, y, z0 - e], [x0 - e, y, z0 - e], [m, top, a], TILE);
		}
	});
}

/** Makes a kind from a function that adds its parts. */
function kind(
	town: boolean,
	stone: boolean,
	blocks: readonly (readonly [number, number, number, number, number, Room?])[],
	add: (w: Build, r: Build) => void,
): HouseKind {
	const w = build();
	const r = build();
	const far = build();
	const farRoof = build();
	w.far = far;
	r.far = far;
	let [hx, hz] = [0, 0];
	for (const [x0, z0, x1, z1, floors, room] of blocks) {
		const y = floors * FLOOR;
		mapped(far, () => box(far, x0, -SKIRT, z0, x1, y, z1, WHITE));
		// Dark windows and eaves keep the far house's look, in a few faces.
		for (let floor = 0; floor < floors; floor++)
			for (let x = x0 + 1.2; x < x1 - 0.6; x += 2.9) {
				const c = floor * FLOOR + 1;
				quad(
					far,
					[x, c, z1 + 0.02],
					[x + 1, c, z1 + 0.02],
					[x + 1, c + 1.5, z1 + 0.02],
					[x, c + 1.5, z1 + 0.02],
					[0.08, 0.09, 0.1],
				);
				quad(
					far,
					[x + 1, c, z0 - 0.02],
					[x, c, z0 - 0.02],
					[x, c + 1.5, z0 - 0.02],
					[x + 1, c + 1.5, z0 - 0.02],
					[0.08, 0.09, 0.1],
				);
			}
		if (room) {
			// A roof terrace stays flat, with its top room, so a far house casts what the near one does.
			const [rx0, rz0, rx1, rz1] = room;
			mapped(far, () => box(far, rx0, y, rz0, rx1, y + ROOM_HEIGHT, rz1, WHITE));
			farHip(farRoof, rx0, rz0, rx1, rz1, y + ROOM_HEIGHT);
		} else farHip(farRoof, x0, z0, x1, z1, y);
		hx = Math.max(hx, Math.abs(x0), Math.abs(x1));
		hz = Math.max(hz, Math.abs(z0), Math.abs(z1));
	}
	add(w, r);
	return {
		reach: Math.hypot(hx, hz),
		town,
		half: [hx, hz],
		stone,
		walls: w,
		roof: r,
		farWalls: far,
		farRoof,
	};
}

/**
 * The house kinds, mostly of one and two floors and wider than they are tall. The country's stand
 * apart: a stone farmhouse, a villa with a balcony, an L-shaped house with its stair, a white cube with
 * a roof terrace, a long villa with an arcade, a stone house with a veranda and a villa with two wings.
 * The town's stand close together: a house with a balcony, a shop front under flats, a house with a
 * loggia, a stone corner block, a low stone house and a house with a roof terrace.
 */
export const HOUSE_KINDS: readonly HouseKind[] = [
	kind(false, true, [[-5.5, -3.8, 5.5, 3.8, 1]], (w, r) => {
		walls(w, -5.5, -3.8, 5.5, 3.8, 1, SHUTTER_GREEN);
		door(w, 0, 3.8, 0, 1, WOOD);
		hipRoof(r, w, -5.5, -3.8, 5.5, 3.8, FLOOR);
		chimney(w, 2.6, -1, FLOOR, FLOOR + 2.1);
		pot(w, -1.5, 0, 4.3);
		pot(w, 1.5, 0, 4.3, 0.3, true);
	}),
	kind(false, false, [[-6, -4.2, 6, 4.2, 2]], (w, r) => {
		walls(w, -6, -4.2, 6, 4.2, 2, SHUTTER_TEAL);
		door(w, -2, 4.2, 0, 1, WOOD);
		balcony(w, -3.2, 3.2, FLOOR, 4.2);
		hipRoof(r, w, -6, -4.2, 6, 4.2, FLOOR * 2);
		chimney(w, -3, -1.5, FLOOR * 2, FLOOR * 2 + 2.3);
	}),
	kind(
		false,
		false,
		[
			[-5.5, -4, 1.5, 4, 2],
			[1.5, -4, 6.5, 0.8, 1],
		],
		(w, r) => {
			walls(w, -5.5, -4, 1.5, 4, 2, SHUTTER_GREEN);
			walls(w, 1.5, -4, 6.5, 0.8, 1, SHUTTER_GREEN);
			door(w, -2, 4, 0, 1, DOOR_GREEN, true);
			hipRoof(r, w, -5.5, -4, 1.5, 4, FLOOR * 2);
			hipRoof(r, w, 1.5, -4, 6.5, 0.8, FLOOR);
			// A stone stair climbs the side to the upper floor.
			for (let k = 0; k < 8; k++)
				box(w, 1.6 + k * 0.42, -0.3, 0.9, 2 + k * 0.42, FLOOR - k * 0.36, 1.9, STONE);
			pergola(w, 2, 6.2, 1, 3.9, 0);
			chimney(w, -3, -1, FLOOR * 2, FLOOR * 2 + 2);
		},
	),
	kind(false, false, [[-5, -3.8, 5, 3.8, 2, [-4.4, -3.2, -1.2, -0.2]]], (w, r) => {
		walls(w, -5, -3.8, 5, 3.8, 2, SHUTTER_BLUE);
		door(w, 1, 3.8, 0, 1, SHUTTER_BLUE);
		parapet(w, -5, -3.8, 5, 3.8, FLOOR * 2, WHITE);
		// A small top room and a pergola on the roof terrace.
		mapped(w, () => box(w, -4.4, FLOOR * 2, -3.2, -1.2, FLOOR * 2 + ROOM_HEIGHT, -0.2, WHITE));
		hipRoof(r, w, -4.4, -3.2, -1.2, -0.2, FLOOR * 2 + ROOM_HEIGHT, 0.3);
		pergola(w, 0.2, 4.4, -2.8, 3, FLOOR * 2, 2.2);
		pot(w, -3.8, FLOOR * 2, 2.9, 0.28, true);
	}),
	kind(false, false, [[-7.5, -4, 7.5, 3.6, 2]], (w, r) => {
		walls(w, -7.5, -4, 7.5, 3.6, 2, SHUTTER_TEAL, 1);
		arcade(w, -6.8, 3.2, 3.6, FLOOR - 0.15, 4);
		door(w, 5.2, 3.6, 0, 1, WOOD, true);
		hipRoof(r, w, -7.5, -4, 7.5, 3.6, FLOOR * 2);
		chimney(w, 4.5, -1.8, FLOOR * 2, FLOOR * 2 + 2.2);
		chimney(w, -4.5, -1.8, FLOOR * 2, FLOOR * 2 + 2.2);
		pot(w, -1.5, 0, 4.6, 0.36, true);
	}),
	kind(false, true, [[-5.6, -4, 5.6, 4, 2]], (w, r) => {
		walls(w, -5.6, -4, 5.6, 4, 2, SHUTTER_TEAL, 1);
		door(w, 0, 4, 0, 1, WOOD);
		window(w, -3.2, 1.6, 4, 0, 1, SHUTTER_TEAL);
		window(w, 3.2, 1.6, 4, 0, 1, SHUTTER_TEAL);
		// A veranda stands on posts along the front, with a roof of its own and vines over it.
		for (const x of [-5.4, -1.8, 1.8, 5.4])
			box(w, x - 0.11, 0, 6.3, x + 0.11, FLOOR - 0.2, 6.52, WOOD);
		box(w, -5.6, 0, 4, 5.6, 0.16, 6.6, PAVING);
		box(w, -5.6, FLOOR - 0.28, 6.3, 5.6, FLOOR - 0.14, 6.5, WOOD);
		mapped(r, () =>
			quad(
				r,
				[-5.8, FLOOR - 0.15, 6.8],
				[5.8, FLOOR - 0.15, 6.8],
				[5.8, FLOOR + 0.5, 4],
				[-5.8, FLOOR + 0.5, 4],
				TILE,
			),
		);
		for (const x of [-4.8, -1, 3.4])
			box(w, x, FLOOR - 0.3, 5.9, x + 0.9, FLOOR + 0.04, 7, x < 0 ? LEAF : BLOOM);
		hipRoof(r, w, -5.6, -4, 5.6, 4, FLOOR * 2);
		chimney(w, -2.5, -1.2, FLOOR * 2, FLOOR * 2 + 2.2);
	}),
	kind(
		false,
		false,
		[
			[-6.5, -4, 6.5, 1.5, 2],
			[-6.5, 1.5, -2.5, 5, 1],
			[2.5, 1.5, 6.5, 5, 1],
		],
		(w, r) => {
			walls(w, -6.5, -4, 6.5, 1.5, 2, SHUTTER_TEAL);
			walls(w, -6.5, 1.5, -2.5, 5, 1, SHUTTER_TEAL);
			walls(w, 2.5, 1.5, 6.5, 5, 1, SHUTTER_TEAL);
			door(w, 0, 1.5, 0, 1, WOOD, true);
			hipRoof(r, w, -6.5, -4, 6.5, 1.5, FLOOR * 2);
			hipRoof(r, w, -6.5, 1.5, -2.5, 5, FLOOR);
			hipRoof(r, w, 2.5, 1.5, 6.5, 5, FLOOR);
			balcony(w, -2.2, 2.2, FLOOR, 1.5);
			chimney(w, 0, -2, FLOOR * 2, FLOOR * 2 + 2.4);
			pot(w, -1.5, 0, 3.5, 0.4, true);
			pot(w, 1.5, 0, 3.5, 0.4);
		},
	),
	kind(true, false, [[-5, -4, 5, 4, 2]], (w, r) => {
		walls(w, -5, -4, 5, 4, 2, SHUTTER_TEAL, 1);
		door(w, -1.8, 4, 0, 1, WOOD);
		window(w, 2, 1.6, 4, 0, 1, SHUTTER_TEAL);
		balcony(w, -3, 3, FLOOR, 4);
		hipRoof(r, w, -5, -4, 5, 4, FLOOR * 2);
		chimney(w, 2, -2, FLOOR * 2, FLOOR * 2 + 2);
	}),
	kind(true, false, [[-4.5, -4, 4.5, 4, 2]], (w, r) => {
		walls(w, -4.5, -4, 4.5, 4, 2, SHUTTER_BLUE, 1);
		// A shop front: a wide window, a door and a striped awning over the street.
		quad(w, [-4, 0.5, 4.03], [0.8, 0.5, 4.03], [0.8, 2.5, 4.03], [-4, 2.5, 4.03], GLASS);
		box(w, -4.1, 0, 4, 0.9, 0.5, 4.14, STONE);
		door(w, 2.6, 4, 0, 1, WOOD);
		for (let k = 0; k < 10; k++) {
			const x = -4.4 + k * 0.88;
			const color: Color = k % 2 ? [0.72, 0.68, 0.6] : [0.42, 0.16, 0.1];
			quad(w, [x, 2.3, 5.5], [x + 0.88, 2.3, 5.5], [x + 0.88, 3, 4], [x, 3, 4], color);
			quad(w, [x + 0.88, 2.3, 5.5], [x, 2.3, 5.5], [x, 3, 4], [x + 0.88, 3, 4], color);
		}
		hipRoof(r, w, -4.5, -4, 4.5, 4, FLOOR * 2);
	}),
	kind(true, false, [[-5.5, -4.2, 5.5, 4.2, 2]], (w, r) => {
		walls(w, -5.5, -4.2, 5.5, 4.2, 2, SHUTTER_GREEN, 1);
		arcade(w, -4.8, 4.8, 4.2, FLOOR - 0.15, 4);
		hipRoof(r, w, -5.5, -4.2, 5.5, 4.2, FLOOR * 2);
		chimney(w, -3, -2, FLOOR * 2, FLOOR * 2 + 2);
	}),
	kind(true, true, [[-5, -4.4, 5, 4.4, 3]], (w, r) => {
		walls(w, -5, -4.4, 5, 4.4, 3, SHUTTER_TEAL, 1);
		door(w, 0, 4.4, 0, 1, WOOD, true);
		for (const x of [-3, 3]) window(w, x, 1.6, 4.4, 0, 1, SHUTTER_TEAL);
		balcony(w, -3.4, 3.4, FLOOR * 2, 4.4);
		hipRoof(r, w, -5, -4.4, 5, 4.4, FLOOR * 3);
		chimney(w, -2.5, -2, FLOOR * 3, FLOOR * 3 + 2);
	}),
	kind(true, true, [[-4.6, -3.6, 4.6, 3.6, 1]], (w, r) => {
		walls(w, -4.6, -3.6, 4.6, 3.6, 1, SHUTTER_GREEN);
		door(w, 0, 3.6, 0, 1, DOOR_GREEN);
		hipRoof(r, w, -4.6, -3.6, 4.6, 3.6, FLOOR, 0.46);
		pot(w, 1.8, 0, 4.1, 0.28, true);
	}),
	kind(true, false, [[-4.4, -4, 4.4, 4, 2, [-3.8, -3.4, -0.6, -0.6]]], (w, r) => {
		walls(w, -4.4, -4, 4.4, 4, 2, SHUTTER_GREEN, 1);
		door(w, -1.4, 4, 0, 1, WOOD);
		window(w, 1.8, 1.6, 4, 0, 1, SHUTTER_GREEN);
		parapet(w, -4.4, -4, 4.4, 4, FLOOR * 2, WHITE, 0.8);
		mapped(w, () => box(w, -3.8, FLOOR * 2, -3.4, -0.6, FLOOR * 2 + ROOM_HEIGHT, -0.6, WHITE));
		hipRoof(r, w, -3.8, -3.4, -0.6, -0.6, FLOOR * 2 + ROOM_HEIGHT, 0.3);
		pergola(w, 0.3, 3.8, 0, 3.4, FLOOR * 2, 2.2);
		pot(w, 3.6, FLOOR * 2, -3.3, 0.25, true);
	}),
];

/** The gardens around a country house, each in the house's own frame with the road at +z. */
export interface GardenKind {
	/** The garden's half width, how far it runs behind the middle, and how far in front of it, in meters. */
	readonly plot: readonly [number, number, number];
	readonly mesh: Build;
}

/** Adds a garden's rubble boundary with a capping course, and its gate on the road's side. */
function boundary(b: Build, w: number, back: number, front: number, gate = 2): void {
	const [t, h] = [0.32, 0.8];
	mapped(b, () => {
		box(b, -w, -2.5, -back, w, h, -back + t, DRY_WALL);
		box(b, -w, -2.5, -back, -w + t, h, front, DRY_WALL);
		box(b, w - t, -2.5, -back, w, h, front, DRY_WALL);
		box(b, -w, -2.5, front - t, -gate, h, front, DRY_WALL);
		box(b, gate, -2.5, front - t, w, h, front, DRY_WALL);
	});
	const cap: Color = [0.56, 0.5, 0.41];
	for (const [x0, z0, x1, z1] of [
		[-w - 0.05, -back - 0.05, w + 0.05, -back + t + 0.05],
		[-w - 0.05, -back - 0.05, -w + t + 0.05, front + 0.05],
		[w - t - 0.05, -back - 0.05, w + 0.05, front + 0.05],
		[-w - 0.05, front - t - 0.05, -gate, front + 0.05],
		[gate, front - t - 0.05, w + 0.05, front + 0.05],
	] as const)
		box(b, x0, h, z0, x1, h + 0.1, z1, cap);
	for (const x of [-gate - 0.55, gate]) {
		box(b, x, 0, front - 0.45, x + 0.55, 1.5, front + 0.1, cap);
		box(b, x - 0.05, 1.5, front - 0.5, x + 0.6, 1.62, front + 0.15, cap);
	}
}

/** Adds a swimming pool with its stone rim and two thin loungers. */
function pool(b: Build, x0: number, x1: number, z0: number, z1: number): void {
	box(b, x0 - 1.4, -0.1, z0 - 1.4, x1 + 1.4, 0.06, z1 + 1.4, PAVING);
	const rim: Color = [0.85, 0.83, 0.78];
	box(b, x0 - 0.3, 0, z0 - 0.3, x1 + 0.3, 0.14, z0, rim);
	box(b, x0 - 0.3, 0, z1, x1 + 0.3, 0.14, z1 + 0.3, rim);
	box(b, x0 - 0.3, 0, z0, x0, 0.14, z1, rim);
	box(b, x1, 0, z0, x1 + 0.3, 0.14, z1, rim);
	quad(b, [x0, 0.1, z1], [x1, 0.1, z1], [x1, 0.1, z0], [x0, 0.1, z0], POOL);
	for (const z of [z0 + 0.4, z0 + 1.6]) lounger(b, x1 + 0.5, z, 0.06);
}

/** A slatted lounger, 1.8 meters long, with its back raised, on its long side along x. */
function lounger(b: Build, x: number, z: number, y: number): void {
	const wood: Color = [0.62, 0.5, 0.34];
	for (const fx of [x + 0.05, x + 1.25]) box(b, fx, y, z, fx + 0.05, y + 0.22, z + 0.62, wood);
	box(b, x, y + 0.22, z, x + 1.3, y + 0.28, z + 0.62, [0.86, 0.82, 0.72]);
	quad(
		b,
		[x + 1.3, y + 0.28, z + 0.62],
		[x + 1.3, y + 0.28, z],
		[x + 1.8, y + 0.62, z],
		[x + 1.8, y + 0.62, z + 0.62],
		[0.86, 0.82, 0.72],
	);
}

/** Adds a table with its cloth and four chairs on a terrace. */
function table(b: Build, x: number, z: number, y = 0): void {
	box(b, x - 0.04, y, z - 0.04, x + 0.04, y + 0.72, z + 0.04, IRON);
	box(b, x - 0.55, y + 0.72, z - 0.55, x + 0.55, y + 0.75, z + 0.55, [0.92, 0.9, 0.84]);
	for (const [dx, dz, nx, nz] of [
		[-0.55, -0.55, 1.1, 0],
		[0.55, -0.55, 0, 1.1],
		[0.55, 0.55, -1.1, 0],
		[-0.55, 0.55, 0, -1.1],
	] as const) {
		const [ax, az] = [x + dx, z + dz];
		quad(
			b,
			[ax + nx, y + 0.5, az + nz],
			[ax, y + 0.5, az],
			[ax, y + 0.75, az],
			[ax + nx, y + 0.75, az + nz],
			[0.9, 0.88, 0.82],
		);
	}
	for (const [dx, dz] of [
		[-0.95, 0],
		[0.95, 0],
		[0, -0.95],
		[0, 0.95],
	] as const) {
		const [cx, cz] = [x + dx, z + dz];
		for (const [lx, lz] of [
			[-0.18, -0.18],
			[0.14, -0.18],
			[-0.18, 0.14],
			[0.14, 0.14],
		] as const)
			box(b, cx + lx, y, cz + lz, cx + lx + 0.04, y + 0.44, cz + lz + 0.04, WOOD);
		box(b, cx - 0.2, y + 0.44, cz - 0.2, cx + 0.2, y + 0.48, cz + 0.2, WOOD);
		const [ox, oz] = [Math.sign(dx) * 0.2, Math.sign(dz) * 0.2];
		const [wx, wz] = [dz ? 0.2 : 0.02, dx ? 0.2 : 0.02];
		box(b, cx + ox - wx, y + 0.48, cz + oz - wz, cx + ox + wx, y + 0.9, cz + oz + wz, WOOD);
	}
}

/** Adds the things of a house's yard: a washing line, a bin and a stack of firewood. */
function yard(b: Build, x: number, z: number): void {
	for (const dx of [0, 4]) box(b, x + dx - 0.04, 0, z - 0.04, x + dx + 0.04, 1.9, z + 0.04, IRON);
	box(b, x, 1.85, z - 0.012, x + 4, 1.87, z + 0.012, [0.8, 0.8, 0.8]);
	for (let k = 0; k < 4; k++) {
		const color: Color = k % 2 ? [0.85, 0.85, 0.82] : [0.3, 0.42, 0.62];
		quad(
			b,
			[x + 0.5 + k * 0.8, 1.05, z],
			[x + 1 + k * 0.8, 1.05, z],
			[x + 1 + k * 0.8, 1.85, z],
			[x + 0.5 + k * 0.8, 1.85, z],
			color,
		);
		quad(
			b,
			[x + 1 + k * 0.8, 1.05, z],
			[x + 0.5 + k * 0.8, 1.05, z],
			[x + 0.5 + k * 0.8, 1.85, z],
			[x + 1 + k * 0.8, 1.85, z],
			color,
		);
	}
	box(b, x - 1.4, 0, z - 1.5, x - 0.7, 1.1, z - 0.8, [0.2, 0.28, 0.22]);
	box(b, x + 1, 0, z - 2, x + 3.2, 0.9, z - 1.4, [0.32, 0.22, 0.13]);
}

/** The garden kinds: a pool garden, a kitchen yard, a terrace with a pergola, a plain plot and a villa's pool. */
export const GARDEN_KINDS: readonly GardenKind[] = (() => {
	const make = (plot: readonly [number, number, number], add: (b: Build) => void): GardenKind => {
		const mesh = build();
		add(mesh);
		return { plot, mesh };
	};
	return [
		make([10, 14, 7], (b) => {
			boundary(b, 10, 14, 7);
			pool(b, -5, 3, -12.5, -8.5);
			table(b, 6.5, -7);
			pot(b, -8.5, 0, 5.5, 0.4, true);
			pot(b, 8.5, 0, 5.5, 0.4);
		}),
		make([9, 11, 7], (b) => {
			boundary(b, 9, 11, 7);
			yard(b, -6, -7);
			for (let k = 0; k < 5; k++) box(b, 2, 0, -10 + k * 1.3, 7.8, 0.32, -9.5 + k * 1.3, LEAF);
			pot(b, -7.5, 0, 5.5);
		}),
		make([9, 12, 7], (b) => {
			boundary(b, 9, 12, 7);
			box(b, -7.5, -0.1, -10.5, 3.5, 0.06, -5.5, PAVING);
			pergola(b, -7, 3, -10, -6, 0.06);
			table(b, -2, -8, 0.06);
			pot(b, 7.5, 0, -10, 0.45, true);
			pot(b, -7.5, 0, 5.5, 0.4);
		}),
		make([8, 9, 6], (b) => {
			boundary(b, 8, 9, 6);
			yard(b, 0.8, -6.3);
			pot(b, 6.5, 0, 4.5, 0.4, true);
		}),
		make([6.5, 8, 5], (b) => {
			boundary(b, 6.5, 8, 5);
			pot(b, 5, 0, 3.8, 0.4, true);
		}),
		make([11, 16, 7], (b) => {
			boundary(b, 11, 16, 7);
			pool(b, -6, 4, -14.5, -10);
			box(b, -6, -0.1, -8.5, 7.5, 0.06, -5, PAVING);
			table(b, 5, -6.8, 0.06);
			pot(b, -9.5, 0, 5.5, 0.45, true);
			pot(b, 9.5, 0, 5.5, 0.45, true);
			pot(b, -2.5, 0, -6.5, 0.35);
		}),
	];
})();

/** Adds a ring of `sides` panels around an axis, from one radius and height to another. */
export function ring(
	b: Build,
	cx: number,
	cz: number,
	r0: number,
	y0: number,
	r1: number,
	y1: number,
	sides: number,
	color: Color,
): void {
	for (let k = 0; k < sides; k++) {
		const a0 = (k / sides) * Math.PI * 2;
		const a1 = ((k + 1) / sides) * Math.PI * 2;
		quad(
			b,
			[cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0],
			[cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0],
			[cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1],
			[cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1],
			color,
		);
	}
}

/** An arched opening on a wall: dark inside a stone surround that stands proud of the wall. */
function arch(
	b: Build,
	w: Wall,
	x: number,
	y: number,
	width: number,
	high: number,
	surround: Color,
	inner: Color,
): void {
	const r = width / 2;
	const spring = y + high - r;
	quad(
		b,
		w(x - r, y, 0.03),
		w(x + r, y, 0.03),
		w(x + r, spring, 0.03),
		w(x - r, spring, 0.03),
		inner,
	);
	wallBox(b, w, x - r - 0.2, x - r, y, spring, 0, 0.26, surround);
	wallBox(b, w, x + r, x + r + 0.2, y, spring, 0, 0.26, surround);
	const steps = 8;
	for (let k = 0; k < steps; k++) {
		const [a0, a1] = [(k / steps) * Math.PI, ((k + 1) / steps) * Math.PI];
		const [ca, sa, cb, sb] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
		triangle(
			b,
			w(x, spring, 0.03),
			w(x + ca * r, spring + sa * r, 0.03),
			w(x + cb * r, spring + sb * r, 0.03),
			inner,
		);
		const R = r + 0.2;
		quad(
			b,
			w(x + ca * r, spring + sa * r, 0.26),
			w(x + ca * R, spring + sa * R, 0.26),
			w(x + cb * R, spring + sb * R, 0.26),
			w(x + cb * r, spring + sb * r, 0.26),
			surround,
		);
		quad(
			b,
			w(x + cb * r, spring + sb * r, 0),
			w(x + ca * r, spring + sa * r, 0),
			w(x + ca * r, spring + sa * r, 0.26),
			w(x + cb * r, spring + sb * r, 0.26),
			surround,
		);
	}
}

/** A pitched roof with its ridge along z or x, in the map's tiles, with a raking stone cornice. */
function pitched(
	r: Build,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	y: number,
	top: number,
	alongZ: boolean,
): void {
	mapped(r, () => {
		if (alongZ) {
			const m = (x0 + x1) / 2;
			quad(
				r,
				[x1 + 0.5, y, z1 + 0.3],
				[x1 + 0.5, y, z0 - 0.3],
				[m, top, z0 - 0.3],
				[m, top, z1 + 0.3],
				TILE,
			);
			quad(
				r,
				[x0 - 0.5, y, z0 - 0.3],
				[x0 - 0.5, y, z1 + 0.3],
				[m, top, z1 + 0.3],
				[m, top, z0 - 0.3],
				TILE,
			);
		} else {
			const m = (z0 + z1) / 2;
			quad(
				r,
				[x0 - 0.3, y, z1 + 0.5],
				[x1 + 0.3, y, z1 + 0.5],
				[x1 + 0.3, top, m],
				[x0 - 0.3, top, m],
				TILE,
			);
			quad(
				r,
				[x1 + 0.3, y, z0 - 0.5],
				[x0 - 0.3, y, z0 - 0.5],
				[x0 - 0.3, top, m],
				[x1 + 0.3, top, m],
				TILE,
			);
		}
	});
}

/**
 * The church in pale limestone: a nave with lower side aisles and a transept, an apse, a carved front
 * with an arched portal and a rose window up a flight of steps, a drum with arched lights under a
 * ribbed dome of deep blue tile, and a tower with open belfry arches and a small dome. It returns its
 * stone, its tiled roofs and its dome, each for a material of its own.
 */
export function church(): { stone: Build; roof: Build } {
	const b = build();
	const r = build();
	const pale: Color = [0.92, 0.88, 0.8];
	const white: Color = [0.86, 0.84, 0.78];
	const dark: Color = [0.05, 0.045, 0.045];
	const [cobalt, deep]: [Color, Color] = [
		[0.035, 0.09, 0.3],
		[0.022, 0.06, 0.2],
	];
	const [tx0, tz0, tx1, tz1] = [7.5, 6, 13, 11.5];
	mapped(b, () => {
		box(b, -6, -SKIRT, -14, 6, 11, 12, white);
		box(b, -10, -SKIRT, -14, 10, 6.5, 12, white);
		box(b, -14, -SKIRT, -6, 14, 10, 3, white);
		box(b, tx0, -SKIRT, tz0, tx1, 22, tz1, white);
	});
	// The roofs: the nave's and the transept's ridges, and the aisles' lean-to slopes.
	pitched(r, -6, -14, 6, 12, 11, 14, true);
	pitched(r, -14, -6, 14, 3, 10, 13, false);
	mapped(r, () => {
		quad(r, [10.4, 6.5, 12.3], [10.4, 6.5, -14.3], [6, 9.2, -14.3], [6, 9.2, 12.3], TILE);
		quad(r, [-10.4, 6.5, -14.3], [-10.4, 6.5, 12.3], [-6, 9.2, 12.3], [-6, 9.2, -14.3], TILE);
	});
	// The front's gable, its cornices and pilasters.
	triangle(b, [-6, 11, 12.02], [6, 11, 12.02], [0, 14, 12.02], white);
	const front = wallAt(0, 0, 12, 0, 1);
	for (const x of [-9.8, -6.2, 5.9, 9.5])
		wallBox(b, front, x, x + 0.34, 0, x * x < 40 ? 11 : 6.5, 0, 0.3, pale);
	wallBox(b, front, -10.2, 10.2, 6.3, 6.7, 0, 0.42, pale);
	wallBox(b, front, -6.3, 6.3, 10.8, 11.2, 0, 0.42, pale);
	// The portal: a door in stepped arches under a pediment.
	arch(b, front, 0, 0, 3.4, 5.4, pale, dark);
	arch(b, (u, y, o) => front(u, y, o + 0.02), 0, 0.1, 2.5, 4.6, pale, WOOD);
	wallBox(b, front, -2.6, 2.6, 5.7, 5.95, 0, 0.5, pale);
	// The rose window: a dark round in rings of stone, with its spokes.
	const rose = 8.6;
	for (let k = 0; k < 20; k++) {
		const [a0, a1] = [(k / 20) * Math.PI * 2, ((k + 1) / 20) * Math.PI * 2];
		const at = (a: number, rad: number, o: number) =>
			front(Math.cos(a) * rad, rose + Math.sin(a) * rad, o);
		quad(b, at(a0, 0, 0.03), at(a1, 0, 0.03), at(a1, 1.25, 0.03), at(a0, 1.25, 0.03), dark);
		quad(b, at(a1, 1.25, 0.26), at(a0, 1.25, 0.26), at(a0, 1.6, 0.26), at(a1, 1.6, 0.26), pale);
		if (k % 3 === 0)
			quad(
				b,
				at(a0, 0.2, 0.08),
				at(a0 + 0.06, 0.2, 0.08),
				at(a0 + 0.06, 1.25, 0.08),
				at(a0, 1.25, 0.08),
				pale,
			);
	}
	// Side doors and arched windows along the aisles and the transept.
	for (const x of [-8, 8]) arch(b, front, x, 0, 1.4, 3.6, pale, dark);
	for (const [x, n] of [
		[10, [1, 0]],
		[-10, [-1, 0]],
	] as const)
		for (let z = -11; z <= 9; z += 5) {
			if (z > -8 && z < 5) continue;
			arch(b, wallAt(x, 0, z, n[0], n[1]), 0, 1.6, 1.3, 3.8, pale, dark);
		}
	for (const [x, n] of [
		[14, [1, 0]],
		[-14, [-1, 0]],
	] as const)
		arch(b, wallAt(x, 0, -1.5, n[0], n[1]), 0, 2.4, 2, 5.6, pale, dark);
	for (const z of [-11, -6, -1, 4, 9])
		for (const [x, n] of [
			[6, [1, 0]],
			[-6, [-1, 0]],
		] as const)
			if (z < -7 || z > 4) arch(b, wallAt(x, 6.9, z, n[0], n[1]), 0, 0, 0.9, 2.6, pale, dark);
	// The apse, half round behind the nave, with its lower tile cone.
	ring(b, 0, -14, 6, -SKIRT, 6, 8.6, 18, white);
	for (let k = 0; k < 18; k++) {
		const [a0, a1] = [(k / 18) * Math.PI * 2, ((k + 1) / 18) * Math.PI * 2];
		mapped(r, () =>
			quad(
				r,
				[Math.sin(a0) * 6.4, 8.6, -14 + Math.cos(a0) * 6.4],
				[Math.sin(a1) * 6.4, 8.6, -14 + Math.cos(a1) * 6.4],
				[Math.sin(a1) * 0.4, 11.4, -14 + Math.cos(a1) * 0.4],
				[Math.sin(a0) * 0.4, 11.4, -14 + Math.cos(a0) * 0.4],
				TILE,
			),
		);
	}
	// The steps run across the whole width, down to the square.
	for (let k = 0; k < 7; k++)
		box(
			b,
			-11.5 - k * 0.15,
			-0.8,
			12 + k * 0.42,
			11.5 + k * 0.15,
			1.05 - k * 0.15,
			12.45 + k * 0.42,
			pale,
		);
	// The drum and the dome rise over the crossing.
	const cz = -1.5;
	const [drumLow, drumHigh, domeBase, domeRadius] = [13, 18.5, 18.9, 6.1];
	ring(b, 0, cz, 6.3, drumLow, 6.3, drumHigh, 24, pale);
	ring(b, 0, cz, 6.8, drumHigh, 6.3, domeBase, 24, pale);
	ring(b, 0, cz, 6.8, 13, 6.3, 13.5, 24, pale);
	for (let k = 0; k < 10; k++) {
		const a = (k / 10) * Math.PI * 2;
		const [x, z] = [Math.sin(a) * 6.32, cz + Math.cos(a) * 6.32];
		arch(b, wallAt(x, 0, z, Math.sin(a), Math.cos(a)), 0, 14, 1.3, 3.8, pale, dark);
	}
	const ribs = 16;
	const rows = 9;
	for (let row = 0; row < rows; row++) {
		const [e0, e1] = [(row / rows) * Math.PI * 0.5, ((row + 1) / rows) * Math.PI * 0.5];
		const [r0, r1] = [Math.cos(e0) * domeRadius, Math.cos(e1) * domeRadius];
		const [y0, y1] = [
			domeBase + Math.sin(e0) * domeRadius * 1.08,
			domeBase + Math.sin(e1) * domeRadius * 1.08,
		];
		for (let k = 0; k < ribs; k++) {
			const [a0, a1] = [(k / ribs) * Math.PI * 2, ((k + 1) / ribs) * Math.PI * 2];
			const [am, ae] = [a0 - 0.022, a0 + 0.022];
			const at = (a: number, rad: number, y: number) => [
				Math.sin(a) * rad,
				y,
				cz + Math.cos(a) * rad,
			];
			// Each gore is a slightly raised panel between ribs of pale stone.
			quad(
				b,
				at(a0, r0, y0),
				at(a1, r0, y0),
				at(a1, r1, y1),
				at(a0, r1, y1),
				(row + k) % 2 ? cobalt : deep,
			);
			quad(
				b,
				at(am, r0 + 0.06, y0),
				at(ae, r0 + 0.06, y0),
				at(ae, r1 + 0.06, y1),
				at(am, r1 + 0.06, y1),
				[0.3, 0.3, 0.32],
			);
		}
	}
	// The lantern on the dome's crown, with its cross.
	const crown = domeBase + domeRadius * 1.08;
	ring(b, 0, cz, 0.75, crown - 0.1, 0.75, crown + 1.5, 8, pale);
	ring(b, 0, cz, 1, crown + 1.5, 0.3, crown + 2.4, 8, cobalt);
	box(b, -0.05, crown + 2.4, cz - 0.05, 0.05, crown + 3.8, cz + 0.05, IRON);
	box(b, -0.4, crown + 3.1, cz - 0.05, 0.4, crown + 3.2, cz + 0.05, IRON);
	// The tower: string courses, open belfry arches on all sides, a cornice and a small dome.
	const [mx, mz] = [(tx0 + tx1) / 2, (tz0 + tz1) / 2];
	for (let y = 6; y < 20; y += 5)
		box(b, tx0 - 0.12, y, tz0 - 0.12, tx1 + 0.12, y + 0.26, tz1 + 0.12, pale);
	for (const [x, z, nx, nz] of [
		[mx, tz1, 0, 1],
		[mx, tz0, 0, -1],
		[tx1, mz, 1, 0],
		[tx0, mz, -1, 0],
	] as const)
		arch(b, wallAt(x, 16.4, z, nx, nz), 0, 0, 2.4, 4.8, pale, dark);
	box(b, tx0 - 0.35, 22, tz0 - 0.35, tx1 + 0.35, 22.5, tz1 + 0.35, pale);
	ring(b, mx, mz, 2.5, 22.5, 2.5, 23.8, 12, pale);
	for (let row = 0; row < 5; row++) {
		const [e0, e1] = [(row / 5) * Math.PI * 0.5, ((row + 1) / 5) * Math.PI * 0.5];
		ring(
			b,
			mx,
			mz,
			Math.cos(e0) * 2.7,
			23.8 + Math.sin(e0) * 2.6,
			Math.cos(e1) * 2.7,
			23.8 + Math.sin(e1) * 2.6,
			12,
			cobalt,
		);
	}
	box(b, mx - 0.04, 26.4, mz - 0.04, mx + 0.04, 27.6, mz + 0.04, IRON);
	box(b, mx - 0.3, 27, mz - 0.04, mx + 0.3, 27.08, mz + 0.04, IRON);
	return { stone: b, roof: r };
}

/** A sailing yacht at anchor, with its bow toward +z: a curved hull with sheer, a cabin, boom, stays and a furled sail. */
export function sailboat(): Build {
	const b = build();
	const hull: Color = [0.86, 0.86, 0.84];
	const stripe: Color = [0.05, 0.13, 0.3];
	const deck: Color = [0.55, 0.42, 0.27];
	const stations: readonly (readonly [number, number, number])[] = [
		[-4.8, 0.9, 1.05],
		[-3.6, 1.32, 0.95],
		[-2, 1.6, 0.88],
		[0, 1.72, 0.85],
		[2, 1.45, 0.92],
		[3.8, 0.8, 1.08],
		[5.4, 0.02, 1.32],
	];
	for (let k = 0; k + 1 < stations.length; k++) {
		const [z0, w0, y0] = stations[k] as readonly [number, number, number];
		const [z1, w1, y1] = stations[k + 1] as readonly [number, number, number];
		for (const side of [1, -1]) {
			const q = (
				a: readonly number[],
				c: readonly number[],
				e: readonly number[],
				f: readonly number[],
				color: Color,
			) => (side > 0 ? quad(b, a, c, e, f, color) : quad(b, c, a, f, e, color));
			const [b0, b1] = [w0 * 0.42, w1 * 0.42];
			q(
				[side * w0, y0, z0],
				[side * b0, -0.4, z0],
				[side * b1, -0.4, z1],
				[side * w1, y1, z1],
				hull,
			);
			q(
				[side * w0 * 1.01, y0, z0],
				[side * w0 * 0.98, y0 - 0.14, z0],
				[side * w1 * 0.98, y1 - 0.14, z1],
				[side * w1 * 1.01, y1, z1],
				stripe,
			);
		}
		quad(b, [-w0, y0, z0], [w0, y0, z0], [w1, y1, z1], [-w1, y1, z1], deck);
	}
	quad(b, [-0.9, 1.05, -4.8], [-0.38, -0.4, -4.8], [0.38, -0.4, -4.8], [0.9, 1.05, -4.8], hull);
	// The cabin steps up from the deck, with dark windows.
	box(b, -1, 0.9, -2.4, 1, 1.5, 1.6, hull);
	box(b, -0.86, 1.5, -1.8, 0.86, 1.68, 1, hull);
	for (const side of [1, -1])
		quad(
			b,
			[side * 1.01, 1.12, side > 0 ? -1.6 : 1],
			[side * 1.01, 1.12, side > 0 ? 1 : -1.6],
			[side * 1.01, 1.36, side > 0 ? 1 : -1.6],
			[side * 1.01, 1.36, side > 0 ? -1.6 : 1],
			[0.05, 0.08, 0.12],
		);
	// The mast, its boom with the furled sail, and its stays down to the bow and the stern.
	const silver: Color = [0.72, 0.72, 0.74];
	box(b, -0.055, 0.9, 0.6, 0.055, 13.5, 0.71, silver);
	box(b, -0.045, 2.5, -3.7, 0.045, 2.6, 0.65, silver);
	box(b, -0.15, 2.6, -3.5, 0.15, 2.98, 0.6, [0.08, 0.17, 0.38]);
	const stay = (x: number, y0: number, z0: number, y1: number, z1: number) => {
		quad(
			b,
			[x - 0.012, y0, z0],
			[x + 0.012, y0, z0],
			[x + 0.012, y1, z1],
			[x - 0.012, y1, z1],
			[0.5, 0.5, 0.52],
		);
		quad(
			b,
			[x + 0.012, y0, z0],
			[x - 0.012, y0, z0],
			[x - 0.012, y1, z1],
			[x + 0.012, y1, z1],
			[0.5, 0.5, 0.52],
		);
	};
	stay(0, 1.3, 5.3, 13.4, 0.65);
	stay(0, 1, -4.7, 13.4, 0.65);
	stay(0.9, 1, 0.3, 11, 0.65);
	stay(-0.9, 1, 0.3, 11, 0.65);
	return b;
}

/** A small open fishing boat, with its bow toward +z, painted in a color the instance gives. */
export function fishingBoat(): Build {
	const b = build();
	const pale: Color = [0.75, 0.72, 0.66];
	quad(b, [1, 0.55, -2.4], [0.6, -0.15, -2.4], [0.5, -0.15, 2.4], [0.02, 0.8, 3.2], WHITE);
	quad(b, [-0.6, -0.15, -2.4], [-1, 0.55, -2.4], [-0.02, 0.8, 3.2], [-0.5, -0.15, 2.4], WHITE);
	quad(b, [-1, 0.55, -2.4], [-0.6, -0.15, -2.4], [0.6, -0.15, -2.4], [1, 0.55, -2.4], WHITE);
	quad(b, [-1, 0.5, -2.4], [1, 0.5, -2.4], [0.02, 0.76, 3.2], [-0.02, 0.76, 3.2], pale);
	box(b, -0.5, 0.5, -1.6, 0.5, 1.5, -0.4, pale);
	box(b, -0.6, 1.5, -1.7, 0.6, 1.58, -0.3, WOOD);
	return b;
}

/** A beach parasol of canvas or thatch, one color, over two slatted loungers. */
export function parasol(): Build {
	const b = build();
	box(b, -0.035, 0, -0.035, 0.035, 2.5, 0.035, [0.58, 0.45, 0.3]);
	const sides = 10;
	for (let k = 0; k < sides; k++) {
		const a0 = (k / sides) * Math.PI * 2;
		const a1 = ((k + 1) / sides) * Math.PI * 2;
		const shade = k % 2 ? WHITE : ([0.9, 0.9, 0.86] as Color);
		for (const flip of [false, true]) {
			const [p, q] = [
				[Math.sin(a0) * 1.5, 2.05, Math.cos(a0) * 1.5],
				[Math.sin(a1) * 1.5, 2.05, Math.cos(a1) * 1.5],
			];
			if (flip) triangle(b, q, p, [0, 2.6, 0], shade);
			else triangle(b, p, q, [0, 2.6, 0], shade);
		}
	}
	for (const z of [-1, 0.45]) lounger(b, -0.9, z, 0);
	return b;
}

/** A street lamp: an iron post on a base, with a glass lantern under a little roof. */
export function streetLamp(): Build {
	const b = build();
	box(b, -0.14, 0, -0.14, 0.14, 0.5, 0.14, IRON);
	box(b, -0.05, 0.5, -0.05, 0.05, 3.6, 0.05, IRON);
	box(b, -0.18, 3.6, -0.18, 0.18, 4.1, 0.18, [0.95, 0.9, 0.72]);
	for (const [x, z] of [
		[-0.19, -0.19],
		[0.17, -0.19],
		[-0.19, 0.17],
		[0.17, 0.17],
	] as const)
		box(b, x, 3.6, z, x + 0.02, 4.1, z + 0.02, IRON);
	box(b, -0.26, 4.1, -0.26, 0.26, 4.2, 0.26, IRON);
	return b;
}

/** An angular rock of uneven broken facets, for the breakwater and the coast. */
export function boulder(): Build {
	const b = build();
	const rows = [
		[-0.9, 0.85],
		[-0.25, 1.1],
		[0.3, 0.95],
		[0.72, 0.62],
		[0.95, 0.12],
	] as const;
	const sides = 6;
	// Each corner of the rock's rings stands at its own distance, by a fixed list of offsets.
	const bumps = [
		1.25, 0.72, 1.12, 0.82, 1.32, 0.68, 1.02, 1.2, 0.76, 1.28, 0.88, 0.7, 1.18, 0.8, 1.34, 0.74,
	];
	const at = (row: number, k: number) => {
		const [y, r] = rows[row] as readonly [number, number];
		const a = (k / sides) * Math.PI * 2 + row * 0.35;
		const bump = bumps[(row * 5 + k * 3) % bumps.length] as number;
		return [Math.sin(a) * r * bump, y * (0.9 + (bump - 1) * 0.5), Math.cos(a) * r * bump];
	};
	for (let row = 0; row + 1 < rows.length; row++)
		for (let k = 0; k < sides; k++) {
			const tone = 0.74 + 0.28 * (((row * 3 + k * 7) % 5) * 0.25);
			const color: Color = [0.34 * tone, 0.28 * tone, 0.2 * tone];
			quad(b, at(row, k), at(row, k + 1), at(row + 1, k + 1), at(row + 1, k), color);
		}
	return b;
}

/**
 * A cypress: a solid narrow spire of near-black foliage, about five times as tall as it is wide, with a
 * smooth outline broken by soft flame-like folds. It reads as a spire at any distance, as a real one
 * does, so it needs no far card. `sides` and `rows` set its detail.
 */
export function cypress(sides: number, rows: number): Build {
	const b = build();
	const profile = (t: number) =>
		1.45 * Math.sin(Math.min(1, t * 1.12 + 0.1) * Math.PI) ** 0.62 * (1 - t * 0.35);
	// One smooth skin, with its vertices shared, so it shows no facets. Its ridges run up the tree as sprays do.
	const first = b.positions.length / 3;
	for (let row = 0; row <= rows; row++) {
		const t = row / rows;
		for (let k = 0; k <= sides; k++) {
			const a = (k / sides) * Math.PI * 2 + t * 2.4;
			const ridge = 1 + 0.06 * Math.sin(a * 7 + t * 9) + 0.035 * Math.sin(a * 13 - t * 21);
			const r = profile(t) * (sides > 8 ? ridge : 1);
			b.positions.push(Math.sin(a) * r, 0.5 + t * 14, Math.cos(a) * r);
			const tone = (0.8 + t * 0.55) * (0.9 + 0.12 * Math.sin(a * 7 + t * 9));
			// The map wraps the crown a whole number of times, and runs once up it, so it shows no seam.
			b.colors.push(0.026 * tone, 0.058 * tone, 0.03 * tone);
			b.uvs.push((k / sides) * 2, t * 0.98 + 0.01);
		}
	}
	for (let row = 0; row < rows; row++)
		for (let k = 0; k < sides; k++) {
			const at = first + row * (sides + 1) + k;
			const up = at + sides + 1;
			b.indices.push(at, at + 1, up, at + 1, up + 1, up);
		}
	for (let k = 0; k < 5; k++) {
		const a = (k / 5) * Math.PI * 2;
		quad(
			b,
			[Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14],
			[Math.sin(a + 1.26) * 0.14, 0, Math.cos(a + 1.26) * 0.14],
			[Math.sin(a + 1.26) * 0.14, 0.9, Math.cos(a + 1.26) * 0.14],
			[Math.sin(a) * 0.14, 0.9, Math.cos(a) * 0.14],
			[0.14, 0.09, 0.06],
		);
	}
	return b;
}

/** A palm: a leaning ringed trunk and a full crown of drooping fronds with fine leaflets. */
export function palm(): Build {
	const b = build();
	const bark: Color = [0.26, 0.2, 0.14];
	const leaflet: Color = [0.07, 0.17, 0.05];
	const rings = 8;
	const lean = (y: number) => (y / 8) ** 2 * 0.9;
	for (let k = 0; k < rings; k++) {
		const [y0, y1] = [(k / rings) * 8, ((k + 1) / rings) * 8];
		const [r0, r1] = [0.28 - k * 0.012, 0.24 - k * 0.012];
		for (let side = 0; side < 6; side++) {
			const [a0, a1] = [(side / 6) * Math.PI * 2, ((side + 1) / 6) * Math.PI * 2];
			quad(
				b,
				[lean(y0) + Math.sin(a0) * r0, y0, Math.cos(a0) * r0],
				[lean(y0) + Math.sin(a1) * r0, y0, Math.cos(a1) * r0],
				[lean(y1) + Math.sin(a1) * r1, y1, Math.cos(a1) * r1],
				[lean(y1) + Math.sin(a0) * r1, y1, Math.cos(a0) * r1],
				bark,
			);
		}
	}
	const fronds = 22;
	for (let k = 0; k < fronds; k++) {
		const a = (k * 2.399963) % (Math.PI * 2);
		const [cx, cz] = [Math.cos(a), Math.sin(a)];
		const [sx, sz] = [-cz, cx];
		const lift = (k % 4) * 0.28;
		const reach = 3.2 + (k % 3) * 0.5;
		const leaflets = 12;
		// Each frond arcs up and droops, with leaflets in pairs along its rib.
		for (let s = 1; s <= leaflets; s++) {
			const t = s / leaflets;
			const r = t * reach;
			const y = 8 + lift + 1.1 * Math.sin(t * Math.PI * 0.8) - 1.4 * t * t;
			const [px, pz] = [0.9 + cx * r, cz * r];
			const size = 0.8 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.75) + 0.12;
			for (const side of [1, -1]) {
				const [tx, tz] = [px + sx * side * size + cx * 0.25, pz + sz * side * size + cz * 0.25];
				const p0 = [px, y, pz];
				const p1 = [px + cx * 0.28, y - 0.02, pz + cz * 0.28];
				const p2 = [tx, y - 0.32, tz];
				triangle(b, p0, p1, p2, leaflet);
				triangle(b, p1, p0, p2, leaflet);
			}
		}
	}
	return b;
}

/**
 * A leafy shrub: a dense mound of small two-sided leaves that catch the light unevenly. Its color
 * comes from its instance.
 */
export function shrub(leaves = 280): Build {
	const b = build();
	for (let k = 0; k < leaves; k++) {
		const a = k * 2.399963;
		const h = (k + 0.5) / leaves;
		const r = Math.sqrt(Math.max(0, 1 - h * h)) * (0.8 + ((k * 13) % 5) * 0.08);
		const [x, y, z] = [Math.cos(a) * r, h * 1.05 + 0.02, Math.sin(a) * r];
		const s = (0.06 + ((k * 7) % 4) * 0.014) * Math.sqrt(280 / leaves);
		const tone = 0.62 + (((k * 11) % 7) / 7) * 0.5 + h * 0.2;
		// A leaf: pointed at both ends, turned its own way, so a bush of them shows no square edge.
		const turn = a + ((k * 17) % 11) * 0.5;
		const [sx, sz] = [-Math.sin(turn) * s * 0.55, Math.cos(turn) * s * 0.55];
		const [ux, uz] = [Math.cos(turn) * s, Math.sin(turn) * s];
		const rise = s * (0.5 + ((k * 3) % 5) * 0.2);
		const color: Color = [tone, tone, tone];
		quad(
			b,
			[x - ux, y - rise * 0.5, z - uz],
			[x + sx, y, z + sz],
			[x + ux, y + rise, z + uz],
			[x - sx, y, z - sz],
			color,
		);
	}
	return b;
}

/** A cafe table with its cloth and chairs under a square canvas parasol. */
export function cafeTable(): Build {
	const b = build();
	table(b, 0, 0);
	box(b, -0.03, 0.76, -0.03, 0.03, 2.5, 0.03, [0.6, 0.55, 0.45]);
	const canvas: Color = [0.92, 0.89, 0.8];
	const top = [0, 2.75, 0];
	const corners = [
		[-1.7, 2.2, 1.7],
		[1.7, 2.2, 1.7],
		[1.7, 2.2, -1.7],
		[-1.7, 2.2, -1.7],
	] as const;
	for (let k = 0; k < 4; k++) {
		const p = corners[k] as readonly number[];
		const q = corners[(k + 1) % 4] as readonly number[];
		triangle(b, p, q, top, canvas);
		triangle(b, q, p, top, canvas);
	}
	return b;
}

/** A cafe table with its cloth and chairs in the open. */
export function bareTable(): Build {
	const b = build();
	table(b, 0, 0);
	return b;
}

/** A cluster of round pots of flowers, for the square. */
export function planter(): Build {
	const b = build();
	pot(b, -0.5, 0, 0, 0.42, true);
	pot(b, 0.45, 0, 0.2, 0.34);
	pot(b, 0, 0, -0.55, 0.3, true);
	return b;
}

/** A shop's canvas awning on arms, as a slope from a wall out over the street. */
export function awning(): Build {
	const b = build();
	const canvas: Color = [0.92, 0.88, 0.78];
	for (const flip of [false, true]) {
		const p: number[][] = [
			[-3, 2.4, 3],
			[3, 2.4, 3],
			[3, 3.3, 0],
			[-3, 3.3, 0],
		];
		const [p0, p1, p2, p3] = p as [number[], number[], number[], number[]];
		if (flip) quad(b, p1, p0, p3, p2, canvas);
		else quad(b, p0, p1, p2, p3, canvas);
	}
	box(b, -3, 2.15, 2.96, 3, 2.42, 3.02, canvas);
	return b;
}

/** A park's gazebo: stepped stone, arched bays on columns, and a tiled roof with a finial. */
export function pavilion(): { stone: Build; roof: Build } {
	const b = build();
	const r = build();
	const stone: Color = [0.8, 0.72, 0.58];
	for (let k = 0; k < 3; k++)
		ring(b, 0, 0, 4.7 - k * 0.5, k * 0.25, 4.7 - k * 0.5, (k + 1) * 0.25, 8, stone);
	ring(b, 0, 0, 3.7, 0.75, 0, 0.75, 8, PAVING);
	const sides = 6;
	const rad = 3.1;
	for (let k = 0; k < sides; k++) {
		const [a0, a1] = [(k / sides) * Math.PI * 2, ((k + 1) / sides) * Math.PI * 2];
		const [x0, z0, x1, z1] = [
			Math.sin(a0) * rad,
			Math.cos(a0) * rad,
			Math.sin(a1) * rad,
			Math.cos(a1) * rad,
		];
		ring(b, x0, z0, 0.27, 0.75, 0.22, 3.1, 8, stone);
		box(b, x0 - 0.34, 3.1, z0 - 0.34, x0 + 0.34, 3.26, z0 + 0.34, stone);
		// The arch between two columns, as stepped panels under a beam.
		const [mx, mz] = [(x0 + x1) / 2, (z0 + z1) / 2];
		const steps = 7;
		for (let s = 0; s < steps; s++) {
			const [t0, t1] = [s / steps, (s + 1) / steps];
			const y = (t: number) => 3.25 + Math.sin(t * Math.PI) * 0.75;
			const at = (t: number) => [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
			const [p, q] = [at(t0), at(t1)] as [number[], number[]];
			const face = [
				[p[0], y(t0), p[1]],
				[q[0], y(t1), q[1]],
				[q[0], 4.25, q[1]],
				[p[0], 4.25, p[1]],
			] as [number[], number[], number[], number[]];
			quad(b, face[0], face[1], face[2], face[3], stone);
			quad(b, face[1], face[0], face[3], face[2], stone);
		}
		void mx;
		void mz;
	}
	ring(b, 0, 0, 3.75, 4.25, 3.75, 4.55, sides, stone);
	mapped(r, () => {
		for (let k = 0; k < sides; k++) {
			const [a0, a1] = [(k / sides) * Math.PI * 2, ((k + 1) / sides) * Math.PI * 2];
			const [ax, az, cx, cz] = [
				Math.sin(a0) * 4.4,
				Math.cos(a0) * 4.4,
				Math.sin(a1) * 4.4,
				Math.cos(a1) * 4.4,
			];
			quad(
				r,
				[ax, 4.55, az],
				[cx, 4.55, cz],
				[Math.sin(a1) * 0.2, 6.7, Math.cos(a1) * 0.2],
				[Math.sin(a0) * 0.2, 6.7, Math.cos(a0) * 0.2],
				TILE,
			);
		}
	});
	ring(b, 0, 0, 0.32, 6.6, 0.1, 7, 6, stone);
	ring(b, 0, 0, 0.12, 7, 0.02, 7.5, 6, stone);
	return { stone: b, roof: r };
}

/** A park bench of timber slats on iron legs. */
export function bench(): Build {
	const b = build();
	for (const x of [-0.8, 0.72]) box(b, x, 0, -0.22, x + 0.08, 0.45, 0.22, IRON);
	for (let k = 0; k < 4; k++)
		box(b, -0.9, 0.43, -0.24 + k * 0.125, 0.9, 0.47, -0.14 + k * 0.125, WOOD);
	for (let k = 0; k < 3; k++)
		box(b, -0.9, 0.55 + k * 0.13, -0.27, 0.9, 0.65 + k * 0.13, -0.23, WOOD);
	return b;
}

/** A lighthouse: a white round tower with a red band and lamp room, on a stone foot. */
export function lighthouse(): Build {
	const b = build();
	ring(b, 0, 0, 3.2, -2, 3, 1.6, 16, [0.62, 0.57, 0.48]);
	ring(b, 0, 0, 3, 1.6, 0, 1.6, 16, [0.62, 0.57, 0.48]);
	ring(b, 0, 0, 1.6, 1.6, 1.15, 10.5, 16, [0.93, 0.92, 0.88]);
	ring(b, 0, 0, 1.45, 4.4, 1.4, 5.3, 16, [0.7, 0.1, 0.07]);
	ring(b, 0, 0, 1.55, 10.5, 1.55, 10.75, 16, [0.08, 0.08, 0.08]);
	ring(b, 0, 0, 0.85, 10.75, 0.85, 12.1, 12, [0.72, 0.1, 0.07]);
	ring(b, 0, 0, 1.05, 12.1, 0.1, 12.9, 12, [0.08, 0.08, 0.08]);
	return b;
}

/** A hilltop's stone keep: a square tower with battlements, set on the crest, over a walled court. */
export function keep(): Build {
	const b = build();
	const white: Color = [1, 1, 1];
	mapped(b, () => {
		box(b, -5, -SKIRT, -5, 5, 21, 5, white);
		box(b, -11, -SKIRT, -11, 11, 5, -9.2, white);
		box(b, -11, -SKIRT, -11, -9.2, 5, 11, white);
		box(b, 9.2, -SKIRT, -11, 11, 5, 11, white);
	});
	box(b, -5.4, 20.8, -5.4, 5.4, 22, 5.4, white);
	for (let k = -2; k <= 2; k++) {
		const at = k * 2;
		for (const [x, z] of [
			[at, 5.1],
			[at, -5.1],
			[5.1, at],
			[-5.1, at],
		] as const)
			box(b, x - 0.5, 22, z - 0.5, x + 0.5, 23.1, z + 0.5, white);
	}
	for (const y of [6, 11, 16]) {
		quad(
			b,
			[-0.45, y, 5.03],
			[0.45, y, 5.03],
			[0.45, y + 1.5, 5.03],
			[-0.45, y + 1.5, 5.03],
			[0.05, 0.04, 0.04],
		);
		quad(
			b,
			[0.45, y, -5.03],
			[-0.45, y, -5.03],
			[-0.45, y + 1.5, -5.03],
			[0.45, y + 1.5, -5.03],
			[0.05, 0.04, 0.04],
		);
	}
	return b;
}
