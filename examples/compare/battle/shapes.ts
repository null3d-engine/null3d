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

type Point = readonly [number, number, number];

/**
 * A mesh of the flat faces of a convex solid, each face a list of its corners in any order. Each
 * face takes its own vertices and normal, facing away from `center`, a point inside the solid, and
 * texture coordinates in meters across its plane.
 */
export function convexFaces(faces: readonly (readonly Point[])[], center: Point): MeshData {
	const vertices = faces.reduce((sum, f) => sum + f.length, 0);
	const triangles = faces.reduce((sum, f) => sum + f.length - 2, 0);
	const position = new Float32Array(vertices * 3);
	const normal = new Float32Array(vertices * 3);
	const uv = new Float32Array(vertices * 2);
	const index = new Uint16Array(triangles * 3);
	let v = 0;
	let t = 0;
	for (const face of faces) {
		const average = (k: 0 | 1 | 2) => face.reduce((sum, p) => sum + p[k], 0) / face.length;
		const mid: Point = [average(0), average(1), average(2)];
		// The normal of the corners in any order, from the first three that span the plane.
		const [a, b, c] = face as [Point, Point, Point];
		let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
		let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
		let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
		const outward =
			nx * (mid[0] - center[0]) + ny * (mid[1] - center[1]) + nz * (mid[2] - center[2]);
		const length = Math.hypot(nx, ny, nz) * (outward < 0 ? -1 : 1);
		nx /= length;
		ny /= length;
		nz /= length;
		// Two axes across the plane, which order the corners counter-clockwise about the normal.
		const ux = a[0] - mid[0];
		const uy = a[1] - mid[1];
		const uz = a[2] - mid[2];
		const ul = Math.hypot(ux, uy, uz) || 1;
		const e1 = [ux / ul, uy / ul, uz / ul] as const;
		const e2 = [ny * e1[2] - nz * e1[1], nz * e1[0] - nx * e1[2], nx * e1[1] - ny * e1[0]] as const;
		const angle = (p: Point) => {
			const d: Point = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]];
			return Math.atan2(
				d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2],
				d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2],
			);
		};
		const ordered = [...face].sort((p, q) => angle(p) - angle(q));
		// Texture coordinates on the two world axes that the face lies most across.
		const ax = Math.abs(nx);
		const ay = Math.abs(ny);
		const az = Math.abs(nz);
		const [i, j] = ax >= ay && ax >= az ? [2, 1] : ay >= az ? [0, 2] : [0, 1];
		const first = v;
		for (const p of ordered) {
			position.set(p, v * 3);
			normal.set([nx, ny, nz], v * 3);
			uv.set([p[i] as number, p[j] as number], v * 2);
			v++;
		}
		for (let k = 1; k < ordered.length - 1; k++) {
			index.set([first, first + k, first + k + 1], t);
			t += 3;
		}
	}
	return { position, normal, uv, index };
}

/**
 * A box centered on the origin with its edges cut to bevels `bevel` wide, as rolled and welded
 * armor shows them. With `top`, its top face narrows to `top.width` and `top.depth` and moves by
 * `top.shift` along Z, as a tank's glacis and turret slope.
 */
export function beveledBox(
	width: number,
	height: number,
	depth: number,
	bevel: number,
	top?: { width: number; depth: number; shift?: number },
): MeshData {
	const half = [width / 2, height / 2, depth / 2] as const;
	const signs = [-1, 1] as const;
	/** The corner (sx, sy, sz)'s point on the face across axis `axis`. */
	const corner = (sx: number, sy: number, sz: number, axis: number): Point => {
		const p = [sx * half[0], sy * half[1], sz * half[2]].map((value, k) =>
			k === axis ? value : value - Math.sign(value) * bevel,
		) as [number, number, number];
		if (!top) return p;
		const f = (p[1] + half[1]) / height;
		return [
			p[0] * (1 + (top.width / width - 1) * f),
			p[1],
			p[2] * (1 + (top.depth / depth - 1) * f) + (top.shift ?? 0) * f,
		];
	};
	const faces: Point[][] = [];
	for (let axis = 0; axis < 3; axis++)
		for (const s of signs) {
			// The face across this axis, at this sign.
			const face: Point[] = [];
			for (const a of signs)
				for (const b of signs) {
					const sv = [0, 0, 0];
					sv[axis] = s;
					sv[(axis + 1) % 3] = a;
					sv[(axis + 2) % 3] = b;
					face.push(corner(sv[0] as number, sv[1] as number, sv[2] as number, axis));
				}
			faces.push(face);
		}
	for (let axis = 0; axis < 3; axis++) {
		// The bevels along the edges that run along this axis.
		const p = (axis + 1) % 3;
		const q = (axis + 2) % 3;
		for (const sp of signs)
			for (const sq of signs) {
				const face: Point[] = [];
				for (const along of signs)
					for (const on of [p, q]) {
						const sv = [0, 0, 0];
						sv[axis] = along;
						sv[p] = sp;
						sv[q] = sq;
						face.push(corner(sv[0] as number, sv[1] as number, sv[2] as number, on));
					}
				faces.push(face);
			}
	}
	for (const sx of signs)
		for (const sy of signs)
			for (const sz of signs) faces.push([0, 1, 2].map((axis) => corner(sx, sy, sz, axis)));
	return convexFaces(faces, [0, 0, (top?.shift ?? 0) / 2]);
}

/**
 * A solid turned about the Z axis from a profile of (radius, z) points, in `segments` around. Each
 * step of the profile keeps its own normals, so its edges stay sharp. Texture coordinates run in
 * meters around and along it.
 */
export function lathe(profile: readonly (readonly [number, number])[], segments: number): MeshData {
	const steps = profile.length - 1;
	const count = steps * (segments + 1) * 2;
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const index = new Uint16Array(steps * segments * 6);
	let v = 0;
	let t = 0;
	for (let k = 0; k < steps; k++) {
		const [r0, z0] = profile[k] as readonly [number, number];
		const [r1, z1] = profile[k + 1] as readonly [number, number];
		// The step's normal in the profile's plane: across the step, away from the axis.
		const dr = r1 - r0;
		const dz = z1 - z0;
		const length = Math.hypot(dr, dz) || 1;
		const nr = dz / length;
		const nz = -dr / length;
		const first = v;
		for (let s = 0; s <= segments; s++) {
			const angle = (s / segments) * 2 * Math.PI;
			const c = Math.cos(angle);
			const sn = Math.sin(angle);
			for (const [r, z] of [
				[r0, z0],
				[r1, z1],
			] as const) {
				position.set([c * r, sn * r, z], v * 3);
				normal.set([c * nr, sn * nr, nz], v * 3);
				uv.set([angle * Math.max(r0, r1), z], v * 2);
				v++;
			}
		}
		for (let s = 0; s < segments; s++) {
			const a = first + s * 2;
			index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], t);
			t += 6;
		}
	}
	return { position, normal, uv, index };
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
 * functions give, with as many color channels as the color function returns. Texture coordinates
 * run in meters, and normals come from the heights' slopes.
 */
export function heightGrid(
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	nx: number,
	nz: number,
	height: (x: number, z: number) => number,
	color: (x: number, z: number, y: number) => readonly number[],
): MeshData {
	const count = (nx + 1) * (nz + 1);
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const channels = color(x0, z0, height(x0, z0)).length;
	const colors = new Float32Array(count * channels);
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
			colors.set(color(x, z, y), v * channels);
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

/**
 * A card of foliage along +Z from the origin, `length` long and `width` wide, in `segments` along
 * its length, bending down by `droop` at its tip. Its texture coordinates run from 0 to 1 across it
 * and along it, as the foliage textures expect. Each vertex's color darkens toward the card's root,
 * by `shade` at the root, as foliage deep in a crown gets less light.
 */
export function foliageCard(
	length: number,
	width: number,
	droop: number,
	segments: number,
	shade: number,
): MeshData {
	const count = (segments + 1) * 2;
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const color = new Float32Array(count * 3);
	const index = new Uint16Array(segments * 6);
	for (let k = 0; k <= segments; k++) {
		const t = k / segments;
		const y = -droop * t * t;
		// The slope of the bend tilts the normal back toward the root.
		const slope = 2 * droop * t;
		const length2 = Math.hypot(slope, length);
		const light = 1 - shade * (1 - t);
		for (const side of [0, 1]) {
			const v = k * 2 + side;
			position.set([(side - 0.5) * width, y, t * length], v * 3);
			normal.set([0, length / length2, slope / length2], v * 3);
			uv.set([side, t], v * 2);
			color.set([light, light, light], v * 3);
		}
	}
	for (let k = 0; k < segments; k++) {
		const a = k * 2;
		index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], k * 6);
	}
	return { position, normal, uv, index, color };
}

/**
 * A tracer's streak: two thin crossed strips along -Z from its head at the origin, `length` long,
 * that narrow and fade toward the tail. The vertex colors' alpha holds the fade, which falls off
 * with the square of the distance from the head, so the light gathers at the head.
 */
export function tracerStreak(length: number, width: number): MeshData {
	const segments = 4;
	const count = (segments + 1) * 4;
	const position = new Float32Array(count * 3);
	const normal = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const color = new Float32Array(count * 4);
	const index = new Uint16Array(segments * 12);
	let v = 0;
	for (const [ax, ay] of [
		[1, 0],
		[0, 1],
	] as const) {
		const first = v;
		for (let k = 0; k <= segments; k++) {
			const t = k / segments;
			const half = (width / 2) * (0.35 + 0.65 * t);
			for (const side of [-1, 1]) {
				position.set([ax * half * side, ay * half * side, -length * (1 - t)], v * 3);
				normal.set([ay, ax, 0], v * 3);
				uv.set([(side + 1) / 2, t], v * 2);
				color.set([1, 1, 1, t * t], v * 4);
				v++;
			}
		}
		for (let k = 0; k < segments; k++) {
			const a = first + k * 2;
			index.set(
				[a, a + 1, a + 2, a + 1, a + 3, a + 2],
				(first / 2 / (segments + 1)) * segments * 6 + k * 6,
			);
		}
	}
	return { position, normal, uv, index, color };
}

/** A tree's parts: its trunk and branches in bark, and its foliage cards, if it has leaves. */
export interface TreeParts {
	wood: MeshData;
	foliage?: MeshData;
}

/**
 * A pine: a tapering trunk in bark, ringed by whorls of drooping branches that shorten toward the
 * top, each branch a flat card of needles and a crossed one standing on it, under a leader of
 * crossed cards. `seed` picks its height and its branches.
 */
export function pineTree(seed: number): TreeParts {
	const height = 9 + 6 * hash01(seed, 1);
	const wood = placed(taperedCylinder(0.26, 0.05, height, 7), { position: [0, height / 2, 0] });
	const cards: [MeshData, Placement][] = [];
	const whorls = 7;
	const base = height * (0.22 + 0.08 * hash01(seed, 2));
	for (let w = 0; w < whorls; w++) {
		const t = w / whorls;
		const y = base + (height * 0.94 - base) * t;
		const reach = (0.55 + 2.9 * (1 - t) ** 0.9) * (0.85 + 0.3 * hash01(seed, w, 3));
		const branches = 5 + Math.floor(hash01(seed, w, 4) * 2);
		for (let b = 0; b < branches; b++) {
			const yaw = (b / branches) * 2 * Math.PI + w * 2.4 + hash01(seed, w * 8 + b, 5) * 0.5;
			const pitch = 0.12 + 0.3 * (1 - t) + 0.1 * hash01(seed, w * 8 + b, 6);
			const shade = 0.55 - 0.25 * t;
			const flat = foliageCard(reach, reach * 0.62, reach * 0.18, 2, shade);
			const upright = foliageCard(reach * 0.9, reach * 0.38, reach * 0.16, 2, shade);
			const along = then(turn(0, 1, 0, yaw), turn(1, 0, 0, pitch));
			cards.push([flat, { position: [0, y, 0], rotation: along }]);
			cards.push([
				upright,
				{ position: [0, y + 0.05, 0], rotation: then(along, turn(0, 0, 1, Math.PI / 2)) },
			]);
		}
	}
	// The leader: crossed cards pointing up from the top whorl.
	for (let k = 0; k < 3; k++)
		cards.push([
			foliageCard(1.6, 0.9, 0, 2, 0.3),
			{
				position: [0, height * 0.86, 0],
				rotation: then(turn(0, 1, 0, (k / 3) * Math.PI), turn(1, 0, 0, -Math.PI / 2)),
			},
		]);
	return { wood, foliage: merged(cards) };
}

/**
 * A broadleaf tree: a trunk that forks into limbs, under a round crown of leaf clusters, each
 * cluster two crossed cards facing out from the crown's middle. `seed` picks its size and limbs.
 */
export function broadleafTree(seed: number): TreeParts {
	const height = 7 + 3 * hash01(seed, 1);
	const fork = height * 0.45;
	const parts: (MeshData | [MeshData, Placement])[] = [
		[taperedCylinder(0.34, 0.2, fork, 8), { position: [0, fork / 2, 0] }],
	];
	const crown = {
		y: height * 0.68,
		rx: 2.6 + 0.8 * hash01(seed, 2),
		ry: 2.2 + 0.5 * hash01(seed, 3),
	};
	const limbs = 4 + Math.floor(hash01(seed, 4) * 2);
	for (let l = 0; l < limbs; l++) {
		const yaw = (l / limbs) * 2 * Math.PI + hash01(seed, l, 5);
		const lean = 0.45 + 0.35 * hash01(seed, l, 6);
		const length = (crown.y - fork) / Math.cos(lean) + 0.6;
		const rotation = then(turn(0, 1, 0, yaw), turn(1, 0, 0, lean));
		const direction = new Float64Array(3);
		rotateVector(direction, 0, rotation, 0, 0, length / 2, 0);
		parts.push([
			taperedCylinder(0.17, 0.05, length, 6),
			{
				position: [direction[0] as number, fork + (direction[1] as number), direction[2] as number],
				rotation,
			},
		]);
	}
	const clusters: [MeshData, Placement][] = [];
	const count = 34;
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let c = 0; c < count; c++) {
		// Points spread evenly over the crown's upper part, and a few inside it.
		const up = 1 - (c / (count - 1)) * 1.45;
		const ring = Math.sqrt(Math.max(0, 1 - up * up));
		const inner = c % 5 === 0 ? 0.55 : 0.92 + 0.12 * hash01(seed, c, 7);
		const ox = Math.cos(c * golden) * ring * inner;
		const oy = up * inner;
		const oz = Math.sin(c * golden) * ring * inner;
		const size = 1.9 + 0.7 * hash01(seed, c, 8);
		const outward = Math.atan2(ox, oz);
		const rise = Math.atan2(oy, Math.hypot(ox, oz));
		const facing = then(turn(0, 1, 0, outward), turn(1, 0, 0, -rise));
		const center: [number, number, number] = [
			ox * crown.rx,
			crown.y + oy * crown.ry,
			oz * crown.rx,
		];
		// One card faces out from the crown, and one stands along the outward line, both centered on
		// the cluster's point and spun about that line.
		const card = placed(foliageCard(size, size, 0, 1, 0.45 * (1 - inner)), {
			position: [0, 0, -size / 2],
		});
		const spin = turn(0, 0, 1, hash01(seed, c, 9) * Math.PI);
		for (const stand of [turn(1, 0, 0, Math.PI / 2), turn(0, 0, 1, -Math.PI / 2)])
			clusters.push([card, { position: center, rotation: then(facing, then(spin, stand)) }]);
	}
	return { wood: merged(parts), foliage: merged(clusters) };
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

/** A bolt head on a face whose normal lies along `axis` (0 = X, 1 = Y, 2 = Z). */
function bolt(axis: 0 | 1 | 2): MeshData {
	const size = [0.05, 0.05, 0.05];
	size[axis] = 0.03;
	return boxGeometry(size[0] as number, size[1] as number, size[2] as number);
}

/**
 * The tank's parts: hull and tracks, turret, and barrel. Each part's pivot is its origin. The
 * armor has bevelled edges, bolted add-on plates and access panels; the wheels are turned with a
 * tyre, a dished disc and a hub; the tracks are links with grousers and guide horns.
 */
export function tankParts(): { hull: MeshData; turret: MeshData; barrel: MeshData } {
	const along = turn(1, 0, 0, Math.PI / 2);
	/** A turned part, its axis along X, its outer face toward `side`. */
	const onAxle = (
		profile: readonly (readonly [number, number])[],
		segments: number,
		side: number,
	) => placed(lathe(profile, segments), { rotation: turn(0, 1, 0, side * (Math.PI / 2)) });
	const wheelProfile = [
		[0, -0.16],
		[0.42, -0.16],
		[0.42, 0.16],
		[0.36, 0.16],
		[0.36, 0.11],
		[0.15, 0.11],
		[0.15, 0.19],
		[0.1, 0.22],
		[0, 0.22],
	] as const;
	const sprocketProfile = [
		[0, -0.18],
		[0.4, -0.18],
		[0.4, 0.18],
		[0.3, 0.18],
		[0.3, 0.12],
		[0.17, 0.12],
		[0.17, 0.24],
		[0, 0.24],
	] as const;
	const link = merged([
		boxGeometry(0.62, 0.05, 0.15),
		[boxGeometry(0.62, 0.035, 0.04), { position: [0, -0.04, 0] }],
		[boxGeometry(0.06, 0.09, 0.08), { position: [0, 0.07, 0] }],
	]);
	/** The glacis's slope: its top leans back by 0.6 m over its 1 m height. */
	const glacis = turn(1, 0, 0, -Math.atan2(0.6, 1));
	const parts: (MeshData | [MeshData, Placement])[] = [
		// The hull, with a sloped front and back.
		[
			beveledBox(2.6, 1.0, 6.2, 0.08, { width: 2.4, depth: 4.6, shift: 0.2 }),
			{ position: [0, 1.15, 0] },
		],
		// The tracks' lower run.
		[boxGeometry(0.6, 0.3, 5.6), { position: [-1.45, 0.18, 0] }],
		[boxGeometry(0.6, 0.3, 5.6), { position: [1.45, 0.18, 0] }],
		// The rear: a bulkhead with two exhausts and two fuel cans.
		[beveledBox(1.8, 0.45, 0.6, 0.05), { position: [0, 1.4, -3.05] }],
		[
			placed(
				lathe(
					[
						[0, -0.3],
						[0.11, -0.3],
						[0.13, -0.2],
						[0.13, 0.2],
						[0.09, 0.3],
						[0, 0.3],
					],
					10,
				),
				{},
			),
			{ position: [-0.7, 1.45, -3.45] },
		],
		[
			placed(
				lathe(
					[
						[0, -0.3],
						[0.11, -0.3],
						[0.13, -0.2],
						[0.13, 0.2],
						[0.09, 0.3],
						[0, 0.3],
					],
					10,
				),
				{},
			),
			{ position: [0.7, 1.45, -3.45] },
		],
		[beveledBox(0.34, 0.46, 0.16, 0.03), { position: [-1.15, 1.25, -2.95] }],
		[beveledBox(0.34, 0.46, 0.16, 0.03), { position: [-0.78, 1.25, -2.95] }],
		// The bow: two headlights in guards, tow hooks and a hull gun in its ball.
		[
			lathe(
				[
					[0, -0.08],
					[0.11, -0.08],
					[0.12, 0.05],
					[0.09, 0.07],
					[0, 0.07],
				],
				10,
			),
			{ position: [-0.9, 1.62, 2.55] },
		],
		[
			lathe(
				[
					[0, -0.08],
					[0.11, -0.08],
					[0.12, 0.05],
					[0.09, 0.07],
					[0, 0.07],
				],
				10,
			),
			{ position: [0.9, 1.62, 2.55] },
		],
		[boxGeometry(0.3, 0.05, 0.22), { position: [-0.9, 1.76, 2.5] }],
		[boxGeometry(0.3, 0.05, 0.22), { position: [0.9, 1.76, 2.5] }],
		[beveledBox(0.16, 0.22, 0.3, 0.03), { position: [-0.85, 0.7, 3.1] }],
		[beveledBox(0.16, 0.22, 0.3, 0.03), { position: [0.85, 0.7, 3.1] }],
		[sphereGeometry(0.15, 10, 6), { position: [0.6, 1.38, 2.86] }],
		[placed(cylinderGeometry(0.035, 0.6, 6), { rotation: along }), { position: [0.6, 1.38, 3.12] }],
		// The driver's hatch, and access panels over the engine.
		[
			lathe(
				[
					[0, -0.03],
					[0.32, -0.03],
					[0.3, 0.03],
					[0, 0.04],
				],
				14,
			),
			{
				position: [-0.55, 1.66, 1.75],
				rotation: turn(1, 0, 0, -Math.PI / 2),
			},
		],
		[beveledBox(0.9, 0.04, 0.8, 0.015), { position: [-0.5, 1.66, -0.6] }],
		[beveledBox(0.9, 0.04, 0.8, 0.015), { position: [0.5, 1.66, -0.6] }],
	];
	// Bolted add-on plates over the glacis, and spare track links above them.
	for (const x of [-0.8, 0, 0.8]) {
		parts.push([
			beveledBox(0.74, 0.7, 0.07, 0.025),
			{ position: [x, 0.95, 2.95], rotation: glacis },
		]);
		for (const [bx, by] of [
			[-0.28, -0.27],
			[0.28, -0.27],
			[-0.28, 0.27],
			[0.28, 0.27],
		] as const) {
			const offset = new Float64Array(3);
			rotateVector(offset, 0, glacis, 0, bx, by, 0.05);
			parts.push([
				bolt(2),
				{
					position: [
						x + (offset[0] as number),
						0.95 + (offset[1] as number),
						2.95 + (offset[2] as number),
					],
					rotation: glacis,
				},
			]);
		}
	}
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
		parts.push([boxGeometry(1.5, 0.04, 0.08), { position: [0, 1.67, -1.55 - k * 0.2] }]);
	// Bolts at the corners of the access panels.
	for (const x of [-0.5, 0.5])
		for (const [dx, dz] of [
			[-0.4, -0.35],
			[0.4, -0.35],
			[-0.4, 0.35],
			[0.4, 0.35],
		] as const)
			parts.push([bolt(1), { position: [x + dx, 1.69, -0.6 + dz] }]);
	for (const side of [-1, 1]) {
		// Road wheels, the drive sprocket with its teeth in front, and the idler behind.
		const wheel = onAxle(wheelProfile, 12, side);
		for (let w = 0; w < 6; w++)
			parts.push([wheel, { position: [side * 1.45, 0.42, -2.3 + w * 0.92] }]);
		parts.push([onAxle(sprocketProfile, 12, side), { position: [side * 1.45, 0.62, 2.95] }]);
		parts.push([
			onAxle(wheelProfile, 12, side),
			{ position: [side * 1.45, 0.56, -2.95], scale: [1.05, 1.05, 1.05] },
		]);
		for (let k = 0; k < 10; k++) {
			const a = (k / 10) * 2 * Math.PI;
			parts.push([
				boxGeometry(0.12, 0.1, 0.08),
				{
					position: [side * 1.45, 0.62 + Math.sin(a) * 0.44, 2.95 + Math.cos(a) * 0.44],
					rotation: turn(1, 0, 0, -a),
				},
			]);
		}
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
		// Track skirts in five bevelled panels, each hung a little out of line, bolted along the top.
		for (let k = 0; k < 5; k++) {
			const hang = turn(0, 0, 1, side * (0.04 + 0.03 * ((k * 7) % 3)));
			const z = -2.6 + k * 1.3;
			parts.push([
				beveledBox(0.08, 0.62, 1.26, 0.025),
				{ position: [side * 1.76, 0.86, z], rotation: hang },
			]);
			for (const dz of [-0.48, 0, 0.48])
				parts.push([bolt(0), { position: [side * 1.81, 1.1, z + dz], rotation: hang }]);
		}
		// The fender, with a stowage bin on it.
		parts.push([beveledBox(0.62, 0.06, 6.7, 0.02), { position: [side * 1.47, 1.2, 0] }]);
		parts.push([beveledBox(0.5, 0.34, 1.3, 0.04), { position: [side * 1.47, 1.4, -2.1] }]);
	}
	const hull = merged(parts);

	/** The turret's sides lean in by 0.25 m over their 0.85 m height. */
	const lean = Math.atan2(0.25, 0.85);
	const cupola = lathe(
		[
			[0, -0.18],
			[0.36, -0.18],
			[0.36, 0.08],
			[0.3, 0.12],
			[0.3, 0.16],
			[0.27, 0.2],
			[0, 0.2],
		],
		14,
	);
	const turretParts: (MeshData | [MeshData, Placement])[] = [
		[
			beveledBox(2.2, 0.85, 3.0, 0.09, { width: 1.7, depth: 2.3, shift: -0.1 }),
			{ position: [0, 0.42, -0.1] },
		],
		// The mantlet in front, with the gun's sleeve.
		[beveledBox(0.9, 0.62, 0.45, 0.07), { position: [0, 0.45, 1.45] }],
		[
			placed(
				lathe(
					[
						[0, 0],
						[0.24, 0],
						[0.24, 0.12],
						[0.2, 0.2],
						[0, 0.2],
					],
					14,
				),
				{},
			),
			{ position: [0, 0.45, 1.66] },
		],
		// The commander's cupola, with vision blocks around it and a gun on it.
		[cupola, { position: [0.45, 0.97, -0.5], rotation: turn(1, 0, 0, -Math.PI / 2) }],
		[boxGeometry(0.12, 0.14, 0.34), { position: [0.45, 1.24, -0.32] }],
		[placed(cylinderGeometry(0.03, 0.9, 6), { rotation: along }), { position: [0.45, 1.27, 0.1] }],
		// The loader's hatch, the sights and the antenna on its base.
		[
			lathe(
				[
					[0, -0.04],
					[0.29, -0.04],
					[0.27, 0.04],
					[0, 0.05],
				],
				12,
			),
			{
				position: [-0.45, 0.88, -0.6],
				rotation: turn(1, 0, 0, -Math.PI / 2),
			},
		],
		[beveledBox(0.22, 0.2, 0.26, 0.03), { position: [-0.35, 0.95, 0.55] }],
		[cylinderGeometry(0.06, 0.12, 8), { position: [-0.7, 0.86, -1.0] }],
		[cylinderGeometry(0.018, 2.4, 4), { position: [-0.7, 2.0, -1.0] }],
		// Stowage boxes on the turret's sides, and a rack of kit behind it.
		[beveledBox(0.25, 0.4, 1.2, 0.03), { position: [-1.0, 0.4, -0.5] }],
		[beveledBox(0.25, 0.4, 1.2, 0.03), { position: [1.0, 0.4, -0.5] }],
		[boxGeometry(1.7, 0.05, 0.6), { position: [0, 0.3, -1.85] }],
		[boxGeometry(1.7, 0.05, 0.05), { position: [0, 0.62, -2.13] }],
		[beveledBox(0.6, 0.32, 0.45, 0.03), { position: [-0.45, 0.48, -1.85] }],
		[
			placed(cylinderGeometry(0.2, 1.1, 10), { rotation: turn(0, 0, 1, Math.PI / 2) }),
			{ position: [0.35, 0.53, -1.85] },
		],
	];
	for (let k = 0; k < 6; k++) {
		const a = (k / 6) * 2 * Math.PI + 0.3;
		turretParts.push([
			beveledBox(0.13, 0.09, 0.07, 0.015),
			{
				position: [0.45 + Math.sin(a) * 0.33, 1.02, -0.5 + Math.cos(a) * 0.33],
				rotation: turn(0, 1, 0, a),
			},
		]);
	}
	for (const side of [-1, 1]) {
		// Bolted plates on the turret's cheeks, leaning in with its sides.
		const cheek = turn(0, 0, 1, side * lean);
		turretParts.push([
			beveledBox(0.07, 0.6, 0.9, 0.02),
			{ position: [side * 0.99, 0.43, 0.85], rotation: cheek },
		]);
		for (const [dy, dz] of [
			[-0.22, -0.35],
			[0.22, -0.35],
			[-0.22, 0.35],
			[0.22, 0.35],
		] as const)
			turretParts.push([
				bolt(0),
				{ position: [side * (1.03 - dy * Math.sin(lean)), 0.43 + dy, 0.85 + dz], rotation: cheek },
			]);
		// Lifting eyes at the turret's corners.
		for (const z of [0.6, -1.0])
			turretParts.push([boxGeometry(0.04, 0.1, 0.12), { position: [side * 0.75, 0.88, z] }]);
		// Smoke dischargers: three tubes on each side of the turret's front, aimed out and up.
		for (let k = 0; k < 3; k++)
			turretParts.push([
				placed(cylinderGeometry(0.07, 0.34, 8), { rotation: along }),
				{
					position: [side * (0.82 + 0.02 * k), 0.62 + k * 0.12, 0.95 - k * 0.06],
					rotation: then(turn(0, 1, 0, side * 0.5), turn(1, 0, 0, -0.35)),
				},
			]);
	}
	const turret = merged(turretParts);
	// The barrel points along +Z from its pivot at the mantlet: a tube with bands of thermal sleeve,
	// the fume extractor and a muzzle brake with ports on both sides.
	const barrel = merged([
		lathe(
			[
				[0, 0],
				[0.17, 0],
				[0.17, 0.35],
				[0.125, 0.45],
				[0.125, 1.15],
				[0.14, 1.17],
				[0.14, 1.3],
				[0.125, 1.32],
				[0.125, 1.95],
				[0.17, 2.05],
				[0.17, 2.45],
				[0.12, 2.55],
				[0.12, 2.95],
				[0.135, 2.97],
				[0.135, 3.1],
				[0.12, 3.12],
				[0.12, 3.6],
				[0, 3.6],
			],
			14,
		),
		[beveledBox(0.34, 0.26, 0.2, 0.03), { position: [0, 0, 3.62] }],
		[beveledBox(0.34, 0.26, 0.14, 0.03), { position: [0, 0, 3.86] }],
		[boxGeometry(0.2, 0.26, 0.26), { position: [0, 0, 3.74] }],
	]);
	return { hull, turret, barrel };
}
