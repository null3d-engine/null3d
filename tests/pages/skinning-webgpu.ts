// The skinning measurement page on WebGPU, the twin of the WebGL2 page `skinning.ts`. It draws the
// skinning scene of `lib/skinning.ts` in two ways, and times both in turns:
// - vertex-shader: every shadow cascade and the main pass skin each character in the vertex shader,
//   which reads four joint matrices from a float texture per vertex.
// - compute: one compute pass skins each character that some pass draws into a buffer of
//   positions and normals. The cascades and the main pass draw that buffer as plain vertices.
// Both paths cull the characters per pass on the CPU and upload the joint matrices each frame to
// the float texture that the vertex shaders, or the compute pass, read, as the engine does.
// The page first draws one pose both ways and compares the two images. Then each path draws frames
// back to back in timed batches, each frame in a submit of its own, and each batch ends when the
// GPU has finished its last frame. The paths take turns, so heat affects both alike. Where the
// adapter has timestamp queries, each batch also records the GPU's time from its first pass to
// its last. Switches: ?characters=, ?cascades=, ?rounds=, ?warmup= (milliseconds) and ?gpu=compat,
// which asks for a compatibility mode adapter. The page uses no engine code: it measures which
// design the engine builds.
import { progress, run } from './lib/result';
import {
	type Cascade,
	cameraView,
	characterMesh,
	compareImages,
	cullCharacters,
	fitCascades,
	indexRanges,
	JOINT_FLOATS,
	MAX_CASCADES,
	type PathTiming,
	poseCharacters,
	quartiles,
	SKINNING,
	type SkinningPath,
	type SkinningResult,
	skinningPaths,
} from './lib/skinning';
import { REST_WORDS, SKIN_WORKGROUP, SKINNED_WORDS, SKINNING_WGSL } from './lib/skinning-wgsl';

const params = new URLSearchParams(location.search);
const characters = Number(params.get('characters') ?? 100);
const cascadeCount = Math.min(MAX_CASCADES, Math.max(1, Number(params.get('cascades') ?? 3)));
const rounds = Number(params.get('rounds') ?? SKINNING.rounds);
const warmUpMs = Number(params.get('warmup') ?? SKINNING.warmUpMs);
const compat = params.get('gpu') === 'compat';
const [width, height] = SKINNING.size;
const PATHS = skinningPaths('webgpu');

/** The characters' color and the ground's. */
const CHARACTER_ALBEDO = [0.8, 0.45, 0.3] as const;
const GROUND_ALBEDO = [0.35, 0.5, 0.35] as const;
/** Half the ground's width, in meters. */
const GROUND = 80;
/** Bytes between the uniform blocks of one buffer: WebGPU's offset alignment. */
const UNIFORM_STRIDE = 256;
/** Bytes of the lit surface's uniform block, as `skinning-wgsl.ts` lays it out. */
const LIT_BYTES = 352;
const COLOR_FORMAT: GPUTextureFormat = 'rgba8unorm';
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
const SHADOW_FORMAT: GPUTextureFormat = 'depth32float';

const { VERTEX, FRAGMENT, COMPUTE } = GPUShaderStage;

/** The vertex buffers of the rest mesh with each character's number per instance. */
const SKIN_BUFFERS: GPUVertexBufferLayout[] = [
	{
		arrayStride: REST_WORDS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x3' },
			{ shaderLocation: 1, offset: 12, format: 'float32x3' },
			{ shaderLocation: 2, offset: 24, format: 'uint8x4' },
			{ shaderLocation: 3, offset: 28, format: 'float32x4' },
		],
	},
	{
		arrayStride: 4,
		stepMode: 'instance',
		attributes: [{ shaderLocation: 4, offset: 0, format: 'uint32' }],
	},
];

/** The vertex buffer of skinned vertices, and of the ground. */
const PLAIN_BUFFERS: GPUVertexBufferLayout[] = [
	{
		arrayStride: SKINNED_WORDS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x3' },
			{ shaderLocation: 1, offset: 12, format: 'float32x3' },
		],
	},
];

/** The scene on the GPU, and a frame of each path. */
class SkinningRenderer {
	readonly mesh = characterMesh();
	private readonly indexCount = this.mesh.indices.length;
	private readonly main = cameraView(width / height);
	private readonly cascades: Cascade[] = fitCascades(cascadeCount, width / height);
	readonly jointData = new Float32Array(characters * SKINNING.joints * JOINT_FLOATS);
	readonly target: GPUTexture;
	private readonly targetView: GPUTextureView;
	private readonly depthView: GPUTextureView;
	private readonly shadowLayers: GPUTextureView[];
	private readonly jointTexture: GPUTexture;
	private readonly restVertices: GPUBuffer;
	private readonly restIndices: GPUBuffer;
	private readonly slotIndices: GPUBuffer;
	private readonly skinned: GPUBuffer;
	private readonly ground: GPUBuffer;
	private readonly groundIndices: GPUBuffer;
	/** The characters that each pass draws, or on the compute path, those it skins. */
	private readonly instances: GPUBuffer;
	private readonly skinParams: GPUBuffer;
	private readonly skinParamWords = new Uint32Array(2);
	private readonly pipelines: {
		skinnedDepth: GPURenderPipeline;
		skinnedShaded: GPURenderPipeline;
		plainDepth: GPURenderPipeline;
		plainShaded: GPURenderPipeline;
		skinOnce: GPUComputePipeline;
	};
	/** Each pass's matrix: the main pass's, then each cascade's, for plain and skinning pipelines. */
	private readonly passGroups: GPUBindGroup[] = [];
	private readonly skinPassGroups: GPUBindGroup[] = [];
	private readonly characterLit: GPUBindGroup;
	private readonly groundLit: GPUBindGroup;
	private readonly skinGroup: GPUBindGroup;
	/**
	 * The characters that each pass draws, the main pass first, then the cascades, then those that
	 * some pass draws, which the compute pass skins.
	 */
	private readonly lists = new Uint32Array((MAX_CASCADES + 2) * characters);
	private readonly starts = new Int32Array(MAX_CASCADES + 2);
	readonly drawnCounts = new Int32Array(MAX_CASCADES + 2);
	/** Each character's slot in the skinned buffer, or -1 when no pass draws it. */
	private readonly slotOf = new Int32Array(characters);
	private readonly rangeCounts = new Int32Array(characters);
	private readonly rangeOffsets = new Int32Array(characters);
	/** Where the next frame's first pass and last pass write their timestamps, if anywhere. */
	timestamps: { set: GPUQuerySet; first: boolean; last: boolean } | null = null;

	constructor(private readonly device: GPUDevice) {
		const { mesh } = this;
		const buffer = (usage: number, data: ArrayBufferView | number) => {
			const size = typeof data === 'number' ? data : data.byteLength;
			const b = device.createBuffer({
				size: Math.ceil(size / 4) * 4,
				usage: usage | GPUBufferUsage.COPY_DST,
			});
			if (typeof data !== 'number') device.queue.writeBuffer(b, 0, data.buffer, 0, size);
			return b;
		};

		// The rest mesh, interleaved, which the vertex shaders read as vertices and the compute pass
		// as storage.
		const rest = new Float32Array(mesh.vertexCount * REST_WORDS);
		const restWords = new Uint32Array(rest.buffer);
		const jointWords = new Uint32Array(mesh.joints.buffer);
		for (let v = 0; v < mesh.vertexCount; v++) {
			const at = v * REST_WORDS;
			rest.set(mesh.positions.subarray(v * 3, v * 3 + 3), at);
			rest.set(mesh.normals.subarray(v * 3, v * 3 + 3), at + 3);
			restWords[at + 6] = jointWords[v] as number;
			rest.set(mesh.weights.subarray(v * 4, v * 4 + 4), at + 7);
		}
		this.restVertices = buffer(GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE, rest);
		this.restIndices = buffer(GPUBufferUsage.INDEX, mesh.indices);
		// The skinned buffer holds each character at a slot, so one index buffer covers every slot.
		const slotIndices = new Uint32Array(characters * this.indexCount);
		for (let slot = 0; slot < characters; slot++)
			for (let i = 0; i < this.indexCount; i++)
				slotIndices[slot * this.indexCount + i] =
					slot * mesh.vertexCount + (mesh.indices[i] as number);
		this.slotIndices = buffer(GPUBufferUsage.INDEX, slotIndices);
		this.skinned = buffer(
			GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
			characters * mesh.vertexCount * SKINNED_WORDS * 4,
		);
		const g = GROUND;
		this.ground = buffer(
			GPUBufferUsage.VERTEX,
			new Float32Array([
				...[-g, 0, -g, 0, 1, 0],
				...[-g, 0, g, 0, 1, 0],
				...[g, 0, g, 0, 1, 0],
				...[g, 0, -g, 0, 1, 0],
			]),
		);
		this.groundIndices = buffer(GPUBufferUsage.INDEX, new Uint16Array([0, 1, 2, 0, 2, 3]));
		this.instances = buffer(GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE, this.lists.byteLength);
		this.skinParams = buffer(GPUBufferUsage.UNIFORM, 16);
		this.jointTexture = device.createTexture({
			size: [SKINNING.joints * 3, characters],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		this.target = device.createTexture({
			size: [width, height],
			format: COLOR_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		this.targetView = this.target.createView();
		this.depthView = device
			.createTexture({
				size: [width, height],
				format: DEPTH_FORMAT,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			})
			.createView();
		const size = SKINNING.shadowMapSize;
		const shadowMap = device.createTexture({
			size: [size, size, cascadeCount],
			format: SHADOW_FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			// Compatibility mode fixes a texture's binding dimension when it is made.
			...({ textureBindingViewDimension: '2d-array' } as object),
		});
		this.shadowLayers = this.cascades.map((_, layer) =>
			shadowMap.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
		);

		const layout = (entries: GPUBindGroupLayoutEntry[]) =>
			device.createBindGroupLayout({ entries });
		const passLayout = layout([{ binding: 0, visibility: VERTEX, buffer: {} }]);
		const skinPassLayout = layout([
			{ binding: 0, visibility: VERTEX, buffer: {} },
			{ binding: 1, visibility: VERTEX, texture: { sampleType: 'unfilterable-float' } },
		]);
		const litLayout = layout([
			{ binding: 0, visibility: FRAGMENT, buffer: {} },
			{
				binding: 1,
				visibility: FRAGMENT,
				texture: { sampleType: 'depth', viewDimension: '2d-array' },
			},
			{ binding: 2, visibility: FRAGMENT, sampler: { type: 'comparison' } },
		]);
		const storage = (binding: number, type: GPUBufferBindingType = 'read-only-storage') => ({
			binding,
			visibility: COMPUTE,
			buffer: { type },
		});
		const skinLayout = layout([
			storage(0),
			{ binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
			storage(2),
			storage(3, 'storage'),
			{ binding: 4, visibility: COMPUTE, buffer: {} },
		]);

		const module = (code: string) => device.createShaderModule({ code });
		const render = (
			code: string,
			groups: GPUBindGroupLayout[],
			buffers: GPUVertexBufferLayout[],
			shaded: boolean,
		) => {
			const shader = module(code);
			return device.createRenderPipeline({
				layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
				vertex: { module: shader, entryPoint: 'main', buffers },
				fragment: shaded
					? { module: shader, entryPoint: 'litMain', targets: [{ format: COLOR_FORMAT }] }
					: undefined,
				primitive: { topology: 'triangle-list', cullMode: shaded ? 'back' : 'none' },
				depthStencil: shaded
					? { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' }
					: {
							format: SHADOW_FORMAT,
							depthWriteEnabled: true,
							depthCompare: 'less',
							depthBias: 2,
							depthBiasSlopeScale: 2,
						},
			});
		};
		const W = SKINNING_WGSL;
		this.pipelines = {
			skinnedDepth: render(W.skinnedDepth, [skinPassLayout], SKIN_BUFFERS, false),
			skinnedShaded: render(W.skinnedShaded, [skinPassLayout, litLayout], SKIN_BUFFERS, true),
			plainDepth: render(W.plainDepth, [passLayout], PLAIN_BUFFERS, false),
			plainShaded: render(W.plainShaded, [passLayout, litLayout], PLAIN_BUFFERS, true),
			skinOnce: device.createComputePipeline({
				layout: device.createPipelineLayout({ bindGroupLayouts: [skinLayout] }),
				compute: { module: module(W.skinOnce), entryPoint: 'main' },
			}),
		};

		// The passes' matrices, the main pass's first.
		const views = [this.main, ...this.cascades];
		const passes = buffer(GPUBufferUsage.UNIFORM, views.length * UNIFORM_STRIDE);
		const jointView = this.jointTexture.createView();
		views.forEach((view, k) => {
			device.queue.writeBuffer(passes, k * UNIFORM_STRIDE, view.viewProj);
			const resource = { buffer: passes, offset: k * UNIFORM_STRIDE, size: 64 };
			this.passGroups.push(
				device.createBindGroup({ layout: passLayout, entries: [{ binding: 0, resource }] }),
			);
			this.skinPassGroups.push(
				device.createBindGroup({
					layout: skinPassLayout,
					entries: [
						{ binding: 0, resource },
						{ binding: 1, resource: jointView },
					],
				}),
			);
		});

		// The lit surface, once with the characters' color and once with the ground's.
		const lit = buffer(GPUBufferUsage.UNIFORM, 2 * Math.ceil(LIT_BYTES / 256) * 256);
		const shadowView = shadowMap.createView({ dimension: '2d-array' });
		const shadowSampler = device.createSampler({
			compare: 'less-equal',
			magFilter: 'linear',
			minFilter: 'linear',
		});
		const litGroup = (albedo: readonly number[], offset: number) => {
			device.queue.writeBuffer(lit, offset, this.litBlock(albedo));
			return device.createBindGroup({
				layout: litLayout,
				entries: [
					{ binding: 0, resource: { buffer: lit, offset, size: LIT_BYTES } },
					{ binding: 1, resource: shadowView },
					{ binding: 2, resource: shadowSampler },
				],
			});
		};
		this.characterLit = litGroup(CHARACTER_ALBEDO, 0);
		this.groundLit = litGroup(GROUND_ALBEDO, Math.ceil(LIT_BYTES / 256) * 256);
		this.skinGroup = device.createBindGroup({
			layout: skinLayout,
			entries: [
				{ binding: 0, resource: { buffer: this.restVertices } },
				{ binding: 1, resource: jointView },
				{ binding: 2, resource: { buffer: this.instances } },
				{ binding: 3, resource: { buffer: this.skinned } },
				{ binding: 4, resource: { buffer: this.skinParams } },
			],
		});
	}

	/** The lit surface's uniform block, laid out as `skinning-wgsl.ts` declares it. */
	private litBlock(albedo: readonly number[]): Float32Array {
		const block = new Float32Array(LIT_BYTES / 4);
		this.cascades.forEach((cascade, i) => {
			block.set(cascade.viewProj, i * 16);
			block[64 + i] = cascade.end;
			block[68 + i] = cascade.texel;
		});
		for (let i = this.cascades.length; i < MAX_CASCADES; i++) block[64 + i] = 1e30;
		const { main } = this;
		block.set(main.eye, 72);
		new Int32Array(block.buffer)[75] = cascadeCount;
		block.set(main.forward, 76);
		const light = SKINNING.light.map((v) => -v);
		const length = Math.hypot(...light);
		block.set(
			light.map((v) => v / length),
			80,
		);
		block.set(albedo, 84);
		return block;
	}

	/**
	 * Culls the characters for each pass into the lists. With `skinOnce`, it also lists the
	 * characters that some pass draws, gives each its slot in the skinned buffer, and uploads that
	 * list; otherwise it uploads the passes' lists. It returns the characters to skin once.
	 */
	private cull(skinOnce: boolean): number {
		const { device, lists, starts, drawnCounts: drawn, slotOf } = this;
		let at = 0;
		const views = 1 + cascadeCount;
		for (let v = 0; v < views; v++) {
			starts[v] = at;
			drawn[v] = cullCharacters(v === 0 ? this.main : this.cascades[v - 1]!, characters, lists, at);
			at += drawn[v]!;
		}
		if (!skinOnce) {
			if (at > 0) device.queue.writeBuffer(this.instances, 0, lists.buffer, 0, at * 4);
			return 0;
		}
		// Marks each character that some pass draws, then numbers the marked ones in order.
		slotOf.fill(-1);
		for (let i = 0; i < at; i++) slotOf[lists[i]!] = 0;
		let skinned = 0;
		for (let c = 0; c < characters; c++)
			if (slotOf[c] === 0) {
				slotOf[c] = skinned;
				lists[at + skinned++] = c;
			}
		starts[views] = at;
		drawn[views] = skinned;
		if (skinned > 0) device.queue.writeBuffer(this.instances, 0, lists.buffer, at * 4, skinned * 4);
		return skinned;
	}

	/** Draws the characters of pass `v` from the skinned buffer, in as few ranges as it can. */
	private drawSkinned(pass: GPURenderPassEncoder, v: number): void {
		const { rangeCounts, rangeOffsets } = this;
		const ranges = indexRanges(
			this.lists,
			this.starts[v]!,
			this.drawnCounts[v]!,
			this.slotOf,
			this.indexCount,
			rangeCounts,
			rangeOffsets,
		);
		pass.setVertexBuffer(0, this.skinned);
		pass.setIndexBuffer(this.slotIndices, 'uint32');
		for (let r = 0; r < ranges; r++) pass.drawIndexed(rangeCounts[r]!, 1, rangeOffsets[r]! / 4);
	}

	/** Draws the characters of pass `v` from the rest mesh, skinning them in the vertex shader. */
	private drawRest(pass: GPURenderPassEncoder, v: number): void {
		pass.setVertexBuffer(0, this.restVertices);
		pass.setVertexBuffer(1, this.instances, this.starts[v]! * 4);
		pass.setIndexBuffer(this.restIndices, 'uint16');
		pass.drawIndexed(this.indexCount, this.drawnCounts[v]!);
	}

	/** The timestamp writes of a pass that is the frame's first, its last, or both. */
	private stamps(first: boolean, last: boolean): GPURenderPassTimestampWrites | undefined {
		const t = this.timestamps;
		if (!t || !((first && t.first) || (last && t.last))) return undefined;
		return {
			querySet: t.set,
			...(first && t.first ? { beginningOfPassWriteIndex: 0 } : {}),
			...(last && t.last ? { endOfPassWriteIndex: 1 } : {}),
		};
	}

	/** Records and submits one frame on `path` with the joint matrices that `jointData` holds now. */
	frame(path: SkinningPath): void {
		const { device, pipelines, drawnCounts: drawn } = this;
		const skinOnce = path === 'compute';
		device.queue.writeTexture(
			{ texture: this.jointTexture },
			this.jointData,
			{ bytesPerRow: SKINNING.joints * 3 * 16 },
			[SKINNING.joints * 3, characters],
		);
		const skinned = this.cull(skinOnce);
		const encoder = device.createCommandEncoder();

		if (skinOnce && skinned > 0) {
			this.skinParamWords[0] = this.mesh.vertexCount;
			this.skinParamWords[1] = skinned * this.mesh.vertexCount;
			device.queue.writeBuffer(this.skinParams, 0, this.skinParamWords);
			const pass = encoder.beginComputePass({ timestampWrites: this.stamps(true, false) });
			pass.setPipeline(pipelines.skinOnce);
			pass.setBindGroup(0, this.skinGroup);
			pass.dispatchWorkgroups(Math.ceil((skinned * this.mesh.vertexCount) / SKIN_WORKGROUP));
			pass.end();
		}

		const depth = skinOnce ? pipelines.plainDepth : pipelines.skinnedDepth;
		for (let k = 0; k < cascadeCount; k++) {
			const pass = encoder.beginRenderPass({
				colorAttachments: [],
				depthStencilAttachment: {
					view: this.shadowLayers[k]!,
					depthClearValue: 1,
					depthLoadOp: 'clear',
					depthStoreOp: 'store',
				},
				timestampWrites: this.stamps(k === 0 && !(skinOnce && skinned > 0), false),
			});
			pass.setPipeline(depth);
			pass.setBindGroup(0, (skinOnce ? this.passGroups : this.skinPassGroups)[k + 1]!);
			if (drawn[k + 1]! > 0) {
				if (skinOnce) this.drawSkinned(pass, k + 1);
				else this.drawRest(pass, k + 1);
			}
			pass.end();
		}

		const main = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.targetView,
					clearValue: { r: 0.55, g: 0.7, b: 0.9, a: 1 },
					loadOp: 'clear',
					storeOp: 'store',
				},
			],
			depthStencilAttachment: {
				view: this.depthView,
				depthClearValue: 1,
				depthLoadOp: 'clear',
				depthStoreOp: 'discard',
			},
			timestampWrites: this.stamps(false, true),
		});
		main.setPipeline(pipelines.plainShaded);
		main.setBindGroup(0, this.passGroups[0]!);
		main.setBindGroup(1, this.groundLit);
		main.setVertexBuffer(0, this.ground);
		main.setIndexBuffer(this.groundIndices, 'uint16');
		main.drawIndexed(6);
		if (drawn[0]! > 0) {
			main.setBindGroup(1, this.characterLit);
			if (skinOnce) {
				this.drawSkinned(main, 0);
			} else {
				main.setPipeline(pipelines.skinnedShaded);
				main.setBindGroup(0, this.skinPassGroups[0]!);
				this.drawRest(main, 0);
			}
		}
		main.end();
		device.queue.submit([encoder.finish()]);
	}

	/** Characters drawn by each pass in the last frame, and those skinned once, if that path drew. */
	passCounts(): { drawn: number[]; skinned: number } {
		const drawn = Array.from(this.drawnCounts.subarray(0, 1 + cascadeCount));
		return { drawn, skinned: this.drawnCounts[1 + cascadeCount]! };
	}

	/** Vertices skinned per frame on `path`, from the last frame's counts. */
	skinnedVertices(path: SkinningPath): number {
		const { drawn, skinned } = this.passCounts();
		const characterSkins =
			path === 'compute' ? skinned : drawn.reduce((sum, count) => sum + count, 0);
		return characterSkins * this.mesh.vertexCount;
	}
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

run('skinning-webgpu', async (): Promise<SkinningResult & Record<string, unknown>> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.width = width;
	canvas.height = height;
	if (!navigator.gpu) throw new Error('no WebGPU adapter: the browser has no navigator.gpu');
	const adapter = await navigator.gpu.requestAdapter({
		powerPreference: 'high-performance',
		...(compat ? ({ featureLevel: 'compatibility' } as object) : {}),
	});
	if (!adapter) throw new Error('no WebGPU adapter');
	const timed = adapter.features.has('timestamp-query');
	const device = await adapter.requestDevice({
		requiredFeatures: timed ? ['timestamp-query'] : [],
	});
	let deviceError: string | undefined;
	device.addEventListener('uncapturederror', (event) => {
		deviceError ??= (event as GPUUncapturedErrorEvent).error.message;
	});
	const context = canvas.getContext('webgpu');
	if (!context) throw new Error('no WebGPU context for the canvas');
	context.configure({
		device,
		format: COLOR_FORMAT,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		alphaMode: 'opaque',
	});
	const renderer = new SkinningRenderer(device);
	progress(`built the scene: ${characters} characters, ${cascadeCount} cascades`);
	const failed = () => {
		if (deviceError) throw new Error(`WebGPU error: ${deviceError}`);
	};

	/** Reads the frame's color back as RGBA bytes, rows top first. */
	const readImage = async (): Promise<Uint8Array> => {
		const read = device.createBuffer({
			size: width * height * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{ texture: renderer.target },
			{ buffer: read, bytesPerRow: width * 4 },
			[width, height],
		);
		device.queue.submit([encoder.finish()]);
		await read.mapAsync(GPUMapMode.READ);
		const image = new Uint8Array(read.getMappedRange().slice(0));
		read.destroy();
		return image;
	};
	const present = () => {
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToTexture(
			{ texture: renderer.target },
			{ texture: context.getCurrentTexture() },
			[width, height],
		);
		device.queue.submit([encoder.finish()]);
	};

	// One pose, drawn both ways.
	poseCharacters(renderer.jointData, characters, SKINNING.checkTime);
	const images: Uint8Array[] = [];
	for (const path of PATHS) {
		renderer.frame(path);
		images.push(await readImage());
	}
	failed();
	const image = compareImages(images[0]!, images[1]!);
	const counts = renderer.passCounts();
	progress(`image check: ${image.differing} of ${image.pixels} pixels differ`);

	// Each batch's timestamps: its first pass's start and its last pass's end, in nanoseconds.
	const stampSet = timed ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
	const stampResolve = timed
		? device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
			})
		: null;
	const stampRead = timed
		? device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
		: null;

	/** The GPU's milliseconds from the last batch's first pass to its last, or null. */
	const batchGpuMs = async (): Promise<number | null> => {
		if (!stampSet || !stampResolve || !stampRead) return null;
		const encoder = device.createCommandEncoder();
		encoder.resolveQuerySet(stampSet, 0, 2, stampResolve, 0);
		encoder.copyBufferToBuffer(stampResolve, 0, stampRead, 0, 16);
		device.queue.submit([encoder.finish()]);
		await stampRead.mapAsync(GPUMapMode.READ);
		const [start = 0n, end = 0n] = new BigUint64Array(stampRead.getMappedRange());
		stampRead.unmap();
		return end > start ? Number(end - start) / 1e6 : null;
	};

	/**
	 * Draws `frames` frames of `path` back to back; returns ms per frame, CPU ms per frame, and the
	 * GPU's ms per frame where it has timestamps.
	 */
	const batch = async (path: SkinningPath, frames: number) => {
		poseCharacters(renderer.jointData, characters, performance.now() / 1000);
		const start = performance.now();
		let cpu = 0;
		for (let i = 0; i < frames; i++) {
			renderer.timestamps = stampSet
				? { set: stampSet, first: i === 0, last: i === frames - 1 }
				: null;
			const before = performance.now();
			renderer.frame(path);
			cpu += performance.now() - before;
		}
		renderer.timestamps = null;
		await device.queue.onSubmittedWorkDone();
		const ms = (performance.now() - start) / frames;
		const gpu = await batchGpuMs();
		present();
		return { ms, cpu: cpu / frames, gpu: gpu === null ? null : gpu / frames };
	};

	const batchFrames: Record<string, number> = {};
	const warmUp: Record<string, number[]> = { [PATHS[0]]: [], [PATHS[1]]: [] };
	const warmUntil = performance.now() + warmUpMs;
	for (let turn = 0; performance.now() < warmUntil || turn < 2; turn++) {
		const path = PATHS[turn % 2]!;
		await nextFrame();
		warmUp[path]!.push((await batch(path, 1)).ms);
	}
	for (const path of PATHS) {
		const single = quartiles(warmUp[path]!)[1];
		batchFrames[path] = Math.max(
			1,
			Math.min(SKINNING.maxBatchFrames, Math.round(SKINNING.batchMs / Math.max(single, 0.1))),
		);
	}
	progress(`warmed up: ${batchFrames[PATHS[0]]} and ${batchFrames[PATHS[1]]} frames a batch`);

	const samples: Record<string, { ms: number[]; cpu: number[]; gpu: number[] }> = {
		[PATHS[0]]: { ms: [], cpu: [], gpu: [] },
		[PATHS[1]]: { ms: [], cpu: [], gpu: [] },
	};
	for (let round = 0; round < rounds; round++) {
		for (const path of round % 2 === 0 ? PATHS : [...PATHS].reverse()) {
			await nextFrame();
			const { ms, cpu, gpu } = await batch(path, batchFrames[path]!);
			const sample = samples[path]!;
			sample.ms.push(ms);
			sample.cpu.push(cpu);
			if (gpu !== null) sample.gpu.push(gpu);
		}
		progress(`round ${round + 1} of ${rounds}`);
	}
	failed();

	const timing = (path: SkinningPath): PathTiming => {
		const sample = samples[path]!;
		const [low, middle, high] = quartiles(sample.ms);
		return {
			frameMs: middle,
			frameMsQuartiles: [low, high],
			cpuMs: quartiles(sample.cpu)[1],
			gpuMs: sample.gpu.length > 0 ? quartiles(sample.gpu)[1] : null,
			batchFrames: batchFrames[path]!,
			batches: sample.ms.length,
			skinnedVertices: renderer.skinnedVertices(path),
		};
	};
	return {
		gpu: 'webgpu',
		compatibilityMode: compat,
		adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture },
		characters,
		cascades: cascadeCount,
		size: SKINNING.size,
		vertices: renderer.mesh.vertexCount,
		joints: SKINNING.joints,
		multiDraw: false,
		gpuTimer: timed,
		drawn: counts.drawn,
		skinned: counts.skinned,
		image,
		paths: Object.fromEntries(PATHS.map((path) => [path, timing(path)])),
	};
});
