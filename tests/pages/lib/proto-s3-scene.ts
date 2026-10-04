// Prototype S3 (not for merging): the AO prototype page's fixed scene, its camera, the uniform data
// of its shaders, and the passes that each measured setup draws. The renderers of
// `proto-s3-webgpu.ts` and `proto-s3-webgl2.ts` draw these passes with GPU calls of their own.

/** How the AO passes get the distance to the camera at the AO size. */
export type AoInput = 'copy' | 'structure';
/** The ambient occlusion variants. `three` is M2-F2's steps as merged. */
export type AoKind = 'sao' | 'gtao' | 'bitmask' | 'gtao_wide' | 'three';
/** How the lit pass reads the occlusion. */
export type Upsample = 'none' | 'bilinear' | 'depth';

export const AO_KINDS: readonly AoKind[] = ['sao', 'gtao', 'bitmask', 'gtao_wide', 'three'];
export const AO_INPUTS: readonly AoInput[] = ['copy', 'structure'];

/** One measured setup: what the frame draws. A setup with no input draws the lit pass alone. */
export interface Setup {
	input: AoInput | null;
	ao: AoKind | null;
	upsample: Upsample;
	contact: boolean;
}

export function setupName(setup: Setup): string {
	if (!setup.input) return 'baseline';
	const parts = [setup.input, setup.ao ?? 'no-ao', setup.upsample];
	if (setup.contact) parts.push('contact');
	return parts.join('-');
}

/** A pass of a frame. Each renderer draws a pass as one or more GPU passes. */
export type Pass =
	| { kind: 'prepass' }
	/** WebGL2 only: the blit of the multisampled depth into one sample, before the copy. */
	| { kind: 'resolve' }
	| { kind: 'copy' }
	| { kind: 'structure' }
	| { kind: 'ao'; ao: AoKind; input: AoInput }
	/** Filament's bilateral blur, across then down, or M2-F2's denoise for `three`. */
	| { kind: 'blur'; ao: AoKind; input: AoInput }
	| { kind: 'lit'; upsample: Upsample; contact: boolean; prepass: boolean; input: AoInput | null };

export function passKey(pass: Pass): string {
	switch (pass.kind) {
		case 'ao':
			return pass.ao === 'three' ? 'three_horizon' : pass.ao;
		case 'blur':
			return pass.ao === 'three' ? 'three_denoise' : 'blur';
		case 'lit':
			return [
				'lit',
				pass.upsample,
				...(pass.contact ? ['contact'] : []),
				...(pass.prepass ? ['after-prepass'] : []),
			].join('-');
		default:
			return pass.kind;
	}
}

/** The passes of a frame of a setup, in order. */
export function framePasses(setup: Setup, resolvesDepth: boolean): Pass[] {
	const passes: Pass[] = [];
	const { input, ao } = setup;
	if (input === 'copy') {
		passes.push({ kind: 'prepass' });
		if (resolvesDepth) passes.push({ kind: 'resolve' });
		passes.push({ kind: 'copy' });
	} else if (input === 'structure') passes.push({ kind: 'structure' });
	if (input && ao) passes.push({ kind: 'ao', ao, input }, { kind: 'blur', ao, input });
	passes.push({
		kind: 'lit',
		upsample: ao ? setup.upsample : 'none',
		contact: setup.contact,
		prepass: input === 'copy',
		input,
	});
	return passes;
}

/** A mesh of the scene: interleaved positions and normals, and 16-bit indices. */
export interface Mesh {
	vertices: Float32Array;
	indices: Uint16Array;
}

/** A unit sphere of radius 1. */
export function sphereMesh(columns = 32, rows = 16): Mesh {
	const vertices: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rows; r++) {
		const theta = (r / rows) * Math.PI;
		for (let c = 0; c <= columns; c++) {
			const phi = (c / columns) * Math.PI * 2;
			const x = Math.sin(theta) * Math.cos(phi);
			const y = Math.cos(theta);
			const z = -Math.sin(theta) * Math.sin(phi);
			vertices.push(x, y, z, x, y, z);
		}
	}
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns; c++) {
			const a = r * (columns + 1) + c;
			const b = a + columns + 1;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

/** A unit box from -0.5 to 0.5 on each axis. */
export function boxMesh(): Mesh {
	const vertices: number[] = [];
	const indices: number[] = [];
	const faces: [number[], number[], number[]][] = [
		[
			[1, 0, 0],
			[0, 0, -1],
			[0, 1, 0],
		],
		[
			[-1, 0, 0],
			[0, 0, 1],
			[0, 1, 0],
		],
		[
			[0, 1, 0],
			[1, 0, 0],
			[0, 0, -1],
		],
		[
			[0, -1, 0],
			[1, 0, 0],
			[0, 0, 1],
		],
		[
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0],
		],
		[
			[0, 0, -1],
			[-1, 0, 0],
			[0, 1, 0],
		],
	];
	for (const [n, u, v] of faces) {
		const base = vertices.length / 6;
		for (const [su, sv] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		] as const) {
			const p = [0, 1, 2].map(
				(k) => 0.5 * ((n[k] as number) + su * (u[k] as number) + sv * (v[k] as number)),
			);
			vertices.push(...p, ...n);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

/** Instance data: place (xyz, 0), size (xyz, 0) and linear color (rgb, 1), 12 floats each. */
export const INSTANCE_FLOATS = 12;

function srgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [16, 8, 0].map((shift) => ((value >> shift) & 255) / 255).map((c) => c ** 2.2) as [
		number,
		number,
		number,
	];
}

function instances(list: [number[], number[], string][]): Float32Array {
	const data = new Float32Array(list.length * INSTANCE_FLOATS);
	list.forEach(([place, size, color], i) => {
		data.set([...place, 0, ...size, 0, ...srgb(color), 1], i * INSTANCE_FLOATS);
	});
	return data;
}

const SPHERE_COLORS = ['#e0d8d0', '#d8c090', '#c0d0e0', '#d0a080', '#a0c090', '#9098c8'];

/**
 * The scene: a floor and a back wall that meet in a crease, a grid of spheres resting on the floor,
 * a row of thin poles in front of the wall (where horizon GTAO draws dark halos), a stack of boxes
 * in a corner and a table on four thin legs (contact shadows under its top and at its feet).
 */
export function sceneInstances(grid: number): { spheres: Float32Array; boxes: Float32Array } {
	const spheres: [number[], number[], string][] = [];
	const radius = 0.32;
	for (let i = 0; i < grid; i++)
		for (let j = 0; j < grid; j++) {
			const x = (i - (grid - 1) / 2) * (4.2 / Math.max(1, grid - 1));
			const z = -1.9 + j * (3.6 / Math.max(1, grid - 1));
			spheres.push([
				[x, radius, z],
				[radius, radius, radius],
				SPHERE_COLORS[(i + j * grid) % SPHERE_COLORS.length] as string,
			]);
		}
	const boxes: [number[], number[], string][] = [
		[[0, -0.1, 0], [12, 0.2, 9], '#c8c4bc'],
		[[0, 2, -3], [12, 4, 0.2], '#b8c0c8'],
		[[-3.9, 0.5, -2.3], [1, 1, 1], '#d0a080'],
		[[-3.7, 1.3, -2.4], [0.6, 0.6, 0.6], '#a0c090'],
	];
	for (let p = 0; p < 7; p++)
		boxes.push([[-2.7 + p * 0.9, 0.8, -2.6], [0.05, 1.6, 0.05], '#9098c8']);
	const table = { x: 3.4, z: 0.6, width: 1.4, depth: 0.8, height: 0.75 };
	boxes.push([[table.x, table.height, table.z], [table.width, 0.06, table.depth], '#a08060']);
	for (const sx of [-1, 1])
		for (const sz of [-1, 1])
			boxes.push([
				[
					table.x + sx * (table.width / 2 - 0.06),
					table.height / 2,
					table.z + sz * (table.depth / 2 - 0.06),
				],
				[0.05, table.height, 0.05],
				'#806040',
			]);
	return { spheres: instances(spheres), boxes: instances(boxes) };
}

/** The camera: where it stands, where it looks, its vertical field of view, near and far. */
export const CAMERA = {
	position: [0, 2.6, 6.8],
	target: [0, 0.5, -0.6],
	fovDegrees: 50,
	near: 0.1,
	far: 60,
} as const;

/** The direction toward the sun, in world space. */
const SUN = normalize([-0.6, 0.55, 0.45]);
const SUN_STRENGTH = 2.2;

/** Ambient occlusion settings: Filament's defaults, and M2-F2's (GTAOPass's) for `three`. */
export const AO_SETTINGS = {
	radius: 0.3,
	intensity: 1,
	power: 2,
	bias: 0.0005,
	thickness: 0.25,
	three: { radius: 0.25, thickness: 1, exponent: 1, falloff: 1, scale: 1, slices: 3, steps: 6 },
	denoise: { luma: 10, depth: 2, normal: 3, radius: 4 },
} as const;

/** Contact shadows: the march's length, the thickness behind a depth, and the bias, in meters. */
export const CONTACT = { length: 0.3, thickness: 0.15, bias: 0.02 } as const;

type Vec3 = [number, number, number];

function normalize(v: readonly number[]): Vec3 {
	const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
	return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Column-major 4 x 4 matrices. */
function multiply(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
			out[c * 4 + r] = sum;
		}
	return out;
}

function lookAt(eye: Vec3, target: Vec3): Float32Array {
	const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
	const x = normalize(cross([0, 1, 0], z));
	const y = cross(z, x);
	return new Float32Array([
		x[0],
		y[0],
		z[0],
		0,
		x[1],
		y[1],
		z[1],
		0,
		x[2],
		y[2],
		z[2],
		0,
		-dot(x, eye),
		-dot(y, eye),
		-dot(z, eye),
		1,
	]);
}

/** A perspective projection with reversed depth: 1 at the near plane, 0 at the far plane. */
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
	const f = 1 / Math.tan(fovY / 2);
	return new Float32Array([
		f / aspect,
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		near / (far - near),
		-1,
		0,
		0,
		(far * near) / (far - near),
		0,
	]);
}

/** The sizes of one set of targets. */
export interface Sizes {
	width: number;
	height: number;
	aoWidth: number;
	aoHeight: number;
}

export function sizesFor(width: number, height: number, aoScale: number): Sizes {
	return {
		width,
		height,
		aoWidth: Math.max(1, Math.round(width * aoScale)),
		aoHeight: Math.max(1, Math.round(height * aoScale)),
	};
}

/** Bytes of the scene's uniform block and of the AO passes' uniform block. */
export const SCENE_BYTES = 64 * 4;
export const AO_BYTES = 28 * 4;

/**
 * The uniform data for a set of sizes. `rowSign` is 1 where texture rows count from the top
 * (WebGPU) and -1 where they count from the bottom (WebGL2). `showAo` shows the occlusion alone.
 */
export function uniforms(
	sizes: Sizes,
	rowSign: number,
	showAo: boolean,
	samples: number,
): { scene: Float32Array; ao: Float32Array } {
	const aspect = sizes.width / sizes.height;
	const fovY = (CAMERA.fovDegrees * Math.PI) / 180;
	const view = lookAt([...CAMERA.position] as Vec3, [...CAMERA.target] as Vec3);
	const projection = perspective(fovY, aspect, CAMERA.near, CAMERA.far);
	const sun: Vec3 = [
		(view[0] as number) * SUN[0] + (view[4] as number) * SUN[1] + (view[8] as number) * SUN[2],
		(view[1] as number) * SUN[0] + (view[5] as number) * SUN[1] + (view[9] as number) * SUN[2],
		(view[2] as number) * SUN[0] + (view[6] as number) * SUN[1] + (view[10] as number) * SUN[2],
	];
	const scene = new Float32Array(SCENE_BYTES / 4);
	scene.set(multiply(projection, view), 0);
	scene.set(view, 16);
	scene.set(projection, 32);
	scene.set([...sun, SUN_STRENGTH], 48);
	scene.set([CAMERA.near, CAMERA.far, sizes.width, sizes.height], 52);
	scene.set([rowSign, showAo ? 1 : 0, sizes.aoWidth, sizes.aoHeight], 56);
	scene.set([CONTACT.length, CONTACT.thickness, CONTACT.bias, 0], 60);
	const tanY = Math.tan(fovY / 2);
	const s = AO_SETTINGS;
	const ao = new Float32Array(AO_BYTES / 4);
	ao.set([CAMERA.near, CAMERA.far, rowSign, samples], 0);
	ao.set([sizes.aoWidth, sizes.aoHeight, sizes.width, sizes.height], 4);
	ao.set([tanY * aspect, tanY, (0.5 * sizes.aoHeight) / tanY, s.radius], 8);
	ao.set([s.intensity, s.power, s.bias, s.thickness], 12);
	ao.set([s.three.radius, s.three.thickness, s.three.exponent, s.three.falloff], 16);
	ao.set([s.three.scale, s.three.slices, s.three.steps, 0], 20);
	ao.set([s.denoise.luma, s.denoise.depth, s.denoise.normal, s.denoise.radius], 24);
	return { scene, ao };
}

/** The middle of some numbers. */
export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Rows of RGBA pixels from the top as a PNG, base64. */
export async function pngBase64(
	pixels: Uint8Array,
	width: number,
	height: number,
): Promise<string> {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2D context for the PNG');
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** The interface that both renderers give the page. */
export interface Renderer {
	readonly tier: 'webgpu' | 'webgl2';
	/** The adapter's or the context's description. */
	readonly info: Record<string, unknown>;
	/** The GPU timer: WebGPU's timestamp queries, WebGL2's timer queries, or none. */
	readonly timer: 'timestamps' | 'timer-query' | null;
	/** Whether the copy path needs a pass that resolves the multisampled depth first. */
	readonly resolvesDepth: boolean;
	/** Makes the targets for these sizes, after the last ones. */
	resize(sizes: Sizes): void;
	/** Writes the uniforms for showing the occlusion alone or the shaded scene. */
	setShowAo(showAo: boolean): void;
	/** Builds every pipeline that these passes need, and waits until they are ready. */
	prepare(passes: readonly Pass[]): Promise<void>;
	/**
	 * Draws `frames` frames of the passes back to back, waits until the GPU has finished them, and
	 * returns the time in milliseconds, with the part of it that issuing the commands took. Where
	 * issuing takes most of the time, the CPU limits the batch, not the GPU.
	 */
	throughput(passes: readonly Pass[], frames: number): Promise<{ ms: number; issueMs: number }>;
	/**
	 * Draws `frames` frames one at a time, each waited for, with the GPU timer: the mean GPU time
	 * per frame from its first pass's beginning to its last pass's end, and of each pass by its key.
	 * Null without a GPU timer.
	 */
	timed(
		passes: readonly Pass[],
		frames: number,
	): Promise<{ frameMs: number; passMs: Record<string, number> } | null>;
	/** Draws one frame and reads it back: RGBA rows from the top. */
	picture(passes: readonly Pass[]): Promise<Uint8Array>;
	destroy(): void;
}
