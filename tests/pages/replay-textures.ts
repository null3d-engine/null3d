// Replays one hand-written draw list that uses every texture command of the GPU layer, through the
// engine's backend for the GPU path that ?gpu= names: core WebGPU (webgpu), WebGPU in
// compatibility mode (compat) or WebGL2 (webgl2). The list fills textures by writes, an image
// upload in two bands and a copy, and makes the mip levels of an sRGB array's layer. It draws into
// single layers and mip levels through views, into depth alone, into an sRGB texture, and through
// a multisampled resolve. It then draws a grid of 5 x 4 cells into the canvas's stand-in, where
// each cell shows the effect of one command through a sampler, a viewport or a scissor. Every
// path must draw the same image. The page reports its tier in the engine's names, as the tier it
// asked for, and whether the WebGPU device has core features.
import {
	type GlslTemplate,
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

const CELL = 64;
/** The grid's cells: four columns of every other command, then one of the made mip levels. */
const COLUMNS = 5;
const WIDTH = COLUMNS * CELL;
const HEIGHT = 4 * CELL;
/** Bytes from one draw's parameters to the next: the dynamic offset alignment. */
const PARAMS_STRIDE = 256;
/** Bytes of one draw's parameters, the test shader's `Params`. */
const PARAMS_BYTES = 64;

type Tier = 'webgpu' | 'compat' | 'webgl2';
const requested = new URLSearchParams(location.search).get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';

// The page's own bind group layouts and templates, with ids that the engine's do not use.
const LAYOUT_PARAMS = 100;
const LAYOUT_TEXTURES = 101;
const LAYOUT_DEPTHS = 102;
const TEMPLATE_SAMPLE = 100;
const TEMPLATE_SOLID = 101;

/** What a quad of the test shader shows: its SHOW_ values. */
const SHOW = { color: 0, layer: 1, level: 2, flat: 3, depth: 4 } as const;

const PARAMS_BUFFER = 1;
const TEXTURE = {
	pattern: 1,
	mips: 2,
	depths: 3,
	images: 4,
	drawn: 5,
	srgbData: 6,
	srgbDrawn: 7,
	msaa: 8,
	resolved: 9,
	mipped: 10,
	// Views of one layer or one mip level, to draw into.
	depthLayer0: 20,
	depthLayer1: 21,
	drawnLayer1: 22,
	mipLevel2: 23,
} as const;
const SAMPLER = { repeat: 1, mirror: 2, clamp: 3, linear: 4, anisotropic: 5, compare: 6 } as const;
const GROUP = {
	params: 1,
	repeat: 2,
	mirror: 3,
	clamp: 4,
	linear: 5,
	mips: 6,
	anisotropic: 7,
	images: 8,
	drawn: 9,
	resolved: 10,
	depths: 11,
	mipped: 12,
} as const;
const PIPELINE = { depth: 1, rgba: 2, srgb: 3, msaa: 4, outSolid: 5, outSample: 6 } as const;
const IMAGE = 1;
/** An image that the list releases without an upload. */
const UNUSED_IMAGE = 2;

type Color = readonly [number, number, number, number];

/** One quad of the test shader. */
interface Quad {
	show?: number;
	layer?: number;
	level?: number;
	depth?: number;
	/** Texture coordinates at the top-left corner, then at the bottom-right corner. */
	uv?: readonly [number, number, number, number];
	color?: Color;
	/** True when a render pass drew the texture that the quad reads. */
	drawn?: boolean;
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
		this.u32[at + 1] = quad.layer ?? 0;
		this.f32[at + 2] = quad.level ?? 0;
		this.f32[at + 3] = quad.depth ?? 0.5;
		this.f32.set(quad.uv ?? [0, 0, 1, 1], at + 4);
		this.f32.set(quad.color ?? [1, 0, 1, 1], at + 8);
		this.u32[at + 12] = quad.drawn ? 1 : 0;
		return offset;
	}

	get bytes(): Uint8Array {
		return new Uint8Array(this.buffer, 0, this.count * PARAMS_STRIDE);
	}
}

/** RGBA8 texels of `layers` layers of `width` x `height`, from a function of each texel. */
function texels(
	width: number,
	height: number,
	layers: number,
	color: (x: number, y: number, layer: number) => Color,
): Uint8Array {
	const out = new Uint8Array(width * height * layers * 4);
	for (let layer = 0; layer < layers; layer++)
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				out.set(color(x, y, layer), ((layer * height + y) * width + x) * 4);
	return out;
}

/** The image to upload: four 16 x 16 quadrants, red, green, blue and white from the top-left. */
function imagePixels(): ImageData {
	const size = 32;
	const colors: Color[] = [
		[255, 0, 0, 255],
		[0, 255, 0, 255],
		[0, 0, 255, 255],
		[255, 255, 255, 255],
	];
	const data = texels(
		size,
		size,
		1,
		(x, y) => colors[(y < 16 ? 0 : 2) + (x < 16 ? 0 : 1)] as Color,
	);
	return new ImageData(new Uint8ClampedArray(data), size, size);
}

/** The draw list, and the engine memory that its writes read from. */
function drawList(): TestMemory {
	const memory = new TestMemory(1 << 20, 4096);
	const quads = new Quads();
	const cell = (column: number, row: number) => [column * CELL, row * CELL] as const;

	// Quads that draw into the textures.
	const depthTop = quads.add({ depth: 0.75 });
	const depthMiddle = quads.add({ depth: 0.4 });
	const yellow = quads.add({ color: [1, 0.9, 0.1, 1] });
	const magenta = quads.add({ color: [0.9, 0.1, 0.8, 1] });
	const orange = quads.add({ color: [1, 0.55, 0, 1] });
	// Linear values, which the sRGB target stores encoded and sampling decodes back.
	const srgbFill = quads.add({ color: [0.5, 0.25, 0.75, 1] });
	const srgbCorner = quads.add({ color: [1, 0.5, 0, 1] });
	const strip = quads.add({ color: [1, 0.55, 0, 1] });
	// The grid's cells, row by row.
	const layer = (index: number, uv: Quad['uv'], drawn = false) =>
		quads.add({ show: SHOW.layer, layer: index, uv, drawn });
	const cells: [number, number, number][] = [
		[GROUP.repeat, 0, layer(0, [0, 0, 2, 2])],
		[GROUP.mirror, 1, layer(1, [-1, -1, 1, 1])],
		[GROUP.clamp, 2, layer(0, [-0.5, -0.5, 1.5, 1.5])],
		[GROUP.linear, 3, layer(0, [0, 0, 1, 1])],
		[GROUP.mips, 4, quads.add({ show: SHOW.level, level: 1 })],
		[GROUP.mips, 5, quads.add({ show: SHOW.level, level: 2, drawn: true })],
		[GROUP.anisotropic, 6, layer(0, [0, 0, 1, 1])],
		[
			GROUP.clamp,
			7,
			quads.add({ show: SHOW.depth, layer: 0, color: [0.9, 0.85, 0.3, 1], drawn: true }),
		],
		[GROUP.images, 8, layer(0, [0, 0, 1, 1])],
		[GROUP.images, 9, layer(1, [0, 0, 1, 1])],
		[
			GROUP.clamp,
			10,
			quads.add({ show: SHOW.depth, layer: 1, color: [0.3, 0.85, 0.9, 1], drawn: true }),
		],
		[GROUP.clamp, 11, quads.add({ show: SHOW.flat })],
		[GROUP.drawn, 12, layer(1, [0, 0, 1, 1], true)],
		[GROUP.drawn, 13, quads.add({ show: SHOW.flat, drawn: true })],
		[GROUP.resolved, 14, quads.add({ show: SHOW.flat, drawn: true })],
	];
	const red = quads.add({ color: [0.9, 0.1, 0.1, 1] });
	const green = quads.add({ color: [0.1, 0.8, 0.2, 1] });
	// The last column: mip levels 1 to 4 of the second layer of the sRGB array, which the GPU made.
	const levels = [1, 2, 3, 4].map((level) => quads.add({ show: SHOW.level, layer: 1, level }));

	const pattern = memory.put(
		texels(8, 8, 2, (x, y, l) =>
			l === 0 ? [x * 36, y * 36, 128, 255] : [200, x * 36, y * 36, 255],
		),
	);
	const checker = memory.put(
		texels(16, 16, 1, (x, y) =>
			((x >> 2) ^ (y >> 2)) & 1 ? [230, 120, 30, 255] : [40, 90, 200, 255],
		),
	);
	const quadrants = memory.put(
		texels(8, 8, 1, (x, y) => {
			const colors: Color[] = [
				[220, 40, 40, 255],
				[40, 200, 60, 255],
				[40, 60, 220, 255],
				[230, 220, 40, 255],
			];
			return colors[(y < 4 ? 0 : 2) + (x < 4 ? 0 : 1)] as Color;
		}),
	);
	// Blocks of 4 x 4 texels, red and blue: levels 1 and 2 keep them apart, and levels 3 and 4
	// average them in linear color, which sRGB stores as 188 in red and blue.
	const blocks = memory.put(
		texels(16, 16, 1, (x, y) => (((x >> 2) ^ (y >> 2)) & 1 ? [0, 0, 255, 255] : [255, 0, 0, 255])),
	);
	// sRGB bytes: 188 decodes to about 0.5, and 128 to about 0.22; the top row is red.
	const srgb = memory.put(
		texels(4, 4, 1, (x, y) =>
			y === 0 ? [230, 30, 30, 255] : x < 2 ? [188, 188, 188, 255] : [128, 128, 128, 255],
		),
	);
	const params = memory.put(quads.bytes);

	// Resources.
	const U = G.TEXTURE_USAGE_COPY_DST;
	const BIND = G.TEXTURE_USAGE_TEXTURE_BINDING;
	const DRAW = G.TEXTURE_USAGE_RENDER_ATTACHMENT;
	memory.push(
		G.OP_CREATE_BUFFER,
		PARAMS_BUFFER,
		quads.bytes.byteLength,
		G.BUFFER_USAGE_UNIFORM | G.BUFFER_USAGE_COPY_DST,
	);
	const texture = (
		id: number,
		[width, height, layers, mips]: [number, number, number, number],
		format: number,
		usage: number,
		view: number,
		samples = 1,
	) =>
		memory.push(G.OP_CREATE_TEXTURE, id, width, height, layers, format, usage, samples, mips, view);
	texture(TEXTURE.pattern, [8, 8, 2, 1], G.FORMAT_RGBA8_UNORM, BIND | U, G.VIEW_2D_ARRAY);
	texture(TEXTURE.mips, [16, 16, 1, 3], G.FORMAT_RGBA8_UNORM, BIND | U | DRAW, G.VIEW_2D_ARRAY);
	texture(TEXTURE.depths, [CELL, CELL, 2, 1], G.FORMAT_DEPTH32_FLOAT, BIND | DRAW, G.VIEW_2D_ARRAY);
	texture(
		TEXTURE.images,
		[CELL, CELL, 2, 1],
		G.FORMAT_RGBA8_UNORM,
		BIND | U | G.TEXTURE_USAGE_COPY_SRC | DRAW,
		G.VIEW_2D_ARRAY,
	);
	texture(TEXTURE.drawn, [CELL, CELL, 2, 1], G.FORMAT_RGBA8_UNORM, BIND | DRAW, G.VIEW_2D_ARRAY);
	texture(TEXTURE.srgbData, [4, 4, 1, 1], G.FORMAT_RGBA8_UNORM_SRGB, BIND | U, G.VIEW_2D);
	texture(TEXTURE.srgbDrawn, [CELL, CELL, 1, 1], G.FORMAT_RGBA8_UNORM_SRGB, BIND | DRAW, G.VIEW_2D);
	texture(TEXTURE.msaa, [CELL, CELL, 1, 1], G.FORMAT_RGBA8_UNORM, DRAW, G.VIEW_2D, 4);
	texture(TEXTURE.resolved, [CELL, CELL, 1, 1], G.FORMAT_RGBA8_UNORM, BIND | DRAW, G.VIEW_2D);
	texture(
		TEXTURE.mipped,
		[16, 16, 2, 5],
		G.FORMAT_RGBA8_UNORM_SRGB,
		BIND | U | DRAW,
		G.VIEW_2D_ARRAY,
	);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.depthLayer0, TEXTURE.depths, 0, 0);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.depthLayer1, TEXTURE.depths, 0, 1);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.drawnLayer1, TEXTURE.drawn, 0, 1);
	memory.push(G.OP_CREATE_TEXTURE_VIEW, TEXTURE.mipLevel2, TEXTURE.mips, 2, 0);

	const sampler = (
		id: number,
		address: number,
		filter: number,
		compare = G.COMPARE_NONE,
		anisotropy = 1,
	) =>
		memory.pushFloats(G.OP_CREATE_SAMPLER, [
			id,
			address,
			address,
			address,
			filter,
			filter,
			filter,
			{ f: 0 },
			{ f: 32 },
			compare,
			anisotropy,
		]);
	sampler(SAMPLER.repeat, G.ADDRESS_REPEAT, G.FILTER_NEAREST);
	sampler(SAMPLER.mirror, G.ADDRESS_MIRROR_REPEAT, G.FILTER_NEAREST);
	sampler(SAMPLER.clamp, G.ADDRESS_CLAMP_TO_EDGE, G.FILTER_NEAREST);
	sampler(SAMPLER.linear, G.ADDRESS_CLAMP_TO_EDGE, G.FILTER_LINEAR);
	sampler(SAMPLER.anisotropic, G.ADDRESS_REPEAT, G.FILTER_LINEAR, G.COMPARE_NONE, 4);
	sampler(SAMPLER.compare, G.ADDRESS_CLAMP_TO_EDGE, G.FILTER_LINEAR, G.COMPARE_LESS);

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
	const textures = (id: number, layers: number, flat: number, sampler: number) =>
		memory.push(
			G.OP_CREATE_BIND_GROUP,
			id,
			LAYOUT_TEXTURES,
			3,
			...[0, G.RESOURCE_TEXTURE, layers, 0, 0],
			...[1, G.RESOURCE_TEXTURE, flat, 0, 0],
			...[2, G.RESOURCE_SAMPLER, sampler, 0, 0],
		);
	textures(GROUP.repeat, TEXTURE.pattern, TEXTURE.srgbData, SAMPLER.repeat);
	textures(GROUP.mirror, TEXTURE.pattern, TEXTURE.srgbData, SAMPLER.mirror);
	textures(GROUP.clamp, TEXTURE.pattern, TEXTURE.srgbData, SAMPLER.clamp);
	textures(GROUP.linear, TEXTURE.pattern, TEXTURE.srgbData, SAMPLER.linear);
	textures(GROUP.mips, TEXTURE.mips, TEXTURE.srgbData, SAMPLER.clamp);
	textures(GROUP.anisotropic, TEXTURE.mips, TEXTURE.srgbData, SAMPLER.anisotropic);
	textures(GROUP.images, TEXTURE.images, TEXTURE.srgbData, SAMPLER.clamp);
	textures(GROUP.drawn, TEXTURE.drawn, TEXTURE.srgbDrawn, SAMPLER.clamp);
	textures(GROUP.resolved, TEXTURE.pattern, TEXTURE.resolved, SAMPLER.clamp);
	textures(GROUP.mipped, TEXTURE.mipped, TEXTURE.srgbData, SAMPLER.clamp);
	memory.push(
		G.OP_CREATE_BIND_GROUP,
		GROUP.depths,
		LAYOUT_DEPTHS,
		2,
		...[0, G.RESOURCE_TEXTURE, TEXTURE.depths, 0, 0],
		...[1, G.RESOURCE_SAMPLER, SAMPLER.compare, 0, 0],
	);

	const pipeline = (id: number, template: number, color: number, depth: number, samples = 1) =>
		memory.push(
			G.OP_CREATE_RENDER_PIPELINE,
			id,
			template,
			0,
			color,
			depth,
			samples,
			G.STATE_CULL_NONE,
			0,
		);
	pipeline(PIPELINE.depth, TEMPLATE_SOLID, G.FORMAT_NONE, G.FORMAT_DEPTH32_FLOAT);
	pipeline(PIPELINE.rgba, TEMPLATE_SOLID, G.FORMAT_RGBA8_UNORM, G.FORMAT_NONE);
	pipeline(PIPELINE.srgb, TEMPLATE_SOLID, G.FORMAT_RGBA8_UNORM_SRGB, G.FORMAT_NONE);
	pipeline(PIPELINE.msaa, TEMPLATE_SOLID, G.FORMAT_RGBA8_UNORM, G.FORMAT_NONE, 4);
	pipeline(PIPELINE.outSolid, TEMPLATE_SOLID, G.FORMAT_CANVAS, G.FORMAT_NONE);
	pipeline(PIPELINE.outSample, TEMPLATE_SAMPLE, G.FORMAT_CANVAS, G.FORMAT_NONE);

	// Writes, an upload and a copy, before the passes that read them.
	memory.push(G.OP_WRITE_BUFFER, PARAMS_BUFFER, 0, params, quads.bytes.byteLength);
	memory.push(G.OP_WRITE_TEXTURE, TEXTURE.pattern, 0, 0, 0, 0, 8, 8, 2, pattern, 8 * 8 * 2 * 4);
	memory.push(G.OP_WRITE_TEXTURE, TEXTURE.mips, 0, 0, 0, 0, 16, 16, 1, checker, 16 * 16 * 4);
	memory.push(G.OP_WRITE_TEXTURE, TEXTURE.mips, 1, 0, 0, 0, 8, 8, 1, quadrants, 8 * 8 * 4);
	memory.push(G.OP_WRITE_TEXTURE, TEXTURE.srgbData, 0, 0, 0, 0, 4, 4, 1, srgb, 4 * 4 * 4);
	// The image in two bands of 16 rows: the second starts at the image's row 16, and releases it.
	memory.push(G.OP_UPLOAD_IMAGE, TEXTURE.images, 0, 16, 8, 0, 32, 16, IMAGE, 0, 0, 0);
	memory.push(
		G.OP_UPLOAD_IMAGE,
		...[TEXTURE.images, 0, 16, 24, 0],
		...[32, 16, IMAGE, G.UPLOAD_RELEASE, 0, 16],
	);
	memory.push(G.OP_RELEASE_IMAGE, UNUSED_IMAGE);
	memory.push(G.OP_WRITE_TEXTURE, TEXTURE.mipped, 0, 0, 0, 1, 16, 16, 1, blocks, 16 * 16 * 4);
	// The top half of the image, red and green, into the second layer's lower left.
	memory.push(
		G.OP_COPY_TEXTURE_TO_TEXTURE,
		...[TEXTURE.images, 0, 16, 8, 0],
		...[TEXTURE.images, 0, 0, 40, 1],
		...[32, 16, 1],
	);

	const pass = (color: number, resolve: number, depth: number, clear: Color, flags: number) =>
		memory.pushFloats(G.OP_BEGIN_RENDER_PASS, [
			color,
			resolve,
			depth,
			...clear.map((f) => ({ f })),
			{ f: 0 },
			flags,
		]);
	const viewport = (x: number, y: number, width: number, height: number) =>
		memory.pushFloats(G.OP_SET_VIEWPORT, [x, y, width, height, { f: 0 }, { f: 1 }]);
	const scissor = (x: number, y: number, width: number, height: number) =>
		memory.push(G.OP_SET_SCISSOR, x, y, width, height);
	const quad = (params: number) => {
		memory.push(G.OP_SET_BIND_GROUP, 0, GROUP.params, 1, params);
		memory.push(G.OP_DRAW, 6, 1, 0, 0);
	};
	const NONE = G.NO_TARGET;
	const depthOnly = G.PASS_CLEAR_DEPTH | G.PASS_STORE_DEPTH;
	const colorKept = G.PASS_CLEAR_COLOR | G.PASS_STORE_COLOR;

	// The mip levels of the blocks' layer, after every write in the list.
	memory.push(G.OP_GENERATE_MIPMAPS, TEXTURE.mipped, 1);

	// Depth alone, into one layer each: the top half of layer 0, and a square in layer 1.
	pass(NONE, NONE, TEXTURE.depthLayer0, [0, 0, 0, 0], depthOnly);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.depth);
	viewport(0, 0, CELL, 32);
	quad(depthTop);
	memory.push(G.OP_END_RENDER_PASS);
	pass(NONE, NONE, TEXTURE.depthLayer1, [0, 0, 0, 0], depthOnly);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.depth);
	scissor(16, 16, 32, 32);
	quad(depthMiddle);
	memory.push(G.OP_END_RENDER_PASS);

	// Color into one layer: a yellow square at the top-left, and a magenta strip that a scissor cuts.
	pass(TEXTURE.drawnLayer1, NONE, NONE, [0.1, 0.2, 0.8, 1], colorKept);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.rgba);
	viewport(0, 0, 32, 32);
	quad(yellow);
	viewport(0, 0, CELL, CELL);
	scissor(40, 8, 16, 48);
	quad(magenta);
	memory.push(G.OP_END_RENDER_PASS);

	// Color into mip level 2, 4 x 4 texels: an orange quarter at the top-left.
	pass(TEXTURE.mipLevel2, NONE, NONE, [0, 0.8, 0.8, 1], colorKept);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.rgba);
	viewport(0, 0, 2, 2);
	quad(orange);
	memory.push(G.OP_END_RENDER_PASS);

	// Linear color into an sRGB texture, which stores it encoded.
	pass(TEXTURE.srgbDrawn, NONE, NONE, [0, 0, 0, 1], colorKept);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.srgb);
	quad(srgbFill);
	viewport(0, 0, 32, 16);
	quad(srgbCorner);
	memory.push(G.OP_END_RENDER_PASS);

	// A multisampled strip, resolved into a texture.
	pass(TEXTURE.msaa, TEXTURE.resolved, NONE, [0.05, 0.3, 0.1, 1], G.PASS_CLEAR_COLOR);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.msaa);
	viewport(8, 32, 48, 16);
	quad(strip);
	memory.push(G.OP_END_RENDER_PASS);

	// The grid, into the canvas's stand-in.
	pass(0, NONE, NONE, [0.02, 0.02, 0.02, 1], colorKept);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.outSample);
	memory.push(G.OP_SET_BIND_GROUP, 2, GROUP.depths, 0);
	for (const [group, index, params] of cells) {
		const [x, y] = cell(index % 4, Math.floor(index / 4));
		memory.push(G.OP_SET_BIND_GROUP, 1, group, 0);
		viewport(x, y, CELL, CELL);
		quad(params);
	}
	// The last cell: a scissor that keeps a red bar at the top-left, then a viewport that puts a
	// green bar right of the middle and low.
	const [x, y] = cell(3, 3);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.outSolid);
	viewport(x, y, CELL, CELL);
	scissor(x, y, 32, 16);
	quad(red);
	scissor(0, 0, WIDTH, HEIGHT);
	viewport(x + 40, y + 24, 16, 32);
	quad(green);
	memory.push(G.OP_SET_PIPELINE, PIPELINE.outSample);
	memory.push(G.OP_SET_BIND_GROUP, 1, GROUP.mipped, 0);
	for (const [row, params] of levels.entries()) {
		viewport((COLUMNS - 1) * CELL, row * CELL, CELL, CELL);
		quad(params);
	}
	memory.push(G.OP_END_RENDER_PASS);
	memory.push(G.OP_SUBMIT);
	return memory;
}

interface Drawn {
	pixels: Uint8Array;
	errors: string[];
	/** Whether the WebGPU device had core features, or undefined on WebGL2. */
	core?: boolean;
}

async function drawWebGPU(memory: TestMemory, images: ImageBitmap[]): Promise<Drawn> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const wanted = tier === 'webgpu' && adapter.features.has(coreFeatures);
	const device = await adapter.requestDevice({ requiredFeatures: wanted ? [coreFeatures] : [] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	const target = device.createTexture({
		size: [WIDTH, HEIGHT],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const backend = new WebGPUBackend(device, undefined, 'rgba8unorm');
	backend.canvasTarget = target;
	const stage = GPUShaderStage.FRAGMENT;
	backend.defineLayout(LAYOUT_PARAMS, 'test params', [
		{
			binding: 0,
			visibility: GPUShaderStage.VERTEX | stage,
			buffer: { type: 'uniform', hasDynamicOffset: true },
		},
	]);
	backend.defineLayout(LAYOUT_TEXTURES, 'test textures', [
		{ binding: 0, visibility: stage, texture: { sampleType: 'float', viewDimension: '2d-array' } },
		{ binding: 1, visibility: stage, texture: { sampleType: 'float', viewDimension: '2d' } },
		{ binding: 2, visibility: stage, sampler: { type: 'filtering' } },
	]);
	backend.defineLayout(LAYOUT_DEPTHS, 'test depths', [
		{ binding: 0, visibility: stage, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
		{ binding: 1, visibility: stage, sampler: { type: 'comparison' } },
	]);
	const shader = SHADERS.test_textures;
	const templates: [number, RenderTemplate][] = [
		[
			TEMPLATE_SAMPLE,
			{
				label: 'test sample',
				shader,
				pipeline: 'sample',
				layouts: [LAYOUT_PARAMS, LAYOUT_TEXTURES, LAYOUT_DEPTHS],
				vertexBuffers: [],
			},
		],
		[
			TEMPLATE_SOLID,
			{
				label: 'test solid',
				shader,
				pipeline: 'solid',
				layouts: [LAYOUT_PARAMS],
				vertexBuffers: [],
			},
		],
	];
	for (const [id, template] of templates) backend.defineTemplate(id, template);
	for (const [index, image] of images.entries()) backend.setImage(index + 1, image);
	device.pushErrorScope('validation');
	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
	const validation = await device.popErrorScope();
	if (validation) errors.push(validation.message);
	const pixels = await readbackWebGPU(device, target);
	const core = device.features.has(coreFeatures);
	backend.destroy();
	device.destroy();
	return { pixels, errors, core };
}

function drawWebGL2(memory: TestMemory, images: ImageBitmap[]): Drawn {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('no WebGL2 context');
	// An RGBA8 stand-in for the canvas, which the grid pass draws into and the test reads back.
	const framebuffer = gl.createFramebuffer();
	const color = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, color);
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, WIDTH, HEIGHT);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
	// Reversed depth, as on WebGPU, so every path draws the same reference image.
	const backend = new WebGL2Backend(gl, canvas, true, 'reversed');
	backend.canvasTarget = { framebuffer, width: WIDTH, height: HEIGHT };
	const shader = SHADERS.test_textures;
	const templates: [number, GlslTemplate][] = [
		[TEMPLATE_SAMPLE, { shader, pipeline: 'sample' }],
		[TEMPLATE_SOLID, { shader, pipeline: 'solid' }],
	];
	for (const [id, template] of templates) backend.defineTemplate(id, template);
	for (const [index, image] of images.entries()) backend.setImage(index + 1, image);
	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	const pixels = readbackWebGL2(gl, WIDTH, HEIGHT);
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`WebGL error 0x${error.toString(16)}`);
	backend.destroy();
	return { pixels, errors };
}

run('replay-textures', async () => {
	const memory = drawList();
	const decode = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as const;
	const images = [
		await createImageBitmap(imagePixels(), decode),
		await createImageBitmap(imagePixels(), decode),
	];
	const { pixels, errors, core } =
		tier === 'webgl2' ? drawWebGL2(memory, images) : await drawWebGPU(memory, images);
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core,
		errors,
		// Images that the list released: every one it had.
		released: images.every((image) => image.width === 0),
		width: WIDTH,
		height: HEIGHT,
		pixels: toBase64(pixels),
	};
});
