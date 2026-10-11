// Shapes that Battle builds in code, as arrays that both engines upload as they are: parts placed
// and merged into one mesh, tapered boxes, spheres, rocks, grids, grass clumps, dead trees, ruined
// walls and the tank's parts. Texture coordinates run in meters, as the shared surfaces expect, except
// where a shape says otherwise. Setup code: nothing here runs in a frame.

import {
	boxGeometry,
	cylinderGeometry,
	hash01,
	type MeshData,
	quatAxisAngle,
	quatMultiply,
	rotateVector,
} from '../../lib/compare-scene';

/** A part's place in a merged mesh: a position, a rotation quaternion and a scale per axis. */
export interface Placement {
	position?: readonly [number, number, number];
	rotation?: readonly [number, number, number, number];
	scale?: readonly [number, number, number];
}

/** A turn of `angle` radians about the unit axis, as a quaternion. */
export function turn(
	ax: number,
	ay: number,
	az: number,
	angle: number,
): [number, number, number, number] {
	const q: [number, number, number, number] = [0, 0, 0, 1];
	quatAxisAngle(q, 0, ax, ay, az, angle);
	return q;
}

/** Rotation b followed by rotation a. */
export function then(
	a: readonly [number, number, number, number],
	b: readonly [number, number, number, number],
): [number, number, number, number] {
	const q: [number, number, number, number] = [0, 0, 0, 1];
	quatMultiply(q, 0, a, 0, b, 0);
	return q;
}

/** A copy of the mesh, scaled, then turned, then moved. Normals follow the scale's inverse. */
export function placed(mesh: MeshData, { position, rotation, scale }: Placement): MeshData {
	const [px, py, pz] = position ?? [0, 0, 0];
	const q = rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = scale ?? [1, 1, 1];
	const count = mesh.position.length / 3;
	const out: MeshData = {
		position: new Float32Array(count * 3),
		normal: new Float32Array(count * 3),
		uv: Float32Array.from(mesh.uv),
		index: Uint16Array.from(mesh.index),
	};
	if (mesh.color) out.color = Float32Array.from(mesh.color);
	const v = new Float64Array(3);
	for (let i = 0; i < count; i++) {
		rotateVector(
			v,
			0,
			q,
			0,
			(mesh.position[i * 3] as number) * sx,
			(mesh.position[i * 3 + 1] as number) * sy,
			(mesh.position[i * 3 + 2] as number) * sz,
		);
		out.position[i * 3] = (v[0] as number) + px;
		out.position[i * 3 + 1] = (v[1] as number) + py;
		out.position[i * 3 + 2] = (v[2] as number) + pz;
		const nx = (mesh.normal[i * 3] as number) / sx;
		const ny = (mesh.normal[i * 3 + 1] as number) / sy;
		const nz = (mesh.normal[i * 3 + 2] as number) / sz;
		rotateVector(v, 0, q, 0, nx, ny, nz);
		const length = Math.hypot(v[0] as number, v[1] as number, v[2] as number) || 1;
		out.normal[i * 3] = (v[0] as number) / length;
		out.normal[i * 3 + 1] = (v[1] as number) / length;
		out.normal[i * 3 + 2] = (v[2] as number) / length;
	}
	return out;
}

/** One mesh of several parts, each placed. Colors stay only when every part has them. */
export function merged(parts: readonly (MeshData | [MeshData, Placement])[]): MeshData {
	const meshes = parts.map((part) => (Array.isArray(part) ? placed(part[0], part[1]) : part));
	const vertices = meshes.reduce((sum, m) => sum + m.position.length / 3, 0);
	if (vertices > 65_536)
		throw new RangeError(`A merged mesh of ${vertices} vertices is too large.`);
	const indices = meshes.reduce((sum, m) => sum + m.index.length, 0);
	const colored = meshes.every((m) => m.color);
	const out: MeshData = {
		position: new Float32Array(vertices * 3),
		normal: new Float32Array(vertices * 3),
		uv: new Float32Array(vertices * 2),
		index: new Uint16Array(indices),
	};
	if (colored) out.color = new Float32Array(vertices * 3);
	let v = 0;
	let t = 0;
	for (const m of meshes) {
		out.position.set(m.position, v * 3);
		out.normal.set(m.normal, v * 3);
		out.uv.set(m.uv, v * 2);
		if (out.color && m.color) out.color.set(m.color, v * 3);
		for (let i = 0; i < m.index.length; i++) out.index[t + i] = (m.index[i] as number) + v;
		v += m.position.length / 3;
		t += m.index.length;
	}
	return out;
}

/** A copy of the mesh with every vertex in one linear color. */
export function colored(mesh: MeshData, r: number, g: number, b: number): MeshData {
	const color = new Float32Array(mesh.position.length);
	for (let i = 0; i < color.length; i += 3) color.set([r, g, b], i);
	return { ...mesh, color };
}

/** Smooth normals from the triangles: each vertex takes the area-weighted sum of its faces' normals. */
export function smoothNormals(mesh: MeshData): void {
	const n = mesh.normal;
	n.fill(0);
	const p = mesh.position;
	for (let t = 0; t < mesh.index.length; t += 3) {
		const a = (mesh.index[t] as number) * 3;
		const b = (mesh.index[t + 1] as number) * 3;
		const c = (mesh.index[t + 2] as number) * 3;
		const ux = (p[b] as number) - (p[a] as number);
		const uy = (p[b + 1] as number) - (p[a + 1] as number);
		const uz = (p[b + 2] as number) - (p[a + 2] as number);
		const vx = (p[c] as number) - (p[a] as number);
		const vy = (p[c + 1] as number) - (p[a + 1] as number);
		const vz = (p[c + 2] as number) - (p[a + 2] as number);
		const fx = uy * vz - uz * vy;
		const fy = uz * vx - ux * vz;
		const fz = ux * vy - uy * vx;
		for (const i of [a, b, c]) {
			n[i] = (n[i] as number) + fx;
			n[i + 1] = (n[i + 1] as number) + fy;
			n[i + 2] = (n[i + 2] as number) + fz;
		}
	}
	for (let i = 0; i < n.length; i += 3) {
		const length = Math.hypot(n[i] as number, n[i + 1] as number, n[i + 2] as number);
		// A vertex of only degenerate triangles, such as a sphere's pole, faces up.
		if (length === 0) {
			n[i + 1] = 1;
			continue;
		}
		n[i] = (n[i] as number) / length;
		n[i + 1] = (n[i + 1] as number) / length;
		n[i + 2] = (n[i + 2] as number) / length;
	}
}

/**
 * A box whose top face is narrowed to `topWidth` and `topDepth` and moved by `topShift` along Z, as
 * a tank's glacis and turret slope. Each face keeps flat normals.
 */
export function taperedBox(
	width: number,
	height: number,
	depth: number,
	topWidth: number,
	topDepth: number,
	topShift = 0,
): MeshData {
	const box = boxGeometry(width, height, depth);
	const p = box.position;
	for (let i = 0; i < p.length; i += 3) {
		if ((p[i + 1] as number) <= 0) continue;
		p[i] = ((p[i] as number) * topWidth) / width;
		p[i + 2] = ((p[i + 2] as number) * topDepth) / depth + topShift;
	}
	// Each face's four vertices take the face's new normal.
	for (let f = 0; f < 6; f++) {
		const a = f * 4 * 3;
		const ux = (p[a + 3] as number) - (p[a] as number);
		const uy = (p[a + 4] as number) - (p[a + 1] as number);
		const uz = (p[a + 5] as number) - (p[a + 2] as number);
		const vx = (p[a + 6] as number) - (p[a] as number);
		const vy = (p[a + 7] as number) - (p[a + 1] as number);
		const vz = (p[a + 8] as number) - (p[a + 2] as number);
		let nx = vy * uz - vz * uy;
		let ny = vz * ux - vx * uz;
		let nz = vx * uy - vy * ux;
		const length = Math.hypot(nx, ny, nz) || 1;
		nx /= length;
		ny /= length;
		nz /= length;
		for (let k = 0; k < 4; k++) box.normal.set([nx, ny, nz], (f * 4 + k) * 3);
	}
	return box;
}

/** A UV sphere centered on the origin, with smooth normals. */
export function sphereGeometry(radius: number, widthSegments: number, heightSegments: number) {
	const count = (widthSegments + 1) * (heightSegments + 1);
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const index = new Uint16Array(widthSegments * heightSegments * 6);
	let v = 0;
	for (let y = 0; y <= heightSegments; y++) {
		const phi = (y / heightSegments) * Math.PI;
		for (let x = 0; x <= widthSegments; x++) {
			const theta = (x / widthSegments) * 2 * Math.PI;
			const nx = -Math.cos(theta) * Math.sin(phi);
			const ny = Math.cos(phi);
			const nz = Math.sin(theta) * Math.sin(phi);
			position.set([nx * radius, ny * radius, nz * radius], v * 3);
			normal.set([nx, ny, nz], v * 3);
			uv.set(
				[(x / widthSegments) * 2 * Math.PI * radius, (1 - y / heightSegments) * Math.PI * radius],
				v * 2,
			);
			v++;
		}
	}
	let t = 0;
	for (let y = 0; y < heightSegments; y++)
		for (let x = 0; x < widthSegments; x++) {
			const a = y * (widthSegments + 1) + x;
			const b = a + widthSegments + 1;
			index.set([a, b, a + 1, b, b + 1, a + 1], t);
			t += 6;
		}
	return { position, normal, uv, index } satisfies MeshData;
}

/**
 * A rock: a sphere pushed in and out by seeded noise, squashed flat, with smooth normals. Each seed
 * gives another shape.
 */
export function rockGeometry(seed: number): MeshData {
	const rock = sphereGeometry(1, 14, 9);
	const p = rock.position;
	for (let i = 0; i < p.length; i += 3) {
		const x = p[i] as number;
		const y = p[i + 1] as number;
		const z = p[i + 2] as number;
		// Three bumps of their own per rock, and finer facets.
		let bump = 1;
		for (let k = 0; k < 3; k++) {
			const dx = hash01(seed, k, 1) * 2 - 1;
			const dy = hash01(seed, k, 2) * 2 - 1;
			const dz = hash01(seed, k, 3) * 2 - 1;
			const length = Math.hypot(dx, dy, dz) || 1;
			bump += 0.22 * Math.max(0, (x * dx + y * dy + z * dz) / length) ** 2;
		}
		const facet =
			0.9 + 0.2 * hash01(seed, Math.round(x * 3) * 7 + Math.round(y * 3) * 3, Math.round(z * 3));
		const r = bump * facet;
		p[i] = x * r;
		p[i + 1] = y * r * 0.62 + 0.25;
		p[i + 2] = z * r;
	}
	smoothNormals(rock);
	return rock;
}

/**
 * A grid of `nx` by `nz` cells over [x0, x1] by [z0, z1], at the heights and colors that the
 * functions give. Texture coordinates run in meters, and normals come from the heights' slopes.
 */
export function heightGrid(
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	nx: number,
	nz: number,
	height: (x: number, z: number) => number,
	color: (x: number, z: number, y: number) => readonly [number, number, number],
): MeshData {
	const count = (nx + 1) * (nz + 1);
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const colors = new Float32Array(count * 3);
	const index = new Uint16Array(nx * nz * 6);
	const dx = (x1 - x0) / nx;
	const dz = (z1 - z0) / nz;
	let v = 0;
	for (let j = 0; j <= nz; j++)
		for (let i = 0; i <= nx; i++) {
			const x = x0 + i * dx;
			const z = z0 + j * dz;
			const y = height(x, z);
			position.set([x, y, z], v * 3);
			const sx = height(x + dx * 0.5, z) - height(x - dx * 0.5, z);
			const sz = height(x, z + dz * 0.5) - height(x, z - dz * 0.5);
			const length = Math.hypot(sx / dx, 1, sz / dz);
			normal.set([-sx / dx / length, 1 / length, -sz / dz / length], v * 3);
			uv.set([x, z], v * 2);
			colors.set(color(x, z, y), v * 3);
			v++;
		}
	let t = 0;
	for (let j = 0; j < nz; j++)
		for (let i = 0; i < nx; i++) {
			const a = j * (nx + 1) + i;
			const b = a + nx + 1;
			// Counter-clockwise from above.
			index.set([a, b, a + 1, a + 1, b, b + 1], t);
			t += 6;
		}
	return { position, normal, uv, index, color: colors };
}

/**
 * An upright plane of `nx` by `ny` cells, from x = 0 to `width` and y = 0 to `height`, facing +Z.
 * Its texture coordinates run from 0 to 1 across it, so a vertex offset can grow with u.
 */
export function clothGeometry(width: number, height: number, nx: number, ny: number): MeshData {
	const count = (nx + 1) * (ny + 1);
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const index = new Uint16Array(nx * ny * 6);
	let v = 0;
	for (let j = 0; j <= ny; j++)
		for (let i = 0; i <= nx; i++) {
			position.set([(i / nx) * width, (j / ny) * height, 0], v * 3);
			normal.set([0, 0, 1], v * 3);
			uv.set([i / nx, j / ny], v * 2);
			v++;
		}
	let t = 0;
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++) {
			const a = j * (nx + 1) + i;
			const b = a + nx + 1;
			index.set([a, a + 1, b, a + 1, b + 1, b], t);
			t += 6;
		}
	return { position, normal, uv, index };
}

/**
 * A clump of grass: `blades` thin blades, each a strip of three segments that leans and bends.
 * Texture coordinates hold the blade's share of its height in v, so a vertex offset sways the tips.
 */
export function grassClump(seed: number, blades = 7): MeshData {
	const parts: MeshData[] = [];
	for (let b = 0; b < blades; b++) {
		const angle = hash01(seed, b, 1) * Math.PI * 2;
		const lean = 0.15 + 0.35 * hash01(seed, b, 2);
		const height = 0.35 + 0.45 * hash01(seed, b, 3);
		const width = 0.05 + 0.03 * hash01(seed, b, 4);
		const ox = (hash01(seed, b, 5) - 0.5) * 0.25;
		const oz = (hash01(seed, b, 6) - 0.5) * 0.25;
		const segments = 3;
		const position = new Float32Array((segments + 1) * 2 * 3);
		const uv = new Float32Array((segments + 1) * 2 * 2);
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
		for (let s = 0; s <= segments; s++) {
			const f = s / segments;
			const w = width * (1 - f * 0.9);
			const bend = lean * f * f * height;
			const y = height * f;
			for (const side of [-1, 1]) {
				const k = s * 2 + (side > 0 ? 1 : 0);
				position.set([ox + ca * side * w + sa * bend, y, oz - sa * side * w + ca * bend], k * 3);
				uv.set([side > 0 ? 1 : 0, f], k * 2);
			}
		}
		const index = new Uint16Array(segments * 6);
		for (let s = 0; s < segments; s++) {
			const a = s * 2;
			index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], s * 6);
		}
		const blade: MeshData = { position, normal: new Float32Array(position.length), uv, index };
		smoothNormals(blade);
		// Grass lights from above more than from its faces, as a soft lawn looks.
		for (let i = 0; i < blade.normal.length; i += 3) {
			const nx = (blade.normal[i] as number) * 0.4;
			const ny = 1;
			const nz = (blade.normal[i + 2] as number) * 0.4;
			const length = Math.hypot(nx, ny, nz);
			blade.normal.set([nx / length, ny / length, nz / length], i);
		}
		parts.push(blade);
	}
	return merged(parts);
}

/** A dead tree: a leaning tapered trunk and a few bare branches. */
export function deadTree(seed: number): MeshData {
	const height = 5 + 4 * hash01(seed, 1);
	const trunk = taperedCylinder(0.22, 0.08, height, 7);
	const parts: (MeshData | [MeshData, Placement])[] = [
		[
			trunk,
			{ position: [0, height / 2, 0], rotation: turn(0, 0, 1, (hash01(seed, 2) - 0.5) * 0.2) },
		],
	];
	const branches = 3 + Math.floor(hash01(seed, 3) * 3);
	for (let b = 0; b < branches; b++) {
		const length = 1.2 + 1.8 * hash01(seed, b, 4);
		const at = height * (0.45 + 0.45 * hash01(seed, b, 5));
		const yaw = hash01(seed, b, 6) * Math.PI * 2;
		const tilt = 0.5 + 0.6 * hash01(seed, b, 7);
		const rotation = then(turn(0, 1, 0, yaw), turn(0, 0, 1, tilt));
		const direction = new Float64Array(3);
		rotateVector(direction, 0, rotation, 0, 0, length / 2, 0);
		parts.push([
			taperedCylinder(0.07, 0.02, length, 5),
			{
				position: [direction[0] as number, at + (direction[1] as number), direction[2] as number],
				rotation,
			},
		]);
	}
	return merged(parts);
}

/** A cylinder around Y, centered on the origin, from `bottom` radius to `top` radius, without caps. */
export function taperedCylinder(
	bottom: number,
	top: number,
	height: number,
	segments: number,
): MeshData {
	const count = (segments + 1) * 2;
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const index = new Uint16Array(segments * 6);
	const slope = (bottom - top) / height;
	for (let s = 0; s <= segments; s++) {
		const angle = (s / segments) * 2 * Math.PI;
		const x = Math.sin(angle);
		const z = Math.cos(angle);
		const length = Math.hypot(1, slope);
		for (const [k, y, r] of [
			[0, -height / 2, bottom],
			[1, height / 2, top],
		] as const) {
			const v = s * 2 + k;
			position.set([x * r, y, z * r], v * 3);
			normal.set([x / length, slope / length, z / length], v * 3);
			uv.set([(s / segments) * 2 * Math.PI * Math.max(bottom, top), y + height / 2], v * 2);
		}
	}
	for (let s = 0; s < segments; s++) {
		const a = s * 2;
		index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], s * 6);
	}
	return { position, normal, uv, index };
}

/** A pine: a trunk under tiers of cones that narrow toward the top. `seed` picks its height. */
export function pineTree(seed: number): MeshData {
	const height = 8 + 6 * hash01(seed, 1);
	const parts: (MeshData | [MeshData, Placement])[] = [
		[taperedCylinder(0.22, 0.1, height * 0.4, 6), { position: [0, height * 0.2, 0] }],
	];
	const tiers = 4;
	for (let t = 0; t < tiers; t++) {
		const base = height * (0.22 + 0.17 * t);
		const tall = height * (0.36 - 0.04 * t);
		const radius = (2.3 - 0.45 * t) * (0.85 + 0.3 * hash01(seed, t, 2));
		parts.push([
			taperedCylinder(radius, 0.05, tall, 9),
			{ position: [0, base + tall / 2, 0], rotation: turn(0, 1, 0, hash01(seed, t, 3) * Math.PI) },
		]);
	}
	return merged(parts);
}

/** A Czech hedgehog: three steel beams crossed at the middle, standing on their ends. */
export function hedgehog(): MeshData {
	const beam = boxGeometry(0.16, 1.9, 0.16);
	const tilt = Math.atan(Math.SQRT2);
	return merged([
		[
			beam,
			{ position: [0, 0.62, 0], rotation: then(turn(0, 1, 0, Math.PI / 4), turn(1, 0, 0, tilt)) },
		],
		[
			beam,
			{ position: [0, 0.62, 0], rotation: then(turn(0, 1, 0, -Math.PI / 4), turn(1, 0, 0, tilt)) },
		],
		[beam, { position: [0, 0.62, 0], rotation: turn(0, 0, 1, Math.PI / 2) }],
	]);
}

/**
 * A ruined stone wall along X from 0 to `length`: blocks of uneven height, broken at the top, with
 * window gaps. `seed` picks the breaks.
 */
export function ruinedWall(length: number, height: number, seed: number, windows = true): MeshData {
	const parts: [MeshData, Placement][] = [];
	const step = 0.9;
	const thickness = 0.6;
	const columns = Math.round(length / step);
	for (let c = 0; c < columns; c++) {
		// The wall falls away toward a broken end, with ragged steps.
		const along = c / columns;
		const broken = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, along * 1.3 + 0.1));
		const top = height * Math.max(0.15, broken * (0.75 + 0.35 * hash01(seed, c, 1)));
		const x = (c + 0.5) * step;
		const window = windows && c % 4 === 2 && top > 2.6;
		if (window) {
			parts.push([boxGeometry(step, 1, thickness), { position: [x, 0.5, 0] }]);
			parts.push([
				boxGeometry(step, top - 2.2, thickness),
				{ position: [x, 2.2 + (top - 2.2) / 2, 0] },
			]);
		} else {
			parts.push([boxGeometry(step, top, thickness), { position: [x, top / 2, 0] }]);
		}
		// A fallen block at the foot of some columns.
		if (hash01(seed, c, 2) > 0.7) {
			const s = 0.3 + 0.3 * hash01(seed, c, 3);
			parts.push([
				boxGeometry(s * 1.4, s, s),
				{
					position: [x, s / 2, (hash01(seed, c, 4) > 0.5 ? 1 : -1) * (0.7 + hash01(seed, c, 5))],
					rotation: turn(0, 1, 0, hash01(seed, c, 6) * 3),
				},
			]);
		}
	}
	return merged(parts);
}

/** The tank's parts: hull and tracks, turret, and barrel. Each part's pivot is its origin. */
export function tankParts(): { hull: MeshData; turret: MeshData; barrel: MeshData } {
	const axle = turn(0, 0, 1, Math.PI / 2);
	const along = turn(1, 0, 0, Math.PI / 2);
	const wheel = placed(cylinderGeometry(0.42, 0.32, 14), { rotation: axle });
	const hub = placed(cylinderGeometry(0.16, 0.44, 8), { rotation: axle });
	const sprocket = placed(cylinderGeometry(0.46, 0.36, 12), { rotation: axle });
	const link = boxGeometry(0.62, 0.07, 0.16);
	const parts: (MeshData | [MeshData, Placement])[] = [
		// The hull, with a sloped front and back.
		[taperedBox(2.6, 1.0, 6.2, 2.4, 4.6, 0.2), { position: [0, 1.15, 0] }],
		// The tracks' lower run.
		[boxGeometry(0.6, 0.3, 5.6), { position: [-1.45, 0.18, 0] }],
		[boxGeometry(0.6, 0.3, 5.6), { position: [1.45, 0.18, 0] }],
		// The engine deck: a rear box with grilles, two exhausts and two fuel cans.
		[boxGeometry(1.8, 0.45, 0.6), { position: [0, 1.4, -3.05] }],
		[
			placed(cylinderGeometry(0.11, 0.6, 8), { rotation: along }),
			{ position: [-0.7, 1.45, -3.45] },
		],
		[placed(cylinderGeometry(0.11, 0.6, 8), { rotation: along }), { position: [0.7, 1.45, -3.45] }],
		[boxGeometry(0.34, 0.46, 0.16), { position: [-1.15, 1.25, -2.95] }],
		[boxGeometry(0.34, 0.46, 0.16), { position: [-0.78, 1.25, -2.95] }],
		// The bow: two headlights in guards, tow hooks and a hull gun.
		[
			placed(cylinderGeometry(0.11, 0.12, 10), { rotation: along }),
			{ position: [-0.9, 1.62, 2.55] },
		],
		[
			placed(cylinderGeometry(0.11, 0.12, 10), { rotation: along }),
			{ position: [0.9, 1.62, 2.55] },
		],
		[boxGeometry(0.3, 0.05, 0.22), { position: [-0.9, 1.76, 2.5] }],
		[boxGeometry(0.3, 0.05, 0.22), { position: [0.9, 1.76, 2.5] }],
		[boxGeometry(0.16, 0.22, 0.3), { position: [-0.85, 0.7, 3.1] }],
		[boxGeometry(0.16, 0.22, 0.3), { position: [0.85, 0.7, 3.1] }],
		[sphereGeometry(0.15, 10, 6), { position: [0.6, 1.38, 2.86] }],
		[placed(cylinderGeometry(0.035, 0.6, 6), { rotation: along }), { position: [0.6, 1.38, 3.12] }],
	];
	// Spare track links across the glacis, as crews hang them for armor.
	for (let k = 0; k < 6; k++)
		parts.push([
			link,
			{
				position: [-0.95 + k * 0.38, 1.5, 2.66],
				rotation: then(turn(0, 1, 0, Math.PI / 2), turn(1, 0, 0, -0.95)),
			},
		]);
	// Grilles over the engine: slats across the rear deck.
	for (let k = 0; k < 7; k++)
		parts.push([boxGeometry(1.5, 0.04, 0.08), { position: [0, 1.67, -1.4 - k * 0.2] }]);
	for (const side of [-1, 1]) {
		// Road wheels with hubs, the drive sprocket in front and the idler behind.
		for (let w = 0; w < 6; w++) {
			parts.push([wheel, { position: [side * 1.48, 0.42, -2.3 + w * 0.92] }]);
			parts.push([hub, { position: [side * 1.5, 0.42, -2.3 + w * 0.92] }]);
		}
		parts.push([sprocket, { position: [side * 1.48, 0.62, 2.95] }]);
		parts.push([sprocket, { position: [side * 1.48, 0.56, -2.95] }]);
		// Track links on the lower run, and over the sprocket and the idler.
		for (let k = 0; k < 34; k++)
			parts.push([link, { position: [side * 1.45, 0.02, -2.75 + k * 0.167] }]);
		for (const [z, y, sign] of [
			[2.95, 0.62, 1],
			[-2.95, 0.56, -1],
		] as const)
			for (let k = 0; k < 7; k++) {
				const a = -Math.PI / 2 + (k / 6) * Math.PI;
				parts.push([
					link,
					{
						position: [side * 1.45, y + Math.sin(a) * 0.52, z + sign * Math.cos(a) * 0.52],
						rotation: turn(1, 0, 0, -sign * a),
					},
				]);
			}
		// Track skirts in five panels, each hung a little out of line.
		for (let k = 0; k < 5; k++)
			parts.push([
				boxGeometry(0.08, 0.62, 1.26),
				{
					position: [side * 1.76, 0.86, -2.6 + k * 1.3],
					rotation: turn(0, 0, 1, side * (0.04 + 0.03 * ((k * 7) % 3))),
				},
			]);
		parts.push([boxGeometry(0.62, 0.06, 6.7), { position: [side * 1.47, 1.2, 0] }]);
	}
	const hull = merged(parts);
	const turret = merged([
		[taperedBox(2.2, 0.85, 3.0, 1.7, 2.3, -0.1), { position: [0, 0.42, -0.1] }],
		// The mantlet in front, the commander's cupola with its gun, the loader's hatch, sights and an
		// antenna.
		[boxGeometry(0.8, 0.6, 0.4), { position: [0, 0.45, 1.45] }],
		[cylinderGeometry(0.36, 0.25, 14), { position: [0.45, 0.97, -0.5] }],
		[cylinderGeometry(0.3, 0.08, 12), { position: [0.45, 1.13, -0.5] }],
		[boxGeometry(0.12, 0.14, 0.34), { position: [0.45, 1.24, -0.32] }],
		[placed(cylinderGeometry(0.03, 0.9, 6), { rotation: along }), { position: [0.45, 1.27, 0.1] }],
		[cylinderGeometry(0.28, 0.06, 12), { position: [-0.45, 0.88, -0.6] }],
		[boxGeometry(0.22, 0.2, 0.26), { position: [-0.35, 0.95, 0.55] }],
		[placed(cylinderGeometry(0.1, 0.5, 8), { rotation: axle }), { position: [-1.0, 0.75, 0.55] }],
		[placed(cylinderGeometry(0.1, 0.5, 8), { rotation: axle }), { position: [1.0, 0.75, 0.55] }],
		[cylinderGeometry(0.018, 2.4, 4), { position: [-0.7, 2.0, -1.0] }],
		// Stowage boxes on the turret's sides, and a rack of kit behind it.
		[boxGeometry(0.25, 0.4, 1.2), { position: [-1.0, 0.4, -0.5] }],
		[boxGeometry(0.25, 0.4, 1.2), { position: [1.0, 0.4, -0.5] }],
		[boxGeometry(1.7, 0.05, 0.6), { position: [0, 0.3, -1.85] }],
		[boxGeometry(1.7, 0.05, 0.05), { position: [0, 0.62, -2.13] }],
		[boxGeometry(0.6, 0.32, 0.45), { position: [-0.45, 0.48, -1.85] }],
		[placed(cylinderGeometry(0.2, 1.1, 10), { rotation: axle }), { position: [0.35, 0.53, -1.85] }],
		// Smoke dischargers: three tubes on each side of the turret's front, aimed out and up.
		...[-1, 1].flatMap((side) =>
			[0, 1, 2].map((k): [MeshData, Placement] => [
				placed(cylinderGeometry(0.07, 0.34, 8), { rotation: along }),
				{
					position: [side * (0.82 + 0.02 * k), 0.62 + k * 0.12, 0.95 - k * 0.06],
					rotation: then(turn(0, 1, 0, side * 0.5), turn(1, 0, 0, -0.35)),
				},
			]),
		),
	]);
	const tube = (radius: number, length: number, z: number) =>
		placed(cylinderGeometry(radius, length, 12), {
			position: [0, 0, z],
			rotation: along,
		});
	// The barrel points along +Z from its pivot at the mantlet: a thermal sleeve in sections, the
	// fume extractor and a muzzle brake with ports on both sides.
	const barrel = merged([
		tube(0.12, 3.6, 1.8),
		tube(0.14, 0.5, 0.6),
		tube(0.14, 0.5, 1.25),
		tube(0.17, 0.7, 2.2),
		tube(0.14, 0.5, 2.95),
		[boxGeometry(0.34, 0.26, 0.2), { position: [0, 0, 3.62] }],
		[boxGeometry(0.34, 0.26, 0.14), { position: [0, 0, 3.86] }],
		[boxGeometry(0.2, 0.26, 0.26), { position: [0, 0, 3.74] }],
	]);
	return { hull, turret, barrel };
}
