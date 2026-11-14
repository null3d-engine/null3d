// A CPU model of what null3D's WebGPU path draws in one view, and of what culling small groups of
// triangles would drop from it. It follows the engine's own rules:
// - per copy: the view's frustum on the copy's sphere, the level of detail by error against the
//   view's factor (one pixel at Medium, one texel in a shadow map), and the hiding of a copy whose
//   bounds cover less than the threshold (`cull.wgsl` `level_of`, `null3d-core` `levels.rs`);
// - per piece, in the camera's view only: the frustum and the cone (`cull.wgsl` `piece_shows`);
// - shadow cascades: each caster's level in the map's texels and whole levels, no pieces;
// and adds, per group of 64 or 128 triangles inside the kept pieces, the tests a group pass would
// make: off screen (frustum), facing away (cone, camera only) and hidden (the depth pyramid that
// two-phase occlusion builds, camera only).

import { Depth, drawTriangles, Pyramid, type View } from './raster.ts';
import type { Groups, Mesh } from './scene.ts';

/** A copy of a mesh: its world matrix's three rows (stored units to world), its largest axis scale,
 * its world sphere, and the kind it counts under. */
export interface Copy {
	mesh: Mesh;
	kind: string;
	m: Float64Array;
	scale: number;
	center: [number, number, number];
	radius: number;
	casts: boolean;
}

export const CONE_MARGIN = 1e-3;
export const LEAST_DISTANCE = 1e-3;

/** A copy from a column-major 4 x 4 world matrix. */
export function copyOf(mesh: Mesh, kind: string, world: ArrayLike<number>, casts = true): Copy {
	const m = new Float64Array([
		world[0],
		world[4],
		world[8],
		world[12],
		world[1],
		world[5],
		world[9],
		world[13],
		world[2],
		world[6],
		world[10],
		world[14],
	]);
	const scale = Math.sqrt(
		Math.max(
			world[0] ** 2 + world[1] ** 2 + world[2] ** 2,
			world[4] ** 2 + world[5] ** 2 + world[6] ** 2,
			world[8] ** 2 + world[9] ** 2 + world[10] ** 2,
		),
	);
	const [x, y, z, r] = mesh.sphere;
	return { mesh, kind, m, scale, center: apply(m, x, y, z), radius: r * scale, casts };
}

export function apply(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
	return [
		m[0] * x + m[1] * y + m[2] * z + m[3],
		m[4] * x + m[5] * y + m[6] * z + m[7],
		m[8] * x + m[9] * y + m[10] * z + m[11],
	];
}

/** The planes of a view, each (nx, ny, nz, d) with dot(n, p) + d >= 0 inside. */
export type Planes = number[][];

function inside(planes: Planes, c: ArrayLike<number>, r: number): boolean {
	for (const p of planes) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
	return true;
}

/** A perspective camera view. */
export interface Camera extends View {
	eye: [number, number, number];
	planes: Planes;
	/** The level rule's factor: render height times P[1][1] over twice the threshold. */
	factor: number;
	forward: [number, number, number];
	right: [number, number, number];
	up: [number, number, number];
	fovY: number;
	aspect: number;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]) => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera at `eye` looking at `target`, with the world's up. */
export function camera(
	eye: number[],
	target: number[],
	o: {
		fovDegrees: number;
		near: number;
		far: number;
		width: number;
		height: number;
		threshold: number;
	},
): Camera {
	const f = norm(sub(target, eye));
	const r = norm(cross(f, [0, 1, 0]));
	const u = cross(r, f);
	const fovY = (o.fovDegrees * Math.PI) / 180;
	const p11 = 1 / Math.tan(fovY / 2);
	const aspect = o.width / o.height;
	const p00 = p11 / aspect;
	const view = new Float64Array([
		r[0],
		u[0],
		f[0],
		0,
		r[1],
		u[1],
		f[1],
		0,
		r[2],
		u[2],
		f[2],
		0,
		-dot(r, eye),
		-dot(u, eye),
		-dot(f, eye),
		1,
	]);
	// Side planes through the eye; near and far along the view.
	const planes: Planes = [];
	const side = (n: number[]) => {
		const nn = norm(n);
		planes.push([nn[0], nn[1], nn[2], -dot(nn, eye)]);
	};
	const tx = 1 / p00;
	const ty = 1 / p11;
	side(
		sub(
			f.map((v) => v * tx),
			r,
		).map((v) => v) as number[],
	);
	side(f.map((v, k) => v * tx + r[k]));
	side(f.map((v, k) => v * ty - u[k]));
	side(f.map((v, k) => v * ty + u[k]));
	planes.push([f[0], f[1], f[2], -dot(f, eye) - o.near]);
	planes.push([-f[0], -f[1], -f[2], dot(f, eye) + o.far]);
	return {
		view,
		p00,
		p11,
		near: o.near,
		width: o.width,
		height: o.height,
		eye: eye as [number, number, number],
		planes,
		factor: o.threshold > 0 ? (o.height * p11) / (2 * o.threshold) : 0,
		forward: f as [number, number, number],
		right: r as [number, number, number],
		up: u as [number, number, number],
		fovY,
		aspect,
	};
}

/** The level a copy draws at `distance` with the rule's `factor` and error distance, or -1 when it hides. */
function pick(copy: Copy, factor: number, distance: number, errorDistance: number): number {
	const { errors } = copy.mesh;
	let level = 0;
	if (factor > 0)
		while (level < errors.length && errors[level] * copy.scale * factor < errorDistance) level++;
	if (
		factor > 0 &&
		errors.length > 0 &&
		copy.radius > 0 &&
		2 * copy.radius * factor < errorDistance
	)
		return -1;
	void distance;
	return level;
}

/** The screen rectangle and nearest distance of a world sphere, by the culling shader's interval
 * arithmetic, or null for a sphere that reaches the camera's plane. */
function screenBounds(
	cam: Camera,
	c: ArrayLike<number>,
	r: number,
): [number, number, number, number, number] | null {
	const rel = [c[0] - cam.eye[0], c[1] - cam.eye[1], c[2] - cam.eye[2]];
	const vx = dot(rel, cam.right);
	const vy = dot(rel, cam.up);
	const vz = dot(rel, cam.forward);
	// Clip x = p00 vx, y = p11 vy, w = vz; each row moves by the radius times its length.
	const cx = cam.p00 * vx;
	const cy = cam.p11 * vy;
	const rx = r * cam.p00;
	const ry = r * cam.p11;
	const w0 = vz - r;
	const w1 = vz + r;
	if (w0 <= cam.near) return null;
	const q = (a0: number, a1: number) => {
		const v = [a0 / w0, a0 / w1, a1 / w0, a1 / w1];
		return [Math.min(...v), Math.max(...v)];
	};
	const [x0, x1] = q(cx - rx, cx + rx);
	const [y0, y1] = q(cy - ry, cy + ry);
	const W = cam.width;
	const H = cam.height;
	const clampX = (v: number) => Math.min(Math.max(v, 0), W);
	const clampY = (v: number) => Math.min(Math.max(v, 0), H);
	return [
		clampX((x0 * 0.5 + 0.5) * W),
		clampY((0.5 - y1 * 0.5) * H),
		clampX((x1 * 0.5 + 0.5) * W),
		clampY((0.5 - y0 * 0.5) * H),
		w0,
	];
}

function hidden(pyr: Pyramid, cam: Camera, c: ArrayLike<number>, r: number): boolean {
	const b = screenBounds(cam, c, r);
	if (!b) return false;
	return pyr.hides(b[0], b[1], b[2], b[3], b[4]);
}

/** True when a world sphere at `c` of radius `r` with a cone of world axis `axis` faces away from the eye. */
function facesAway(
	eye: ArrayLike<number>,
	c: ArrayLike<number>,
	r: number,
	axis: ArrayLike<number>,
	cutoff: number,
): boolean {
	if (cutoff >= 1) return false;
	const rel = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
	const reach = Math.hypot(axis[0], axis[1], axis[2]);
	if (reach <= 0) return false;
	return dot(rel, axis) / reach >= (cutoff + CONE_MARGIN) * Math.hypot(rel[0], rel[1], rel[2]) + r;
}

const scratchC = new Float64Array(3);
const scratchA = new Float64Array(3);
function worldSphere(m: Float64Array, b: ArrayLike<number>, o: number): void {
	const x = b[o];
	const y = b[o + 1];
	const z = b[o + 2];
	scratchC[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
	scratchC[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
	scratchC[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
}
function worldAxis(m: Float64Array, x: number, y: number, z: number): void {
	scratchA[0] = m[0] * x + m[1] * y + m[2] * z;
	scratchA[1] = m[4] * x + m[5] * y + m[6] * z;
	scratchA[2] = m[8] * x + m[9] * y + m[10] * z;
}

/** Triangles that each group test drops, in the order off screen, facing away, hidden, and the
 * group counts: tested, left after the first two tests, and hidden by each pyramid. */
export interface GroupFigures {
	offscreen: number;
	facing: number;
	hiddenFull: number;
	hiddenD40: number;
	tested: number;
	visible: number;
	hiddenGroupsFull: number;
	hiddenGroupsD40: number;
}

/** What one copy draws in the camera's view now and with groups at each size. */
export interface CameraCopy {
	copy: Copy;
	level: number;
	distance: number;
	/** Triangles of the chosen level, before pieces. */
	levelTriangles: number;
	/** Triangles drawn now, after pieces. */
	now: number;
	/** Pieces kept, as a mask over the level's pieces (or null for a level without pieces). */
	keptPieces: Uint8Array | null;
	/** Per group size: triangles dropped by off screen, facing away, hidden (full depth), hidden (D-40 occluders). */
	groups: Map<number, GroupFigures>;
	/** True when the copy's sphere lies behind the full pyramid, and behind the D-40 one. */
	copyHiddenFull: boolean;
	copyHiddenD40: boolean;
	/** Triangles in pieces that the pyramid hides (late-phase piece test today), full and D-40. */
	pieceHiddenFull: number;
	pieceHiddenD40: number;
	/** True when the copy draws depth among the occluders that D-40 picks. */
	occluder: boolean;
}

/** The camera pass of one view: the copies that draw, their levels and pieces. */
export function cameraCopies(copies: Copy[], cam: Camera): CameraCopy[] {
	const out: CameraCopy[] = [];
	const longer = Math.max(cam.width, cam.height);
	for (const copy of copies) {
		if (!inside(cam.planes, copy.center, copy.radius)) continue;
		const d = Math.max(
			Math.hypot(
				copy.center[0] - cam.eye[0],
				copy.center[1] - cam.eye[1],
				copy.center[2] - cam.eye[2],
			) - copy.radius,
			LEAST_DISTANCE,
		);
		const level = pick(copy, cam.factor, d, d);
		if (level < 0) continue;
		const lv = copy.mesh.levels[level];
		let now = lv.triangles;
		let keptPieces: Uint8Array | null = null;
		if (lv.pieces.length > 0) {
			keptPieces = new Uint8Array(lv.pieces.length);
			now = 0;
			lv.pieces.forEach((p, k) => {
				worldSphere(copy.m, p.sphere, 0);
				const r = p.sphere[3] * copy.scale;
				if (!inside(cam.planes, scratchC, r)) return;
				worldAxis(copy.m, p.cone[0], p.cone[1], p.cone[2]);
				if (facesAway(cam.eye, scratchC, r, scratchA, p.cone[3])) return;
				if (keptPieces) keptPieces[k] = 1;
				now += p.count;
			});
		}
		// D-40's occluders: a source whose bounds span at least a sixteenth of the render's longer
		// side, or that reaches the camera's plane.
		const b = screenBounds(cam, copy.center, copy.radius);
		const occluder = !b || Math.max(b[2] - b[0], b[3] - b[1]) >= longer / 16;
		out.push({
			copy,
			level,
			distance: d,
			levelTriangles: lv.triangles,
			now,
			keptPieces,
			groups: new Map(),
			copyHiddenFull: false,
			copyHiddenD40: false,
			pieceHiddenFull: 0,
			pieceHiddenD40: 0,
			occluder,
		});
	}
	return out;
}

/** Draws the depth of the copies that `which` keeps, with their kept pieces, into `depth`. */
export function drawCopies(
	depth: Depth,
	cam: Camera,
	list: CameraCopy[],
	which: (c: CameraCopy) => boolean,
): void {
	let verts = new Float64Array(0);
	for (const c of list) {
		if (!which(c) || c.now === 0) continue;
		const lv = c.copy.mesh.levels[c.level];
		const n = lv.positions.length / 3;
		if (verts.length < n * 3) verts = new Float64Array(n * 3);
		viewVertices(verts, cam, c.copy.m, lv.positions);
		if (c.keptPieces) {
			lv.pieces.forEach((p, k) => {
				if (c.keptPieces?.[k]) drawTriangles(depth, cam, verts, lv.indices, p.start, p.count, true);
			});
		} else drawTriangles(depth, cam, verts, lv.indices, 0, lv.triangles, true);
	}
}

/** Writes each stored position's view-space x, y and distance along the view. */
export function viewVertices(
	out: Float64Array,
	cam: Camera,
	m: Float64Array,
	positions: ArrayLike<number>,
): void {
	const v = cam.view;
	// Combined matrix: view times world.
	const rows = [0, 1, 2].map((r) => {
		const vr = [v[r], v[4 + r], v[8 + r], v[12 + r]];
		return [
			vr[0] * m[0] + vr[1] * m[4] + vr[2] * m[8],
			vr[0] * m[1] + vr[1] * m[5] + vr[2] * m[9],
			vr[0] * m[2] + vr[1] * m[6] + vr[2] * m[10],
			vr[0] * m[3] + vr[1] * m[7] + vr[2] * m[11] + vr[3],
		];
	});
	const [a, b, c] = rows;
	for (let i = 0, n = positions.length; i < n; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		out[i] = a[0] * x + a[1] * y + a[2] * z + a[3];
		out[i + 1] = b[0] * x + b[1] * y + b[2] * z + b[3];
		out[i + 2] = c[0] * x + c[1] * y + c[2] * z + c[3];
	}
}

/** Fills each copy's group figures, and its copy and piece occlusion, against the two pyramids. */
export function testGroups(
	list: CameraCopy[],
	cam: Camera,
	sizes: number[],
	full: Pyramid,
	d40: Pyramid,
): void {
	for (const c of list) {
		const { copy } = c;
		c.copyHiddenFull = hidden(full, cam, copy.center, copy.radius);
		c.copyHiddenD40 = hidden(d40, cam, copy.center, copy.radius);
		const lv = copy.mesh.levels[c.level];
		if (c.keptPieces)
			lv.pieces.forEach((p, k) => {
				if (!c.keptPieces![k]) return;
				worldSphere(copy.m, p.sphere, 0);
				const r = p.sphere[3] * copy.scale;
				if (hidden(full, cam, scratchC, r)) c.pieceHiddenFull += p.count;
				if (hidden(d40, cam, scratchC, r)) c.pieceHiddenD40 += p.count;
			});
		for (const size of sizes) {
			const g: Groups | null | undefined = copy.mesh.groups.get(size)?.[c.level];
			const f: GroupFigures = {
				offscreen: 0,
				facing: 0,
				hiddenFull: 0,
				hiddenD40: 0,
				tested: 0,
				visible: 0,
				hiddenGroupsFull: 0,
				hiddenGroupsD40: 0,
			};
			c.groups.set(size, f);
			if (!g) continue;
			const B = g.bounds;
			for (let i = 0; i < g.count; i++) {
				if (c.keptPieces && g.piece[i] >= 0 && !c.keptPieces[g.piece[i]]) continue;
				const t = g.triangles[i];
				f.tested++;
				worldSphere(copy.m, B, i * 8);
				const r = B[i * 8 + 3] * copy.scale;
				if (!inside(cam.planes, scratchC, r)) {
					f.offscreen += t;
					continue;
				}
				worldAxis(copy.m, B[i * 8 + 4], B[i * 8 + 5], B[i * 8 + 6]);
				if (facesAway(cam.eye, scratchC, r, scratchA, B[i * 8 + 7])) {
					f.facing += t;
					continue;
				}
				f.visible++;
				if (hidden(full, cam, scratchC, r)) {
					f.hiddenFull += t;
					f.hiddenGroupsFull++;
				}
				if (hidden(d40, cam, scratchC, r)) {
					f.hiddenD40 += t;
					f.hiddenGroupsD40++;
				}
			}
		}
	}
}

// --- Shadow cascades, as `null3d-render` `shadows.rs` `fit_cascades` places them ----------------------

export interface Cascade {
	/** Side planes, and the far face away from the light; the face toward the light is open. */
	planes: Planes;
	texel: number;
	radius: number;
}

export function splitDistances(near: number, end: number, count: number, lambda: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const share = (i + 1) / count;
		const even = near + (end - near) * share;
		const log = lambda > 0 ? near * (end / near) ** share : even;
		out.push(lambda * log + (1 - lambda) * even);
	}
	out[count - 1] = end;
	return out;
}

/** The cascades of the camera for a sun whose light travels along `direction`. */
export function cascades(
	cam: Camera,
	direction: number[],
	s: { count: number; mapSize: number; distance: number; blend: number },
): Cascade[] {
	const d = norm(direction);
	const z = d.map((v) => -v);
	const upW = Math.abs(z[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	const x = norm(cross(upW, z));
	const y = cross(z, x);
	const near = cam.near;
	const end = s.distance;
	const ends = splitDistances(near, end, s.count, 0.65);
	const tanY = Math.tan(cam.fovY / 2);
	const reach = Math.sqrt(1 + (tanY * cam.aspect) ** 2 + tanY ** 2);
	const out: Cascade[] = [];
	let start = near;
	let from = near;
	for (let k = 0; k < s.count; k++) {
		const e = ends[k];
		const band = k + 1 < s.count ? e - s.blend * (e - start) : e;
		const cx = tanY * cam.aspect * e;
		const cy = tanY * e;
		const k2 = (cx * cx + cy * cy) / (e * e);
		const along = Math.min(((e + from) * (1 + k2)) / 2, e);
		const radius = Math.sqrt((e - along) ** 2 + e * e * k2);
		const margin = Math.max(2 * radius, s.distance);
		const center = cam.eye.map((v, i) => v + along * cam.forward[i]);
		const C = [dot(center, x), dot(center, y), dot(center, z)];
		const planes: Planes = [
			[x[0], x[1], x[2], radius - C[0]],
			[-x[0], -x[1], -x[2], radius + C[0]],
			[y[0], y[1], y[2], radius - C[1]],
			[-y[0], -y[1], -y[2], radius + C[1]],
			[z[0], z[1], z[2], radius - C[2]],
		];
		void margin;
		out.push({ planes, texel: (2 * radius) / s.mapSize, radius });
		start = e;
		from = band / reach;
	}
	return out;
}

/** What one copy draws in a shadow cascade now, and with groups culled by the cascade's box. */
export interface ShadowCopy {
	copy: Copy;
	level: number;
	now: number;
	/** Per group size: triangles that the box's planes drop, and the groups tested. */
	offscreen: Map<number, number>;
	tested: Map<number, number>;
}

export function shadowCopies(
	copies: Copy[],
	c: Cascade,
	sizes: number[],
	threshold: number,
): ShadowCopy[] {
	const out: ShadowCopy[] = [];
	const factor = 1 / (c.texel * threshold);
	for (const copy of copies) {
		if (!copy.casts || !inside(c.planes, copy.center, copy.radius)) continue;
		const level = pick(copy, factor, 1, 1);
		if (level < 0) continue;
		const lv = copy.mesh.levels[level];
		const off = new Map<number, number>();
		const tested = new Map<number, number>();
		for (const size of sizes) {
			const g = copy.mesh.groups.get(size)?.[level];
			let drop = 0;
			tested.set(size, g?.count ?? 0);
			if (g) {
				const B = g.bounds;
				for (let i = 0; i < g.count; i++) {
					worldSphere(copy.m, B, i * 8);
					if (!inside(c.planes, scratchC, B[i * 8 + 3] * copy.scale)) drop += g.triangles[i];
				}
			}
			off.set(size, drop);
		}
		// The level's pieces, if cascades culled them by the box as the camera's view does: size 0.
		let pieceDrop = 0;
		for (const p of lv.pieces) {
			worldSphere(copy.m, p.sphere, 0);
			if (!inside(c.planes, scratchC, p.sphere[3] * copy.scale)) pieceDrop += p.count;
		}
		off.set(0, pieceDrop);
		out.push({ copy, level, now: lv.triangles, offscreen: off, tested });
	}
	return out;
}

/** The copies of each mesh, heaviest first: the largest chosen level, then the nearest. */
export function heaviest<T extends { copy: Copy; now: number }>(
	list: T[],
	k: number,
	weight: (t: T) => number,
): Set<T> {
	const byMesh = new Map<Mesh, T[]>();
	for (const t of list) {
		const l = byMesh.get(t.copy.mesh);
		if (l) l.push(t);
		else byMesh.set(t.copy.mesh, [t]);
	}
	const out = new Set<T>();
	for (const l of byMesh.values()) {
		l.sort((a, b) => weight(b) - weight(a));
		for (const t of l.slice(0, k)) out.add(t);
	}
	return out;
}

export { Depth, Pyramid };
