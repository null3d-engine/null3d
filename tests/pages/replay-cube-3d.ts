// Replays one hand-written draw list of cube, 3D and high dynamic range textures through the
// engine's backend for the GPU path that ?gpu= names: core WebGPU (webgpu), WebGPU in compatibility
// mode (compat) or WebGL2 (webgl2). The list fills cubes in 16-bit floats, in rgb9e5ufloat and in
// rg11b10ufloat, and 3D textures in 8-bit color, 16-bit floats and rgb9e5ufloat, by writes of
// every face or slice at once. It also uploads an image into a face, copies a face into another
// face, a 2D layer into a face and into a depth slice, and draws into the faces of two mip levels.
// It then draws a grid of 8 x 5 cells into the canvas's stand-in. Each cell reads one face, slice
// or layer at a chosen mip level, which may lie between two levels, with a nearest or a linear
// filter. The high dynamic range textures hold four times the colors that the cells show.
//
// One cell reads a 32-bit float texture with a linear filter where the device offers that filter.
// GPUs differ there, so the page reads the cell's pixels, reports whether they were filtered, and
// paints the cell over before it publishes the image. Every path must draw the same image.
import {
	type GlslTemplate,
	loadGlslShaders,
	loadWgslShaders,
	type RenderTemplate,
	readbackWebGL2,
	readbackWebGPU,
	SHADERS,
	WebGL2Backend,
	WebGPUBackend,
} from '@null3d/engine/internal';
import * as G from '../../packages/engine/src/generated/gpu';
import { TestMemory } from './lib/drawlist';
import { run, toBase64 } from './lib/result';

const CELL = 40;
const COLUMNS = 8;
const ROWS = 5;
const WIDTH = COLUMNS * CELL;
const HEIGHT = ROWS * CELL;
/** Bytes from one draw's parameters to the next: the dynamic offset alignment. */
const PARAMS_STRIDE = 256;
/** Bytes of one draw's parameters, the test shader's `Params`. */
const PARAMS_BYTES = 64;
/** The colors of the high dynamic range textures, over the colors that their cells show. */
const HDR = 4;
/** The face size of every cube, and the width, height and depth of every 3D texture. */
const SIZE = 4;
/** The cell that reads a 32-bit float texture with a linear filter. */
const PROBE_CELL = [7, 4] as const;

type Tier = 'webgpu' | 'compat' | 'webgl2';
const requested = new URLSearchParams(location.search).get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';

// The page's own bind group layouts and templates, with ids that the engine's do not use.
const LAYOUT_PARAMS = 100;
const LAYOUT_CUBE = 101;
const LAYOUT_VOLUME = 102;
const LAYOUT_LAYERS = 103;
const TEMPLATE_SAMPLE = 100;
const TEMPLATE_FACE = 101;

/** What a quad of the test shader shows: its SHOW_ values. */
const SHOW = { color: 0, face: 1, slice: 2, layer: 3 } as const;

const PARAMS_BUFFER = 1;
const TEXTURE = {
	/** 16-bit floats, written, with three mip levels. */
	cube: 1,
	/** rgb9e5ufloat, written, with three mip levels. */
	cubePacked: 2,
	/** 16-bit floats: written, then an image, two copies and two draws replace parts of it. */
	cubeMixed: 3,
	/** rg11b10ufloat, written, with two mip levels. */
	cubeSmall: 4,
	/** 8-bit color with two mip levels: three slices written, one copied. */
	volume: 5,
	volumeHalf: 6,
	volumePacked: 7,
	/** 2D arrays of one layer in each high dynamic range format, and in 8-bit color. */
	layersHalf: 8,
	layersPacked: 9,
	layersSmall: 10,
	layers8: 11,
	/** Two texels of 32-bit floats, for the filter probe. */
	probe: 12,
	// Views of one face of one mip level, to draw into.
	faceLevel0: 20,
	faceLevel1: 21,
} as const;
const SAMPLER = { nearest: 1, linear: 2 } as const;
const GROUP = {
	params: 1,
	cube: 2,
	cubePacked: 3,
	cubeMixed: 4,
	cubeSmall: 5,
	volumeNearest: 6,
	volumeLinear: 7,
	volumeHalf: 8,
	volumePacked: 9,
	layersHalf: 10,
	layersPacked: 11,
	layersSmall: 12,
	layers8: 13,
	probe: 14,
} as const;
const PIPELINE = { face: 1, sample: 2 } as const;
const IMAGE = 1;

type Color = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

/** One quad of the test shader. */
interface Quad {
	show?: number;
	face?: number;
	lod?: number;
	scale?: number;
	/** The quad's corners in its viewport, from the top-left: left, top, right, bottom. */
	rect?: readonly [number, number, number, number];
	color?: Color;
	slice?: number;
	layer?: number;
}

/** Every draw's parameters, one block per 256 bytes, which draws pick by dynamic offset. */
class Quads {
	private readonly buffer = new ArrayBuffer(64 * PARAMS_STRIDE);
	private readonly u32 = new Uint32Array(this.buffer);
	private readonly f32 = new Float32Array(this.buffer);
	private count = 0;

	/** Adds a quad and returns the byte offset of its parameters. */
	add(quad: Quad): number {
		const offset = this.count++ * PARAMS_STRIDE;
		const at = offset / 4;
		this.u32[at] = quad.show ?? SHOW.color;
		this.u32[at + 1] = quad.face ?? 0;
		this.f32[at + 2] = quad.lod ?? 0;
		this.f32[at + 3] = quad.scale ?? 1;
		this.f32.set(quad.rect ?? [0, 0, 1, 1], at + 4);
		this.f32.set(quad.color ?? [1, 0, 1, 1], at + 8);
		this.f32[at + 12] = quad.slice ?? 0;
		this.u32[at + 13] = quad.layer ?? 0;
		return offset;
	}

	get bytes(): Uint8Array {
		return new Uint8Array(this.buffer, 0, this.count * PARAMS_STRIDE);
	}
}

const floatBits = new Float32Array(1);
const floatWord = new Uint32Array(floatBits.buffer);

/** A 16-bit float's bits, rounded to the nearest. Values below 2^-14 become 0. */
function toHalf(value: number): number {
	floatBits[0] = value;
	const bits = floatWord[0] as number;
	const sign = (bits >>> 16) & 0x8000;
	const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
	const mantissa = bits & 0x7fffff;
	if (exponent <= 0) return sign;
	if (exponent >= 31) return sign | 0x7c00;
	let half = sign | (exponent << 10) | (mantissa >>> 13);
	const rest = mantissa & 0x1fff;
	if (rest > 0x1000 || (rest === 0x1000 && half & 1)) half++;
	return half;
}

/** An rgb9e5ufloat texel, by the rule of `EXT_texture_shared_exponent`. */
function toRgb9e5([r, g, b]: Rgb): number {
	const BIAS = 15;
	const BITS = 9;
	const largest = Math.max(r, g, b);
	let exponent = Math.max(-BIAS - 1, Math.floor(Math.log2(largest))) + 1 + BIAS;
	if (Math.floor(largest / 2 ** (exponent - BIAS - BITS) + 0.5) === 2 ** BITS) exponent++;
	const step = 2 ** (exponent - BIAS - BITS);
	const [rs, gs, bs] = [r, g, b].map((c) => Math.floor(c / step + 0.5)) as [number, number, number];
	return (rs | (gs << 9) | (bs << 18) | (exponent << 27)) >>> 0;
}

/** An rg11b10ufloat texel: the top bits of each channel's 16-bit float. */
function toRg11b10([r, g, b]: Rgb): number {
	const eleven = (c: number) => (toHalf(c) >>> 4) & 0x7ff;
	const ten = (c: number) => (toHalf(c) >>> 5) & 0x3ff;
	return (eleven(r) | (eleven(g) << 11) | (ten(b) << 22)) >>> 0;
}

/** The texels of `count` colors in a texture format, as the draw list's writes read them. */
function encode(format: number, colors: readonly Rgb[]): ArrayBufferView {
	switch (format) {
		case G.FORMAT_RGBA16_FLOAT:
			return Uint16Array.from(colors.flatMap(([r, g, b]) => [r, g, b, 1].map(toHalf)));
		case G.FORMAT_RGB9E5_UFLOAT:
			return Uint32Array.from(colors.map(toRgb9e5));
		case G.FORMAT_RG11B10_UFLOAT:
			return Uint32Array.from(colors.map(toRg11b10));
		case G.FORMAT_RGBA8_UNORM:
			return Uint8Array.from(
				colors.flatMap(([r, g, b]) => [r, g, b, 1].map((c) => Math.round(c * 255))),
			);
		default:
			throw new Error(`the page encodes no format ${format}`);
	}
}

/** Each face's hue: +X red, -X cyan, +Y green, -Y magenta, +Z blue, -Z yellow. */
const FACE_HUES: readonly Rgb[] = [
	[0.9, 0.2, 0.2],
	[0.2, 0.8, 0.8],
	[0.25, 0.85, 0.25],
	[0.85, 0.25, 0.85],
	[0.25, 0.35, 0.95],
	[0.9, 0.85, 0.2],
];

/**
 * The texels of a cube face's mip level, by level: the hue brightens to the right and whitens
 * downward, with a black texel at the top-left of level 0. Level 1 checks the hue against white,
 * and level 2 is one darker texel.
 */
function faceTexels(face: number, level: number, scale: number): Rgb[] {
	const hue = FACE_HUES[face] as Rgb;
	const side = SIZE >> level;
	const out: Rgb[] = [];
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			let color: Rgb;
			if (level === 0) {
				const bright = 0.45 + (0.55 * x) / (side - 1);
				const white = 0.12 * y;
				color =
					x === 0 && y === 0
						? [0, 0, 0]
						: (hue.map((c) => c * bright * (1 - white) + white) as unknown as Rgb);
			} else if (level === 1) {
				color = (x ^ y) & 1 ? [0.9, 0.9, 0.9] : (hue.map((c) => c * 0.5) as unknown as Rgb);
			} else {
				color = hue.map((c) => c * 0.3 + 0.1) as unknown as Rgb;
			}
			out.push(color.map((c) => c * scale) as unknown as Rgb);
		}
	return out;
}

/** The texels of every face of a cube's mip level, face after face. */
function cubeTexels(level: number, scale: number): Rgb[] {
	return [0, 1, 2, 3, 4, 5].flatMap((face) => faceTexels(face, level, scale));
}

/**
 * The texels of slices of a 3D texture's mip level, slice after slice: an identity color lookup
 * table at level 0, whose red, green and blue follow x, y and z, and its inverse in red and green
 * at level 1.
 */
function volumeTexels(level: number, slices: number, scale: number): Rgb[] {
	const side = SIZE >> level;
	const out: Rgb[] = [];
	for (let z = 0; z < slices; z++)
		for (let y = 0; y < side; y++)
			for (let x = 0; x < side; x++) {
				const [r, g, b] = [x, y, z].map((c) => c / (side - 1)) as [number, number, number];
				const color: Rgb = level === 0 ? [r, g, b] : [1 - r, 1 - g, b];
				out.push(color.map((c) => c * scale) as unknown as Rgb);
			}
	return out;
}

/** A 4 x 4 layer: two hues in a checker of 2 x 2 squares, or a ramp at level 1. */
function layerTexels(level: number, a: Rgb, b: Rgb, scale: number): Rgb[] {
	const side = SIZE >> level;
	const out: Rgb[] = [];
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			const color = level === 0 ? (((x >> 1) ^ (y >> 1)) & 1 ? a : b) : x ? a : b;
			out.push(color.map((c) => c * scale) as unknown as Rgb);
		}
	return out;
}

/** The image to upload into a face: four 2 x 2 quadrants, red, green, blue and white from the top-left. */
function imagePixels(): ImageData {
	const colors: Color[] = [
		[255, 0, 0, 255],
		[0, 255, 0, 255],
		[0, 0, 255, 255],
		[255, 255, 255, 255],
	];
	const data = new Uint8ClampedArray(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++)
			data.set(colors[(y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)] as Color, (y * SIZE + x) * 4);
	return new ImageData(data, SIZE, SIZE);
}

/** The draw list, and the engine memory that its writes read from. */
function drawList(probe: boolean): TestMemory {
	const memory = new TestMemory(1 << 20, 4096);
	const quads = new Quads();

	// Quads that draw into two faces of the mixed cube: the top half of each face.
	const faceTop = quads.add({ rect: [0, 0, 1, 0.5], color: [1, 0.6, 0, 1] });
	const faceTopSmall = quads.add({ rect: [0, 0, 1, 0.5], color: [0.1, 0.9, 0.3, 1] });
	const quarter = 1 / HDR;
	const face = (f: number, lod: number, scale = 1) =>
		quads.add({ show: SHOW.face, face: f, lod, scale });
	const slice = (at: number, lod: number, scale = 1) =>
		quads.add({ show: SHOW.slice, slice: at, lod, scale });
	const layer = (lod: number, scale = 1) => quads.add({ show: SHOW.layer, lod, scale });
	// Each cell: its column and row, its bind group of groups 1 to 3, and its quad.
	type Cell = [column: number, row: number, group: number, params: number];
	const cells: Cell[] = [];
	const row = (index: number, entries: [group: number, params: number][]) =>
		entries.forEach(([group, params], column) => {
			cells.push([column, index, group, params]);
		});
	// Nearest texels of every face, then the faces' smaller levels.
	row(0, [
		...[0, 1, 2, 3, 4, 5].map((f) => [GROUP.cube, face(f, 0)] as [number, number]),
		[GROUP.cube, face(0, 1)],
		[GROUP.cube, face(0, 2)],
	]);
	// Filtered faces of rgb9e5ufloat, which blend across the edges between faces, then reads
	// between two levels.
	row(1, [
		...[0, 1, 2, 3, 4, 5].map((f) => [GROUP.cubePacked, face(f, 0, quarter)] as [number, number]),
		[GROUP.cubePacked, face(2, 0.5, quarter)],
		[GROUP.cubePacked, face(2, 1.5, quarter)],
	]);
	// The mixed cube's faces: the image, the copied face, the drawn level 0, the drawn level 1,
	// the copied layer and the written face. Then rg11b10ufloat, filtered.
	row(2, [
		[GROUP.cubeMixed, face(0, 0)],
		[GROUP.cubeMixed, face(1, 0)],
		[GROUP.cubeMixed, face(2, 0)],
		[GROUP.cubeMixed, face(3, 1)],
		[GROUP.cubeMixed, face(4, 0)],
		[GROUP.cubeMixed, face(5, 0)],
		[GROUP.cubeSmall, face(0, 0, quarter)],
		[GROUP.cubeSmall, face(4, 0.5, quarter)],
	]);
	// Four slices of the 8-bit table, the last one copied; a slice of its level 1; a read halfway
	// between two slices; then 16-bit floats and rgb9e5ufloat between slices.
	row(3, [
		[GROUP.volumeNearest, slice(0.125, 0)],
		[GROUP.volumeNearest, slice(0.375, 0)],
		[GROUP.volumeNearest, slice(0.625, 0)],
		[GROUP.volumeNearest, slice(0.875, 0)],
		[GROUP.volumeNearest, slice(0.25, 1)],
		[GROUP.volumeLinear, slice(0.25, 0)],
		[GROUP.volumeHalf, slice(0.5, 0, quarter)],
		[GROUP.volumePacked, slice(0.5, 0, quarter)],
	]);
	// Filtered layers of each format, a level of the 16-bit layer, and two more cube levels.
	row(4, [
		[GROUP.layersHalf, layer(0)],
		[GROUP.layersHalf, layer(1)],
		[GROUP.layersPacked, layer(0, quarter)],
		[GROUP.layersSmall, layer(0, quarter)],
		[GROUP.layers8, layer(0)],
		[GROUP.cubeSmall, face(5, 1, quarter)],
		[GROUP.cubePacked, face(0, 2, quarter)],
	]);
	const probeQuad = layer(0);

	const red: Rgb = [0.9, 0.3, 0.2];
	const blue: Rgb = [0.2, 0.4, 0.9];
	const green: Rgb = [0.3, 0.8, 0.3];
	const violet: Rgb = [0.6, 0.3, 0.8];
	const put = (format: number, colors: Rgb[]) => memory.put(encode(format, colors));
	const data = {
		cube: [0, 1, 2].map((level) => put(G.FORMAT_RGBA16_FLOAT, cubeTexels(level, 1))),
		cubePacked: [0, 1, 2].map((level) => put(G.FORMAT_RGB9E5_UFLOAT, cubeTexels(level, HDR))),
		cubeMixed: [0, 1].map((level) => put(G.FORMAT_RGBA16_FLOAT, cubeTexels(level, 1))),
		cubeSmall: [0, 1].map((level) => put(G.FORMAT_RG11B10_UFLOAT, cubeTexels(level, HDR))),
		volume: put(G.FORMAT_RGBA8_UNORM, volumeTexels(0, 3, 1)),
		volumeLevel1: put(G.FORMAT_RGBA8_UNORM, volumeTexels(1, 2, 1)),
		volumeHalf: put(G.FORMAT_RGBA16_FLOAT, volumeTexels(0, SIZE, HDR)),
		volumePacked: put(G.FORMAT_RGB9E5_UFLOAT, volumeTexels(0, SIZE, HDR)),
		layersHalf: [0, 1].map((level) => put(G.FORMAT_RGBA16_FLOAT, layerTexels(level, red, blue, 1))),
		layersPacked: put(G.FORMAT_RGB9E5_UFLOAT, layerTexels(0, green, violet, HDR)),
		layersSmall: put(G.FORMAT_RG11B10_UFLOAT, layerTexels(0, violet, red, HDR)),
		layers8: put(G.FORMAT_RGBA8_UNORM, layerTexels(0, blue, green, 1)),
		probe: memory.put(Float32Array.of(0, 0, 0, 1, 1, 1, 1, 1)),
	};
	const params = memory.put(quads.bytes);

	// Resources.
	const U = G.TEXTURE_USAGE_COPY_DST;
	const BIND = G.TEXTURE_USAGE_TEXTURE_BINDING;
	const SRC = G.TEXTURE_USAGE_COPY_SRC;
	const DRAW = G.TEXTURE_USAGE_RENDER_ATTACHMENT;
	memory.push(
		G.OP_CREATE_BUFFER,
		PARAMS_BUFFER,
		quads.bytes.byteLength,
		G.BUFFER_USAGE_UNIFORM | G.BUFFER_USAGE_COPY_DST,
	);
	/** Each texture's format, for the byte lengths of its writes. */
	const formats: number[] = [];
	const texture = (
		id: number,
		[width, height, layers, mips]: [number, number, number, number],
		format: number,
		usage: number,
		view: number,
	) => {
		formats[id] = format;
		memory.push(G.OP_CREATE_TEXTURE, id, width, height, layers, format, usage, 1, mips, view);
	};
	const FACES = G.VIEW_CUBE_FACES;
	texture(TEXTURE.cube, [SIZE, SIZE, FACES, 3], G.FORMAT_RGBA16_FLOAT, BIND | U | SRC, G.VIEW_CUBE);
	texture(
		TEXTURE.cubePacked,
		[SIZE, SIZE, FACES, 3],
		G.FORMAT_RGB9E5_UFLOAT,
		BIND | U,
		G.VIEW_CUBE,
	);
	texture(
		TEXTURE.cubeMixed,
		[SIZE, SIZE, FACES, 2],
		G.FORMAT_RGBA16_FLOAT,
		BIND | U | DRAW,
		G.VIEW_CUBE,
	);
	texture(
		TEXTURE.cubeSmall,
		[SIZE, SIZE, FACES, 2],
		G.FORMAT_RG11B10_UFLOAT,
		BIND | U,
		G.VIEW_CUBE,
	);
	texture(TEXTURE.volume, [SIZE, SIZE, SIZE, 2], G.FORMAT_RGBA8_UNORM, BIND | U, G.VIEW_3D);
	texture(TEXTURE.volumeHalf, [SIZE, SIZE, SIZE, 1], G.FORMAT_RGBA16_FLOAT, BIND | U, G.VIEW_3D);
	texture(TEXTURE.volumePacked, [SIZE, SIZE, SIZE, 1], G.FORMAT_RGB9E5_UFLOAT, BIND | U, G.VIEW_3D);
	const layered = G.VIEW_2D_ARRAY;
	texture(TEXTURE.layersHalf, [SIZE, SIZE, 1, 2], G.FORMAT_RGBA16_FLOAT, BIND | U | SRC, layered);
	texture(TEXTURE.layersPacked, [SIZE, SIZE, 1, 1], G.FORMAT_RGB9E5_UFLOAT, BIND | U, layered);
	texture(TEXTURE.layersSmall, [SIZE, SIZE, 1, 1], G.FORMAT_RG11B10_UFLOAT, BIND | U, layered);
	texture(TEXTURE.layers8, [SIZE, SIZE, 1, 1], G.FORMAT_RGBA8_UNORM, BIND | U | SRC, layered);
	if (probe) texture(TEXTURE.probe, [2, 1, 1, 1], G.FORMAT_RGBA32_FLOAT, BIND | U, layered);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.faceLevel0, TEXTURE.cubeMixed, 0, 2);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.faceLevel1, TEXTURE.cubeMixed, 1, 3);

	const sampler = (id: number, filter: number) =>
		memory.pushFloats(G.OP_CREATE_SAMPLER, [
			id,
			G.ADDRESS_CLAMP_TO_EDGE,
			G.ADDRESS_CLAMP_TO_EDGE,
			G.ADDRESS_CLAMP_TO_EDGE,
			filter,
			filter,
			filter,
			{ f: 0 },
			{ f: 32 },
			G.COMPARE_NONE,
			1,
		]);
	sampler(SAMPLER.nearest, G.FILTER_NEAREST);
	sampler(SAMPLER.linear, G.FILTER_LINEAR);

	memory.push(
		G.OP_CREATE_BIND_GROUP,
		GROUP.params,
		LAYOUT_PARAMS,
		1,
		0,
		G.RESOURCE_BUFFER,
		PARAMS_BUFFER,
		0,
		PARAMS_BYTES,
	);
	const textures = (id: number, layout: number, texture: number, sampler: number) =>
		memory.push(
			G.OP_CREATE_BIND_GROUP,
			id,
			layout,
			2,
			...[0, G.RESOURCE_TEXTURE, texture, 0, 0],
			...[1, G.RESOURCE_SAMPLER, sampler, 0, 0],
		);
	textures(GROUP.cube, LAYOUT_CUBE, TEXTURE.cube, SAMPLER.nearest);
	textures(GROUP.cubePacked, LAYOUT_CUBE, TEXTURE.cubePacked, SAMPLER.linear);
	textures(GROUP.cubeMixed, LAYOUT_CUBE, TEXTURE.cubeMixed, SAMPLER.nearest);
	textures(GROUP.cubeSmall, LAYOUT_CUBE, TEXTURE.cubeSmall, SAMPLER.linear);
	textures(GROUP.volumeNearest, LAYOUT_VOLUME, TEXTURE.volume, SAMPLER.nearest);
	textures(GROUP.volumeLinear, LAYOUT_VOLUME, TEXTURE.volume, SAMPLER.linear);
	textures(GROUP.volumeHalf, LAYOUT_VOLUME, TEXTURE.volumeHalf, SAMPLER.linear);
	textures(GROUP.volumePacked, LAYOUT_VOLUME, TEXTURE.volumePacked, SAMPLER.linear);
	textures(GROUP.layersHalf, LAYOUT_LAYERS, TEXTURE.layersHalf, SAMPLER.linear);
	textures(GROUP.layersPacked, LAYOUT_LAYERS, TEXTURE.layersPacked, SAMPLER.linear);
	textures(GROUP.layersSmall, LAYOUT_LAYERS, TEXTURE.layersSmall, SAMPLER.linear);
	textures(GROUP.layers8, LAYOUT_LAYERS, TEXTURE.layers8, SAMPLER.nearest);
	if (probe) textures(GROUP.probe, LAYOUT_LAYERS, TEXTURE.probe, SAMPLER.linear);

	const pipeline = (id: number, template: number, color: number) =>
		memory.push(
			G.OP_CREATE_RENDER_PIPELINE,
			id,
			template,
			0,
			color,
			G.FORMAT_NONE,
			1,
			G.STATE_CULL_NONE,
			0,
			0,
			0,
		);
	pipeline(PIPELINE.face, TEMPLATE_FACE, G.FORMAT_RGBA16_FLOAT);
	pipeline(PIPELINE.sample, TEMPLATE_SAMPLE, G.FORMAT_CANVAS);

	// Writes of whole levels: every face of a cube level, or every slice, in one write.
	const write = (id: number, level: number, layer: number, layers: number, source: number) => {
		const side = SIZE >> level;
		const bytes = side * side * layers * (G.FORMAT_BLOCK_BYTES[formats[id] as number] as number);
		memory.push(G.OP_WRITE_TEXTURE, id, level, 0, 0, layer, side, side, layers, source, bytes);
	};
	memory.push(G.OP_WRITE_BUFFER, PARAMS_BUFFER, 0, params, quads.bytes.byteLength);
	for (const [level, source] of data.cube.entries()) write(TEXTURE.cube, level, 0, FACES, source);
	for (const [level, source] of data.cubePacked.entries())
		write(TEXTURE.cubePacked, level, 0, FACES, source);
	for (const [level, source] of data.cubeMixed.entries())
		write(TEXTURE.cubeMixed, level, 0, FACES, source);
	for (const [level, source] of data.cubeSmall.entries())
		write(TEXTURE.cubeSmall, level, 0, FACES, source);
	write(TEXTURE.volume, 0, 0, 3, data.volume);
	write(TEXTURE.volume, 1, 0, 2, data.volumeLevel1);
	write(TEXTURE.volumeHalf, 0, 0, SIZE, data.volumeHalf);
	write(TEXTURE.volumePacked, 0, 0, SIZE, data.volumePacked);
	for (const [level, source] of data.layersHalf.entries())
		write(TEXTURE.layersHalf, level, 0, 1, source);
	write(TEXTURE.layersPacked, 0, 0, 1, data.layersPacked);
	write(TEXTURE.layersSmall, 0, 0, 1, data.layersSmall);
	write(TEXTURE.layers8, 0, 0, 1, data.layers8);
	if (probe) memory.push(G.OP_WRITE_TEXTURE, TEXTURE.probe, 0, 0, 0, 0, 2, 1, 1, data.probe, 32);
	// The image into the mixed cube's +X face, after the write of its level.
	memory.push(
		G.OP_UPLOAD_IMAGE,
		...[TEXTURE.cubeMixed, 0, 0, 0, 0],
		...[SIZE, SIZE, IMAGE, G.UPLOAD_RELEASE, 0, 0],
	);
	// Copies: the first cube's +Y face into the mixed cube's -X face, the 16-bit layer into its
	// +Z face, and the 8-bit layer into the last slice of the 3D table.
	const copy = (from: [number, number], to: [number, number]) =>
		memory.push(
			G.OP_COPY_TEXTURE_TO_TEXTURE,
			...[from[0], 0, 0, 0, from[1]],
			...[to[0], 0, 0, 0, to[1]],
			...[SIZE, SIZE, 1],
		);
	copy([TEXTURE.cube, 2], [TEXTURE.cubeMixed, 1]);
	copy([TEXTURE.layersHalf, 0], [TEXTURE.cubeMixed, 4]);
	copy([TEXTURE.layers8, 0], [TEXTURE.volume, 3]);

	const pass = (color: number, clear: Color) =>
		memory.pushFloats(G.OP_BEGIN_RENDER_PASS, [
			color,
			G.NO_TARGET,
			G.NO_TARGET,
			...clear.map((f) => ({ f })),
			{ f: 0 },
			G.PASS_CLEAR_COLOR | G.PASS_STORE_COLOR,
		]);
	const quad = (params: number) => {
		memory.push(G.OP_SET_BIND_GROUP, 0, GROUP.params, 1, params);
		memory.push(G.OP_DRAW, 6, 1, 0, 0);
	};
	// Whole faces of two mip levels, each cleared and then half covered from its top.
	pass(TEXTURE.faceLevel0, [0.1, 0.15, 0.8, 1]);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.face);
	quad(faceTop);
	memory.push(G.OP_END_RENDER_PASS);
	pass(TEXTURE.faceLevel1, [0.8, 0.1, 0.6, 1]);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.face);
	quad(faceTopSmall);
	memory.push(G.OP_END_RENDER_PASS);

	// The grid, into the canvas's stand-in. Every cell sets the groups it does not read too, as
	// the sample pipeline's layout holds all of them.
	pass(0, [0.02, 0.02, 0.02, 1]);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.sample);
	const viewport = (column: number, line: number) =>
		memory.pushFloats(G.OP_SET_VIEWPORT, [
			column * CELL,
			line * CELL,
			CELL,
			CELL,
			{ f: 0 },
			{ f: 1 },
		]);
	memory.push(G.OP_SET_BIND_GROUP, 1, GROUP.cube, 0);
	memory.push(G.OP_SET_BIND_GROUP, 2, GROUP.volumeNearest, 0);
	memory.push(G.OP_SET_BIND_GROUP, 3, GROUP.layers8, 0);
	const groupIndex = (group: number) =>
		group <= GROUP.cubeSmall ? 1 : group <= GROUP.volumePacked ? 2 : 3;
	for (const [column, line, group, params] of cells) {
		memory.push(G.OP_SET_BIND_GROUP, groupIndex(group), group, 0);
		viewport(column, line);
		quad(params);
	}
	if (probe) {
		memory.push(G.OP_SET_BIND_GROUP, 3, GROUP.probe, 0);
		viewport(...PROBE_CELL);
		quad(probeQuad);
	}
	memory.push(G.OP_END_RENDER_PASS);
	memory.push(G.OP_SUBMIT);
	return memory;
}

/**
 * Whether the probe cell's pixels came from a linear filter: its ramp from black to white then
 * passes through grays left and right of the middle. A nearest filter gives black and white, and
 * WebGL2 reads black from a 32-bit float texture that it cannot filter.
 */
function probeFiltered(pixels: Uint8Array): boolean {
	const [column, line] = PROBE_CELL;
	const y = line * CELL + CELL / 2;
	const red = (x: number) => pixels[(y * WIDTH + column * CELL + x) * 4] as number;
	const gray = (value: number) => value > 20 && value < 235;
	return gray(red(Math.round(CELL * 0.4))) && gray(red(Math.round(CELL * 0.6)));
}

/** Paints the probe cell black, as GPUs differ there. */
function paintProbe(pixels: Uint8Array): void {
	const [column, line] = PROBE_CELL;
	for (let y = line * CELL; y < (line + 1) * CELL; y++)
		for (let x = column * CELL; x < (column + 1) * CELL; x++)
			pixels.set([0, 0, 0, 255], (y * WIDTH + x) * 4);
}

interface Drawn {
	pixels: Uint8Array;
	errors: string[];
	/** Whether the device offers a linear filter of 32-bit float textures. */
	float32Filterable: boolean;
	/** Whether the WebGPU device had core features, or undefined on WebGL2. */
	core?: boolean;
}

async function drawWebGPU(image: ImageBitmap): Promise<Drawn> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const filterable = 'float32-filterable' as GPUFeatureName;
	const features: GPUFeatureName[] = [];
	if (tier === 'webgpu' && adapter.features.has(coreFeatures)) features.push(coreFeatures);
	if (adapter.features.has(filterable)) features.push(filterable);
	const device = await adapter.requestDevice({ requiredFeatures: features });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	const target = device.createTexture({
		size: [WIDTH, HEIGHT],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const shaders = await loadWgslShaders(0);
	const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', shaders);
	backend.canvasTarget = target;
	const stage = GPUShaderStage.FRAGMENT;
	backend.defineLayout(LAYOUT_PARAMS, 'test params', [
		{
			binding: 0,
			visibility: GPUShaderStage.VERTEX | stage,
			buffer: { type: 'uniform', hasDynamicOffset: true },
		},
	]);
	const textureLayout = (id: number, label: string, viewDimension: GPUTextureViewDimension) =>
		backend.defineLayout(id, label, [
			{ binding: 0, visibility: stage, texture: { sampleType: 'float', viewDimension } },
			{ binding: 1, visibility: stage, sampler: { type: 'filtering' } },
		]);
	textureLayout(LAYOUT_CUBE, 'test cube', 'cube');
	textureLayout(LAYOUT_VOLUME, 'test volume', '3d');
	textureLayout(LAYOUT_LAYERS, 'test layers', '2d-array');
	const shader = SHADERS.test_cubes;
	const templates: [number, RenderTemplate][] = [
		[
			TEMPLATE_SAMPLE,
			{
				label: 'test sample',
				shader,
				pipeline: 'sample',
				layouts: [LAYOUT_PARAMS, LAYOUT_CUBE, LAYOUT_VOLUME, LAYOUT_LAYERS],
				vertexBuffers: [],
			},
		],
		[
			TEMPLATE_FACE,
			{
				label: 'test face',
				shader,
				pipeline: 'face',
				layouts: [LAYOUT_PARAMS],
				vertexBuffers: [],
			},
		],
	];
	for (const [id, template] of templates) backend.defineTemplate(id, template);
	backend.setImage(IMAGE, image);
	const float32Filterable = device.features.has(filterable);
	const memory = drawList(float32Filterable);
	device.pushErrorScope('validation');
	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
	const validation = await device.popErrorScope();
	if (validation) errors.push(validation.message);
	const pixels = await readbackWebGPU(device, target);
	const core = device.features.has(coreFeatures);
	backend.destroy();
	device.destroy();
	return { pixels, errors, core, float32Filterable };
}

async function drawWebGL2(image: ImageBitmap): Promise<Drawn> {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('no WebGL2 context');
	// WebGL2 filters 32-bit float textures only with this extension, which must be asked for.
	const float32Filterable = gl.getExtension('OES_texture_float_linear') !== null;
	// An RGBA8 stand-in for the canvas, which the grid pass draws into and the test reads back.
	const framebuffer = gl.createFramebuffer();
	const color = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, color);
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, WIDTH, HEIGHT);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
	const shaders = await loadGlslShaders(0);
	const backend = new WebGL2Backend(gl, canvas, shaders, true, 'reversed');
	backend.canvasTarget = { framebuffer, width: WIDTH, height: HEIGHT };
	const shader = SHADERS.test_cubes;
	const templates: [number, GlslTemplate][] = [
		[TEMPLATE_SAMPLE, { shader, pipeline: 'sample' }],
		[TEMPLATE_FACE, { shader, pipeline: 'face' }],
	];
	for (const [id, template] of templates) backend.defineTemplate(id, template);
	backend.setImage(IMAGE, image);
	// Every WebGL2 device draws the probe: without the extension it reads black.
	const memory = drawList(true);
	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	const pixels = readbackWebGL2(gl, WIDTH, HEIGHT);
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`WebGL error 0x${error.toString(16)}`);
	backend.destroy();
	return { pixels, errors, float32Filterable };
}

run('replay-cube-3d', async () => {
	const decode = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as const;
	const image = await createImageBitmap(imagePixels(), decode);
	const { pixels, errors, core, float32Filterable } =
		tier === 'webgl2' ? await drawWebGL2(image) : await drawWebGPU(image);
	const float32Filtered = probeFiltered(pixels);
	paintProbe(pixels);
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core,
		errors,
		float32Filterable,
		float32Filtered,
		// A device filters 32-bit floats exactly when it offers to.
		float32AsOffered: float32Filterable === float32Filtered,
		// The image that the list released.
		released: image.width === 0,
		width: WIDTH,
		height: HEIGHT,
		pixels: toBase64(pixels),
	};
});
