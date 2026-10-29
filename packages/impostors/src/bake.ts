// The bake: draws a mesh from every direction of an octahedral grid into the colour atlas and the
// surface atlas that the cards read. The work runs on the CPU, so one bake gives the same two
// atlases on WebGPU and on WebGL2, and a picture test can hold both paths to one reference. The
// colour atlas holds the unlit colour, which the card material lights, and the surface atlas holds
// each point's normal in the object's own frame, its depth and its coverage, which
// `encodeImpostorSurface` writes.
//
// The view of a cell looks from the cell's direction at the object's middle, with the world's up
// kept upright. A point's normal comes from the mesh's own normals, which already lie in the
// object's frame, so no turn of the view enters the stored surface. The card's turn turns that
// frame toward the camera at draw time.
//
// A cell's picture fills a square atlas cell. The card's quad is not square: its width holds the
// object's widest horizontal reach and its height the object's full height, and `size` gives both.
// The card stands on the object's lowest point.

import { frameDirection, type OctahedralAtlas } from './octahedral';
import { encodeImpostorSurface } from './surface';

/**
 * A map that a bake samples: its pixels, four bytes a texel in the first row first, and the cell
 * that a part draws.
 *
 * @category api/impostors
 */
export interface ImpostorBakeMap {
	/** Texels across. */
	readonly width: number;
	/** Rows down. The first row is the texture's row at v = 0. */
	readonly height: number;
	/** Four bytes a texel, the first row first. */
	readonly data: Uint8Array | Uint8ClampedArray;
	/** The cell that the part samples, counted from the top left. The default is (0, 0). */
	readonly cell?: readonly [number, number];
	/** The cells across and down. The default is one by one. */
	readonly cells?: readonly [number, number];
	/** How many times the map repeats over the part's texture coordinates. The default is 1. */
	readonly tiles?: number;
	/** How a place past the map reads: clamp by default, or repeat. */
	readonly wrap?: 'clamp' | 'repeat';
}

/**
 * One part that a bake draws: its mesh arrays and what colours its surface.
 *
 * @category api/impostors
 */
export interface ImpostorBakePart {
	/** The vertices' positions, three numbers each, in the object's frame. */
	readonly positions: ArrayLike<number>;
	/** The vertices' normals, three numbers each. They are made where the part leaves them out. */
	readonly normals?: ArrayLike<number>;
	/** The vertices' texture coordinates, two numbers each, where a map is drawn. */
	readonly uvs?: ArrayLike<number>;
	/**
	 * The vertices' colours, three or four numbers each, linear. A fourth number is the vertex's
	 * coverage.
	 */
	readonly colors?: ArrayLike<number>;
	/** The triangles' vertices, three each. */
	readonly indices: ArrayLike<number>;
	/** The colour map, in sRGB, that the part samples. Its alpha is not the coverage. */
	readonly color?: ImpostorBakeMap;
	/** The coverage map, linear: its blue holds the coverage. */
	readonly coverage?: ImpostorBakeMap;
	/** A linear colour that multiplies the part's own colour. The default is white. */
	readonly tint?: readonly [number, number, number];
	/** The coverage under which nothing draws. The default is 0.5. */
	readonly alphaCutoff?: number;
	/** True to draw both sides of the part's triangles and light the back ones. */
	readonly doubleSided?: boolean;
}

/**
 * What `bakeImpostorAtlas` takes: the grid, its cells' size, and the object.
 *
 * @category api/impostors
 */
export interface ImpostorBakeOptions {
	/** The cells across and down. A bake draws a view in every cell. */
	readonly atlas: OctahedralAtlas;
	/** The texels on each side of a cell, a whole number from 1. */
	readonly texels: number;
	/** The parts that the bake draws, in any order: the depth decides what shows. */
	readonly parts: readonly ImpostorBakePart[];
	/** The object's bounds in its own frame: the smallest corner. */
	readonly min: readonly [number, number, number];
	/** The object's bounds in its own frame: the largest corner. */
	readonly max: readonly [number, number, number];
}

/**
 * The two atlases that a bake writes: the colour in sRGB, with the coverage in alpha, and the
 * surface in linear colour, as `createImpostors` takes them.
 *
 * @category api/impostors
 */
export interface ImpostorBake {
	/** The grid that the bake drew. */
	readonly atlas: OctahedralAtlas;
	/** The colour atlas: its texels, and their grid. */
	readonly color: { width: number; height: number; data: Uint8Array };
	/** The surface atlas: its texels, and their grid. */
	readonly surface: { width: number; height: number; data: Uint8Array };
	/**
	 * The world size of one card's quad at scale 1: the width that holds the object's widest
	 * horizontal reach, and its height. The card stands on the object's lowest point.
	 */
	readonly size: readonly [number, number];
}

/** A part ready to draw: its arrays, its normals and its colour's stride. */
interface Work {
	positions: ArrayLike<number>;
	normals: Float32Array;
	uvs: ArrayLike<number> | undefined;
	colors: ArrayLike<number> | undefined;
	colorStride: number;
	indices: ArrayLike<number>;
	color: ImpostorBakeMap | undefined;
	coverage: ImpostorBakeMap | undefined;
	tint: readonly [number, number, number];
	alphaCutoff: number;
	doubleSided: boolean;
}

/** The longest side of the atlas, checked before the bake allocates it. */
const MAX_SIDE = 4096;

/** Scratch for one bake, so the loops allocate nothing. */
interface Scratch {
	readonly x: Float32Array;
	readonly y: Float32Array;
	readonly z: Float32Array;
	readonly sample: Uint8Array;
	readonly rgb: [number, number, number];
}

/**
 * Draws `parts` from every cell of `atlas` into the colour and surface atlases, which it returns.
 *
 * The bake is arithmetic over the arrays. It gives the same pixels on every device, so both GPU
 * paths draw one card.
 *
 * @param options The grid, the cells' size and the parts.
 * @returns The two atlases and the size of a card.
 * @category api/impostors
 */
export function bakeImpostorAtlas(options: ImpostorBakeOptions): ImpostorBake {
	const { atlas, texels, parts, min, max } = options;
	if (!(Number.isInteger(atlas.columns) && atlas.columns >= 1))
		throw new RangeError(
			`bakeImpostorAtlas() got ${atlas.columns} columns, not a whole number from 1.`,
		);
	if (!(Number.isInteger(atlas.rows) && atlas.rows >= 1))
		throw new RangeError(`bakeImpostorAtlas() got ${atlas.rows} rows, not a whole number from 1.`);
	if (!(Number.isInteger(texels) && texels >= 1))
		throw new RangeError(
			`bakeImpostorAtlas() got ${texels} texels a cell, not a whole number from 1.`,
		);
	if (parts.length === 0)
		throw new RangeError('bakeImpostorAtlas() got no parts. Give at least one.');
	for (let axis = 0; axis < 3; axis++)
		if (!((max[axis] as number) >= (min[axis] as number)))
			throw new RangeError(
				`bakeImpostorAtlas() got a max below the min on axis ${axis}. Give a max at or above the min.`,
			);
	if (!(max[1] > min[1]))
		throw new RangeError(
			'bakeImpostorAtlas() got bounds of no height. A card stands on the object, so give it a height.',
		);
	const width = atlas.columns * texels;
	const height = atlas.rows * texels;
	if (width > MAX_SIDE || height > MAX_SIDE)
		throw new RangeError(
			`bakeImpostorAtlas() would write a ${width} by ${height} atlas, past ${MAX_SIDE} texels a side.`,
		);
	const center: [number, number, number] = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	];
	// The widest horizontal reach of the bounds, which the card's width holds.
	let reach = 1e-6;
	for (const x of [min[0], max[0]])
		for (const z of [min[2], max[2]])
			reach = Math.max(reach, Math.hypot(x - center[0], z - center[2]));
	const objectHeight = max[1] - min[1];
	const works = parts.map((part) => work(part));
	const corners: [number, number, number][] = [];
	for (const x of [min[0], max[0]])
		for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
	const color = new Uint8Array(width * height * 4);
	const surface = new Uint8Array(width * height * 4);
	const depth = new Float32Array(width * height);
	const direction: [number, number, number] = [0, 0, 0];
	const right: [number, number, number] = [0, 0, 0];
	const up: [number, number, number] = [0, 0, 0];
	const scratch: Scratch = {
		x: new Float32Array(3),
		y: new Float32Array(3),
		z: new Float32Array(3),
		sample: new Uint8Array(4),
		rgb: [0, 0, 0],
	};
	for (let frame = 0; frame < atlas.columns * atlas.rows; frame++) {
		frameDirection(frame, atlas, direction);
		viewFrame(direction, right, up);
		// The depth of the object's nearest and farthest point along this view.
		let near = -Number.POSITIVE_INFINITY;
		let far = Number.POSITIVE_INFINITY;
		for (const corner of corners) {
			const at =
				(corner[0] - center[0]) * direction[0] +
				(corner[1] - center[1]) * direction[1] +
				(corner[2] - center[2]) * direction[2];
			if (at > near) near = at;
			if (at < far) far = at;
		}
		const span = Math.max(near - far, 1e-6);
		const left = (frame % atlas.columns) * texels;
		// The first cell is the top left, and the atlas's first row of texels is at v = 0.
		const bottom = (atlas.rows - 1 - Math.floor(frame / atlas.columns)) * texels;
		for (let row = 0; row < texels; row++)
			depth.fill(
				-Number.POSITIVE_INFINITY,
				(bottom + row) * width + left,
				(bottom + row) * width + left + texels,
			);
		const cell: Cell = {
			width,
			left,
			bottom,
			texels,
			center,
			reach,
			objectHeight,
			near,
			span,
		};
		for (const part of works)
			draw(part, cell, direction, right, up, depth, color, surface, scratch);
	}
	return {
		atlas,
		color: { width, height, data: color },
		surface: { width, height, data: surface },
		size: [2 * reach, objectHeight],
	};
}

/** The values that one cell's draw needs. */
interface Cell {
	width: number;
	left: number;
	bottom: number;
	texels: number;
	center: readonly [number, number, number];
	reach: number;
	objectHeight: number;
	near: number;
	span: number;
}

/** Makes a part's normals and reads its colour's stride. */
function work(part: ImpostorBakePart): Work {
	const vertices = part.positions.length / 3;
	const colorStride = part.colors === undefined ? 0 : part.colors.length === vertices * 4 ? 4 : 3;
	if (colorStride === 0 && part.color === undefined)
		throw new RangeError(
			'bakeImpostorAtlas() got a part with neither vertex colours nor a colour map. Give one.',
		);
	if ((part.color !== undefined || part.coverage !== undefined) && part.uvs === undefined)
		throw new RangeError(
			'bakeImpostorAtlas() got a part with a map but no texture coordinates. Give `uvs`.',
		);
	return {
		positions: part.positions,
		normals: part.normals
			? Float32Array.from(part.normals)
			: vertexNormals(part.positions, part.indices, vertices),
		uvs: part.uvs,
		colors: part.colors,
		colorStride,
		indices: part.indices,
		color: part.color,
		coverage: part.coverage,
		tint: part.tint ?? [1, 1, 1],
		alphaCutoff: part.alphaCutoff ?? 0.5,
		doubleSided: part.doubleSided ?? false,
	};
}

/** The area-weighted normal of each vertex, for a part that names none. */
function vertexNormals(
	positions: ArrayLike<number>,
	indices: ArrayLike<number>,
	vertices: number,
): Float32Array {
	const normals = new Float32Array(vertices * 3);
	for (let t = 0; t < indices.length; t += 3) {
		const a = (indices[t] as number) * 3;
		const b = (indices[t + 1] as number) * 3;
		const c = (indices[t + 2] as number) * 3;
		const abx = (positions[b] as number) - (positions[a] as number);
		const aby = (positions[b + 1] as number) - (positions[a + 1] as number);
		const abz = (positions[b + 2] as number) - (positions[a + 2] as number);
		const acx = (positions[c] as number) - (positions[a] as number);
		const acy = (positions[c + 1] as number) - (positions[a + 1] as number);
		const acz = (positions[c + 2] as number) - (positions[a + 2] as number);
		// The cross product's length weighs the two triangles that share the edge alike.
		const nx = aby * acz - abz * acy;
		const ny = abz * acx - abx * acz;
		const nz = abx * acy - aby * acx;
		for (const v of [a, b, c]) {
			normals[v] = (normals[v] as number) + nx;
			normals[v + 1] = (normals[v + 1] as number) + ny;
			normals[v + 2] = (normals[v + 2] as number) + nz;
		}
	}
	return normals;
}

/** The view's right and up for a direction toward the eye, with the world's up kept upright. */
function viewFrame(
	direction: readonly [number, number, number],
	right: [number, number, number],
	up: [number, number, number],
): void {
	// The world's up less its part along the view, so the picture keeps the world upright.
	let ux = -direction[1] * direction[0];
	let uy = 1 - direction[1] * direction[1];
	let uz = -direction[1] * direction[2];
	let length = Math.hypot(ux, uy, uz);
	if (length < 1e-4) {
		// A view straight up or down has no upright part; its picture turns to the world's forward.
		ux = 1 - direction[0] * direction[0];
		uy = -direction[0] * direction[1];
		uz = -direction[0] * direction[2];
		length = Math.hypot(ux, uy, uz) || 1;
	}
	up[0] = ux / length;
	up[1] = uy / length;
	up[2] = uz / length;
	// right = up x direction, so the picture's x runs to the right as an eye looking opposite the
	// direction sees it.
	right[0] = up[1] * direction[2] - up[2] * direction[1];
	right[1] = up[2] * direction[0] - up[0] * direction[2];
	right[2] = up[0] * direction[1] - up[1] * direction[0];
}

/** Draws one part into a cell, through the depth buffer. */
function draw(
	part: Work,
	cell: Cell,
	direction: readonly [number, number, number],
	right: readonly [number, number, number],
	up: readonly [number, number, number],
	depth: Float32Array,
	color: Uint8Array,
	surface: Uint8Array,
	scratch: Scratch,
): void {
	const { positions, normals, uvs, colors, colorStride, indices } = part;
	const [tintR, tintG, tintB] = part.tint;
	const { x: sx, y: sy, z: sz } = scratch;
	const sample = scratch.sample;
	const rgb = scratch.rgb;
	for (let t = 0; t < indices.length; t += 3) {
		const ia = indices[t] as number;
		const ib = indices[t + 1] as number;
		const ic = indices[t + 2] as number;
		for (let k = 0; k < 3; k++) {
			const index = k === 0 ? ia : k === 1 ? ib : ic;
			const px = (positions[index * 3] as number) - cell.center[0];
			const py = (positions[index * 3 + 1] as number) - cell.center[1];
			const pz = (positions[index * 3 + 2] as number) - cell.center[2];
			sx[k] = (px * right[0] + py * right[1] + pz * right[2]) / cell.reach;
			sy[k] = (px * up[0] + py * up[1] + pz * up[2]) / cell.objectHeight + 0.5;
			sz[k] = px * direction[0] + py * direction[1] + pz * direction[2];
		}
		const area =
			((sx[1] as number) - (sx[0] as number)) * ((sy[2] as number) - (sy[0] as number)) -
			((sx[2] as number) - (sx[0] as number)) * ((sy[1] as number) - (sy[0] as number));
		if (area === 0) continue;
		// The eye looks along the opposite of the direction, so a triangle that faces it has a
		// positive area. A part that draws both sides draws the rest. A surface keeps the mesh's own
		// normal on both sides, as the engine's materials do.
		const back = area < 0;
		if (back && !part.doubleSided) continue;
		const minX = Math.max(
			cell.left,
			cell.left +
				Math.floor(
					(Math.min(sx[0] as number, sx[1] as number, sx[2] as number) * 0.5 + 0.5) * cell.texels,
				),
		);
		const maxX = Math.min(
			cell.left + cell.texels - 1,
			cell.left +
				Math.ceil(
					(Math.max(sx[0] as number, sx[1] as number, sx[2] as number) * 0.5 + 0.5) * cell.texels,
				),
		);
		const minY = Math.max(
			cell.bottom,
			cell.bottom +
				Math.floor(Math.min(sy[0] as number, sy[1] as number, sy[2] as number) * cell.texels),
		);
		const maxY = Math.min(
			cell.bottom + cell.texels - 1,
			cell.bottom +
				Math.ceil(Math.max(sy[0] as number, sy[1] as number, sy[2] as number) * cell.texels),
		);
		if (maxX < minX || maxY < minY) continue;
		for (let y = minY; y <= maxY; y++) {
			const py = (y - cell.bottom + 0.5) / cell.texels;
			for (let x = minX; x <= maxX; x++) {
				const px = ((x - cell.left + 0.5) / cell.texels) * 2 - 1;
				// A back-facing triangle has the edge functions' signs turned, so turn them back and
				// test the same way. A point on an edge counts as inside, which closes the seams
				// between neighbouring triangles.
				const side = area < 0 ? -1 : 1;
				const b0 =
					(((sx[2] as number) - (sx[1] as number)) * (py - (sy[1] as number)) -
						((sy[2] as number) - (sy[1] as number)) * (px - (sx[1] as number))) *
					side;
				const b1 =
					(((sx[0] as number) - (sx[2] as number)) * (py - (sy[2] as number)) -
						((sy[0] as number) - (sy[2] as number)) * (px - (sx[2] as number))) *
					side;
				const b2 =
					(((sx[1] as number) - (sx[0] as number)) * (py - (sy[0] as number)) -
						((sy[1] as number) - (sy[0] as number)) * (px - (sx[0] as number))) *
					side;
				if (b0 < 0 || b1 < 0 || b2 < 0) continue;
				const sum = b0 + b1 + b2;
				if (sum === 0) continue;
				const w0 = b0 / sum;
				const w1 = b1 / sum;
				const w2 = b2 / sum;
				const z = (sz[0] as number) * w0 + (sz[1] as number) * w1 + (sz[2] as number) * w2;
				const at = y * cell.width + x;
				if (!(z > (depth[at] as number))) continue;
				// The point's normal in the object's frame, as the mesh's own normals give it.
				let nr =
					(normals[ia * 3] as number) * w0 +
					(normals[ib * 3] as number) * w1 +
					(normals[ic * 3] as number) * w2;
				let ng =
					(normals[ia * 3 + 1] as number) * w0 +
					(normals[ib * 3 + 1] as number) * w1 +
					(normals[ic * 3 + 1] as number) * w2;
				let nb =
					(normals[ia * 3 + 2] as number) * w0 +
					(normals[ib * 3 + 2] as number) * w1 +
					(normals[ic * 3 + 2] as number) * w2;
				const length = Math.hypot(nr, ng, nb) || 1;
				nr /= length;
				ng /= length;
				nb /= length;
				// The part's own colour: its vertex colours, its colour map, and the tint.
				let r = 1;
				let g = 1;
				let b = 1;
				let coverage = 1;
				if (colorStride > 0 && colors !== undefined) {
					r =
						(colors[ia * colorStride] as number) * w0 +
						(colors[ib * colorStride] as number) * w1 +
						(colors[ic * colorStride] as number) * w2;
					g =
						(colors[ia * colorStride + 1] as number) * w0 +
						(colors[ib * colorStride + 1] as number) * w1 +
						(colors[ic * colorStride + 1] as number) * w2;
					b =
						(colors[ia * colorStride + 2] as number) * w0 +
						(colors[ib * colorStride + 2] as number) * w1 +
						(colors[ic * colorStride + 2] as number) * w2;
					if (colorStride === 4)
						coverage =
							(colors[ia * 4 + 3] as number) * w0 +
							(colors[ib * 4 + 3] as number) * w1 +
							(colors[ic * 4 + 3] as number) * w2;
				}
				if (part.color !== undefined && uvs !== undefined) {
					const u =
						(uvs[ia * 2] as number) * w0 +
						(uvs[ib * 2] as number) * w1 +
						(uvs[ic * 2] as number) * w2;
					const v =
						(uvs[ia * 2 + 1] as number) * w0 +
						(uvs[ib * 2 + 1] as number) * w1 +
						(uvs[ic * 2 + 1] as number) * w2;
					sampleMapColor(part.color, u, v, rgb);
					r *= rgb[0];
					g *= rgb[1];
					b *= rgb[2];
					if (part.coverage !== undefined) coverage = sampleMapBlue(part.coverage, u, v);
				}
				if (coverage < part.alphaCutoff) continue;
				depth[at] = z;
				// The colour is stored in sRGB; the tint is linear, so multiply it there.
				const t4 = at * 4;
				color[t4] = linearToSrgb(r * tintR);
				color[t4 + 1] = linearToSrgb(g * tintG);
				color[t4 + 2] = linearToSrgb(b * tintB);
				color[t4 + 3] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
				// The depth runs from 0 at the view's front, the largest z, to 1 at its back.
				encodeImpostorSurface(
					[nr, ng, nb],
					Math.max(0, Math.min(1, (cell.near - z) / cell.span)),
					coverage,
					sample,
				);
				surface[t4] = sample[0] as number;
				surface[t4 + 1] = sample[1] as number;
				surface[t4 + 2] = sample[2] as number;
				surface[t4 + 3] = sample[3] as number;
			}
		}
	}
}

/** The place in a map that a texture coordinate names, as a texel coordinate. */
function mapPlace(map: ImpostorBakeMap, u: number, v: number): [number, number] {
	const cells = map.cells;
	const cell = map.cell;
	let x: number;
	let y: number;
	if (cells === undefined && map.tiles !== undefined) {
		x = u * map.tiles;
		y = v * map.tiles;
	} else {
		const columns = cells?.[0] ?? 1;
		const rows = cells?.[1] ?? 1;
		x = ((cell?.[0] ?? 0) + Math.max(0, Math.min(1, u))) / columns;
		y = ((cell?.[1] ?? 0) + Math.max(0, Math.min(1, v))) / rows;
	}
	const wrap = map.wrap ?? 'clamp';
	x = wrap === 'repeat' ? x - Math.floor(x) : Math.max(0, Math.min(1, x));
	y = wrap === 'repeat' ? y - Math.floor(y) : Math.max(0, Math.min(1, y));
	return [x * map.width - 0.5, y * map.height - 0.5];
}

/** One texel of a map at a whole coordinate, wrapped or clamped. */
function mapTexel(map: ImpostorBakeMap, x: number, y: number): number {
	const wrap = map.wrap ?? 'clamp';
	let tx: number;
	let ty: number;
	if (wrap === 'repeat') {
		tx = ((x % map.width) + map.width) % map.width;
		ty = ((y % map.height) + map.height) % map.height;
	} else {
		tx = Math.max(0, Math.min(map.width - 1, x));
		ty = Math.max(0, Math.min(map.height - 1, y));
	}
	return (ty * map.width + tx) * 4;
}

/** Samples a colour map's sRGB texels, turns them linear and filters them, into `out`. */
function sampleMapColor(
	map: ImpostorBakeMap,
	u: number,
	v: number,
	out: [number, number, number],
): void {
	const [gx, gy] = mapPlace(map, u, v);
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const fx = gx - x0;
	const fy = gy - y0;
	const a = mapTexel(map, x0, y0);
	const b = mapTexel(map, x0 + 1, y0);
	const c = mapTexel(map, x0, y0 + 1);
	const d = mapTexel(map, x0 + 1, y0 + 1);
	for (let channel = 0; channel < 3; channel++) {
		const r0 = srgbToLinear((map.data[a + channel] as number) / 255);
		const r1 = srgbToLinear((map.data[b + channel] as number) / 255);
		const r2 = srgbToLinear((map.data[c + channel] as number) / 255);
		const r3 = srgbToLinear((map.data[d + channel] as number) / 255);
		out[channel] = (r0 * (1 - fx) + r1 * fx) * (1 - fy) + (r2 * (1 - fx) + r3 * fx) * fy;
	}
}

/** Samples a linear map's blue channel at a texture coordinate, from 0 to 1. */
function sampleMapBlue(map: ImpostorBakeMap, u: number, v: number): number {
	const [gx, gy] = mapPlace(map, u, v);
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const fx = gx - x0;
	const fy = gy - y0;
	const a = mapTexel(map, x0, y0) + 2;
	const b = mapTexel(map, x0 + 1, y0) + 2;
	const c = mapTexel(map, x0, y0 + 1) + 2;
	const d = mapTexel(map, x0 + 1, y0 + 1) + 2;
	const r0 = (map.data[a] as number) / 255;
	const r1 = (map.data[b] as number) / 255;
	const r2 = (map.data[c] as number) / 255;
	const r3 = (map.data[d] as number) / 255;
	return (r0 * (1 - fx) + r1 * fx) * (1 - fy) + (r2 * (1 - fx) + r3 * fx) * fy;
}

/** A number from a byte that a map stores as sRGB, as a linear value. */
function srgbToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** A linear value as an sRGB byte's share. */
function linearToSrgb(value: number): number {
	const v = Math.max(0, Math.min(1, value));
	return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
}
