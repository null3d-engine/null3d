// A depth image of a view drawn on the CPU, and the depth pyramid that null3D's GPU occlusion
// builds from it: level 0 at half the render size each way, each texel the farthest depth of the
// 4 x 4 pixels around its own 2 x 2, and each later level the farthest of the texels under it.
// Depths are distances along the view, so the farthest depth is the largest value.

export interface View {
	/** The view matrix, column-major, world to view space. */
	view: Float64Array;
	/** The projection's x and y scales. */
	p00: number;
	p11: number;
	near: number;
	width: number;
	height: number;
}

export class Depth {
	readonly data: Float32Array;
	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.data = new Float32Array(width * height).fill(Infinity);
	}
}

// Scratch for one triangle's clipped polygon.
const poly = new Float64Array(4 * 3 * 2);
const clipped = new Float64Array(4 * 3 * 2);

/**
 * Draws the triangles `indices` of the vertices `verts` into `depth`: verts hold view-space x, y
 * and the distance along the view, three per vertex. Back faces, by counter-clockwise front faces,
 * draw nothing.
 */
export function drawTriangles(
	depth: Depth,
	v: View,
	verts: Float64Array,
	indices: Uint32Array,
	first: number,
	count: number,
	cullBack: boolean,
): void {
	const W = depth.width;
	const H = depth.height;
	const near = v.near;
	const end = (first + count) * 3;
	for (let t = first * 3; t < end; t += 3) {
		const a = indices[t] * 3;
		const b = indices[t + 1] * 3;
		const c = indices[t + 2] * 3;
		const za = verts[a + 2];
		const zb = verts[b + 2];
		const zc = verts[c + 2];
		if (za < near && zb < near && zc < near) continue;
		let n = 3;
		poly[0] = verts[a];
		poly[1] = verts[a + 1];
		poly[2] = za;
		poly[3] = verts[b];
		poly[4] = verts[b + 1];
		poly[5] = zb;
		poly[6] = verts[c];
		poly[7] = verts[c + 1];
		poly[8] = zc;
		let src = poly;
		if (za < near || zb < near || zc < near) {
			// Cuts the triangle at the near plane.
			let m = 0;
			for (let i = 0; i < 3; i++) {
				const j = (i + 1) % 3;
				const zi = poly[i * 3 + 2];
				const zj = poly[j * 3 + 2];
				const inI = zi >= near;
				const inJ = zj >= near;
				if (inI) {
					clipped[m * 3] = poly[i * 3];
					clipped[m * 3 + 1] = poly[i * 3 + 1];
					clipped[m * 3 + 2] = zi;
					m++;
				}
				if (inI !== inJ) {
					const s = (near - zi) / (zj - zi);
					clipped[m * 3] = poly[i * 3] + s * (poly[j * 3] - poly[i * 3]);
					clipped[m * 3 + 1] = poly[i * 3 + 1] + s * (poly[j * 3 + 1] - poly[i * 3 + 1]);
					clipped[m * 3 + 2] = near;
					m++;
				}
			}
			n = m;
			src = clipped;
		}
		// Screen positions and 1 / depth of the polygon's corners.
		for (let k = 1; k + 1 < n; k++) {
			fill(depth, v, src, 0, k, k + 1, W, H, cullBack);
		}
	}
}

function fill(
	depth: Depth,
	v: View,
	p: Float64Array,
	i0: number,
	i1: number,
	i2: number,
	W: number,
	H: number,
	cullBack: boolean,
): void {
	const z0 = p[i0 * 3 + 2];
	const z1 = p[i1 * 3 + 2];
	const z2 = p[i2 * 3 + 2];
	const x0 = (p[i0 * 3] / z0) * v.p00 * 0.5 * W + 0.5 * W;
	const y0 = 0.5 * H - (p[i0 * 3 + 1] / z0) * v.p11 * 0.5 * H;
	const x1 = (p[i1 * 3] / z1) * v.p00 * 0.5 * W + 0.5 * W;
	const y1 = 0.5 * H - (p[i1 * 3 + 1] / z1) * v.p11 * 0.5 * H;
	const x2 = (p[i2 * 3] / z2) * v.p00 * 0.5 * W + 0.5 * W;
	const y2 = 0.5 * H - (p[i2 * 3 + 1] / z2) * v.p11 * 0.5 * H;
	// Twice the signed area; with rows counting down, a counter-clockwise front face is negative.
	const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
	if (area === 0 || (cullBack && area > 0)) return;
	const minX = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5));
	const maxX = Math.min(W - 1, Math.floor(Math.max(x0, x1, x2) - 0.5));
	const minY = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5));
	const maxY = Math.min(H - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
	if (minX > maxX || minY > maxY) return;
	const inv = 1 / area;
	const w0 = 1 / z0;
	const w1 = 1 / z1;
	const w2 = 1 / z2;
	const data = depth.data;
	for (let y = minY; y <= maxY; y++) {
		const py = y + 0.5;
		for (let x = minX; x <= maxX; x++) {
			const px = x + 0.5;
			const e0 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * inv;
			const e1 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * inv;
			const e2 = 1 - e0 - e1;
			if (e0 < 0 || e1 < 0 || e2 < 0) continue;
			const d = 1 / (e0 * w0 + e1 * w1 + e2 * w2);
			const at = y * W + x;
			if (d < data[at]) data[at] = d;
		}
	}
}

/** The pyramid's levels: their sizes and texels, the farthest depth of each texel. */
export class Pyramid {
	readonly levels: { w: number; h: number; data: Float32Array }[] = [];
	constructor(depth: Depth) {
		const W = depth.width;
		const H = depth.height;
		let w = Math.ceil(W / 2);
		let h = Math.ceil(H / 2);
		const first = new Float32Array(w * h);
		for (let j = 0; j < h; j++)
			for (let i = 0; i < w; i++) {
				let far = 0;
				for (let y = Math.max(0, 2 * j - 1); y <= Math.min(H - 1, 2 * j + 2); y++)
					for (let x = Math.max(0, 2 * i - 1); x <= Math.min(W - 1, 2 * i + 2); x++)
						far = Math.max(far, depth.data[y * W + x]);
				first[j * w + i] = far;
			}
		this.levels.push({ w, h, data: first });
		while (w > 1 || h > 1) {
			const prev = this.levels[this.levels.length - 1];
			const nw = Math.ceil(prev.w / 2);
			const nh = Math.ceil(prev.h / 2);
			const data = new Float32Array(nw * nh);
			for (let j = 0; j < nh; j++)
				for (let i = 0; i < nw; i++) {
					let far = 0;
					const y1 = Math.min(prev.h - 1, 2 * j + 1);
					const x1 = Math.min(prev.w - 1, 2 * i + 1);
					for (let y = 2 * j; y <= y1; y++)
						for (let x = 2 * i; x <= x1; x++) far = Math.max(far, prev.data[y * prev.w + x]);
					data[j * nw + i] = far;
				}
			this.levels.push({ w: nw, h: nh, data });
			w = nw;
			h = nh;
		}
	}

	/**
	 * True when the screen rectangle from `lx, ly` to `hx, hy`, in pixels with rows from the top,
	 * lies wholly behind the pyramid's depth at the distance `nearest`, as the culling shader tests.
	 */
	hides(lx: number, ly: number, hx: number, hy: number, nearest: number): boolean {
		const span = Math.ceil(Math.max(hx - lx, hy - ly));
		let level = 0;
		if (span > 2) level = 31 - Math.clz32(span - 1);
		level = Math.min(level, this.levels.length - 1);
		const { w, h, data } = this.levels[level];
		const texel = 2 << level;
		const t0x = Math.min(Math.floor(lx / texel), w - 1);
		const t0y = Math.min(Math.floor(ly / texel), h - 1);
		const t1x = Math.min(Math.min(Math.floor(hx / texel), w - 1), t0x + 1);
		const t1y = Math.min(Math.min(Math.floor(hy / texel), h - 1), t0y + 1);
		const far = Math.max(
			data[t0y * w + t0x],
			data[t0y * w + t1x],
			data[t1y * w + t0x],
			data[t1y * w + t1x],
		);
		return nearest > far;
	}
}
