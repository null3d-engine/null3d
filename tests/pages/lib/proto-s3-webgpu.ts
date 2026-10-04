// Prototype S3 (not for merging): the AO prototype page's WebGPU renderer. It draws the passes of
// `proto-s3-scene.ts` with WebGPU calls of its own and the prototype's shaders from the engine's
// shader build. Every pass is a render pass of its own, so timestamp queries can time it alone.
import { SHADERS } from '../../../packages/engine/src/generated/shaders';
import {
	AO_BYTES,
	type AoInput,
	boxMesh,
	INSTANCE_FLOATS,
	type Mesh,
	type Pass,
	passKey,
	type Renderer,
	SCENE_BYTES,
	type Sizes,
	sceneInstances,
	sphereMesh,
	uniforms,
} from './proto-s3-scene';

const COLOR: GPUTextureFormat = 'rgba8unorm';
const DEPTH: GPUTextureFormat = 'depth32float';
const { RENDER_ATTACHMENT, TEXTURE_BINDING, COPY_SRC } = GPUTextureUsage;
/** Timestamps that one batch writes at most: two per pass. */
const MAX_QUERIES = 4096;

interface Drawn {
	vertices: GPUBuffer;
	indices: GPUBuffer;
	count: number;
	instances: GPUBuffer;
	instanceCount: number;
}

interface Targets {
	sizes: Sizes;
	color: GPUTexture | null;
	depth: GPUTexture;
	frame: GPUTexture;
	copied: GPUTexture;
	structure: GPUTexture;
	structureDepth: GPUTexture;
	raw: GPUTexture;
	across: GPUTexture;
	final: GPUTexture;
	horizons: GPUTexture;
	groups: Map<string, GPUBindGroup>;
}

export async function createWebGPURenderer(
	samples: number,
	copyFormat: GPUTextureFormat,
	grid: number,
): Promise<Renderer> {
	const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const timestamps = adapter.features.has('timestamp-query');
	const device = await adapter.requestDevice({
		requiredFeatures: timestamps ? ['timestamp-query'] : [],
	});
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) =>
		errors.push((event as GPUUncapturedErrorEvent).error.message),
	);
	const info = adapter.info;
	const sceneShader = SHADERS.proto_s3_scene;
	const aoShader = SHADERS.proto_s3_ao.webgpu?.wgsl;
	const aoMsShader = SHADERS.proto_s3_ao_ms.webgpu?.wgsl;
	if (!aoShader || !aoMsShader) throw new Error('the prototype shaders have no WebGPU build');
	const aoModule = device.createShaderModule({ code: aoShader.source, label: 'proto ao' });
	const aoMsModule = device.createShaderModule({ code: aoMsShader.source, label: 'proto ao ms' });
	const sceneModules = new Map<string, GPUShaderModule>();
	const sceneModule = (variant: string): GPUShaderModule => {
		let module = sceneModules.get(variant);
		if (!module) {
			const wgsl = (sceneShader as Record<string, { wgsl: { source: string } | null }>)[
				`webgpu_${variant}`
			]?.wgsl;
			if (!wgsl) throw new Error(`no scene variant ${variant}`);
			module = device.createShaderModule({ code: wgsl.source, label: `proto scene ${variant}` });
			sceneModules.set(variant, module);
		}
		return module;
	};

	const { VERTEX, FRAGMENT } = GPUShaderStage;
	const sceneLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: VERTEX | FRAGMENT, buffer: {} },
			{ binding: 1, visibility: FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 3, visibility: FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		],
	});
	const copyLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: FRAGMENT, buffer: {} },
			{
				binding: 1,
				visibility: FRAGMENT,
				texture: { sampleType: 'unfilterable-float', multisampled: samples > 1 },
			},
		],
	});
	const aoLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: FRAGMENT, buffer: {} },
			{ binding: 2, visibility: FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 3, visibility: FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		],
	});
	const pipelineLayout = (layout: GPUBindGroupLayout) =>
		device.createPipelineLayout({ bindGroupLayouts: [layout] });
	const scenePipelineLayout = pipelineLayout(sceneLayout);
	const copyPipelineLayout = pipelineLayout(copyLayout);
	const aoPipelineLayout = pipelineLayout(aoLayout);

	const buffer = (data: ArrayBufferView, usage: number) => {
		const made = device.createBuffer({ size: Math.ceil(data.byteLength / 4) * 4, usage });
		device.queue.writeBuffer(made, 0, data.buffer, data.byteOffset, data.byteLength);
		return made;
	};
	const drawn = (mesh: Mesh, instances: Float32Array): Drawn => ({
		vertices: buffer(mesh.vertices, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
		indices: buffer(mesh.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST),
		count: mesh.indices.length,
		instances: buffer(instances, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
		instanceCount: instances.length / INSTANCE_FLOATS,
	});
	const placed = sceneInstances(grid);
	const meshes = [drawn(sphereMesh(), placed.spheres), drawn(boxMesh(), placed.boxes)];
	const sceneUniforms = device.createBuffer({
		size: SCENE_BYTES,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const aoUniforms = device.createBuffer({
		size: AO_BYTES,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
	const blank = device.createTexture({
		label: 'blank',
		size: [1, 1],
		format: 'rg16float',
		usage: TEXTURE_BINDING | RENDER_ATTACHMENT,
	});

	const vertexBuffers: GPUVertexBufferLayout[] = [
		{
			arrayStride: 24,
			attributes: [
				{ shaderLocation: 0, offset: 0, format: 'float32x3' },
				{ shaderLocation: 1, offset: 12, format: 'float32x3' },
			],
		},
		{
			arrayStride: INSTANCE_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ shaderLocation: 2, offset: 0, format: 'float32x4' },
				{ shaderLocation: 3, offset: 16, format: 'float32x4' },
				{ shaderLocation: 4, offset: 32, format: 'float32x4' },
			],
		},
	];

	// Pipelines by pass key, built on first use.
	const pipelines = new Map<string, Promise<GPURenderPipeline>>();
	const ready = new Map<string, GPURenderPipeline>();
	const scenePipeline = (
		key: string,
		variant: string,
		entry: string,
		targets: GPUColorTargetState[],
		depthCompare: GPUCompareFunction,
		depthWrite: boolean,
		sampleCount: number,
	) =>
		device.createRenderPipelineAsync({
			label: key,
			layout: scenePipelineLayout,
			vertex: { module: sceneModule(variant), entryPoint: 'vs', buffers: vertexBuffers },
			fragment: { module: sceneModule(variant), entryPoint: entry, targets },
			primitive: { topology: 'triangle-list', cullMode: 'back' },
			depthStencil: { format: DEPTH, depthCompare, depthWriteEnabled: depthWrite },
			multisample: { count: sampleCount },
		});
	const screenPipeline = (key: string, entry: string, format: GPUTextureFormat) =>
		device.createRenderPipelineAsync({
			label: key,
			layout: key === 'copy' ? copyPipelineLayout : aoPipelineLayout,
			vertex: { module: key === 'copy' && samples > 1 ? aoMsModule : aoModule, entryPoint: 'vs' },
			fragment: {
				module: key === 'copy' && samples > 1 ? aoMsModule : aoModule,
				entryPoint: entry,
				targets: [{ format }],
			},
		});
	const buildPipeline = (pass: Pass): Promise<GPURenderPipeline> | null => {
		switch (pass.kind) {
			case 'prepass':
				return scenePipeline('prepass', 'none', 'fs_empty', [], 'greater', true, samples);
			case 'structure':
				return scenePipeline(
					'structure',
					'none',
					'fs_structure',
					[{ format: 'r16float' }],
					'greater',
					true,
					1,
				);
			case 'copy':
				return screenPipeline('copy', 'copy', copyFormat);
			case 'ao':
				return pass.ao === 'three'
					? screenPipeline('three_horizon', 'three_horizon', 'rgba16float')
					: screenPipeline(pass.ao, pass.ao, 'rg16float');
			case 'blur':
				return null;
			case 'lit': {
				const variant = `${pass.upsample}${pass.contact ? '_contact' : ''}`;
				return scenePipeline(
					passKey(pass),
					variant,
					'fs_lit',
					[{ format: COLOR }],
					pass.prepass ? 'greater-equal' : 'greater',
					!pass.prepass,
					samples,
				);
			}
			case 'resolve':
				return null;
		}
	};
	const ensure = (key: string, build: () => Promise<GPURenderPipeline> | null) => {
		if (pipelines.has(key)) return;
		const promise = build();
		if (!promise) return;
		pipelines.set(key, promise);
		promise.then((pipeline) => ready.set(key, pipeline));
	};
	const pipeline = (key: string): GPURenderPipeline => {
		const found = ready.get(key);
		if (!found) throw new Error(`the pipeline ${key} is not ready`);
		return found;
	};

	let targets: Targets | null = null;
	let showAo = false;
	const writeUniforms = () => {
		if (!targets) return;
		const data = uniforms(targets.sizes, 1, showAo, samples);
		device.queue.writeBuffer(sceneUniforms, 0, data.scene);
		device.queue.writeBuffer(aoUniforms, 0, data.ao);
	};

	const destroyTargets = (old: Targets) => {
		for (const texture of [
			old.color,
			old.depth,
			old.frame,
			old.copied,
			old.structure,
			old.structureDepth,
			old.raw,
			old.across,
			old.final,
			old.horizons,
		])
			texture?.destroy();
	};

	const resize = (sizes: Sizes) => {
		if (targets) destroyTargets(targets);
		views.clear();
		const texture = (
			width: number,
			height: number,
			format: GPUTextureFormat,
			usage: number,
			sampleCount = 1,
		) => device.createTexture({ size: [width, height], format, usage, sampleCount });
		const full = (format: GPUTextureFormat, usage: number, sampleCount = 1) =>
			texture(sizes.width, sizes.height, format, usage, sampleCount);
		const small = (format: GPUTextureFormat, label = '') => {
			const made = texture(
				sizes.aoWidth,
				sizes.aoHeight,
				format,
				RENDER_ATTACHMENT | TEXTURE_BINDING,
			);
			made.label = label;
			return made;
		};
		targets = {
			sizes,
			color: samples > 1 ? full(COLOR, RENDER_ATTACHMENT, samples) : null,
			depth: full(DEPTH, RENDER_ATTACHMENT | TEXTURE_BINDING, samples),
			frame: full(COLOR, RENDER_ATTACHMENT | COPY_SRC),
			copied: small(copyFormat),
			structure: small('r16float'),
			structureDepth: texture(sizes.aoWidth, sizes.aoHeight, DEPTH, RENDER_ATTACHMENT),
			raw: small('rg16float', 'raw'),
			across: small('rg16float', 'across'),
			final: small('rg16float', 'final'),
			horizons: small('rgba16float', 'horizons'),
			groups: new Map(),
		};
		writeUniforms();
	};

	const distanceOf = (t: Targets, input: AoInput | null) =>
		input === 'structure' ? t.structure : input === 'copy' ? t.copied : blank;

	const group = (t: Targets, key: string, make: () => GPUBindGroup) => {
		let found = t.groups.get(key);
		if (!found) {
			found = make();
			t.groups.set(key, found);
		}
		return found;
	};
	const aoGroup = (t: Targets, input: AoInput, found: GPUTexture) =>
		group(t, `ao-${input}-${found.label}`, () =>
			device.createBindGroup({
				layout: aoLayout,
				entries: [
					{ binding: 0, resource: { buffer: aoUniforms } },
					{ binding: 2, resource: distanceOf(t, input).createView() },
					{ binding: 3, resource: found.createView() },
				],
			}),
		);
	const sceneGroup = (t: Targets, input: AoInput | null) =>
		group(t, `scene-${input}`, () =>
			device.createBindGroup({
				layout: sceneLayout,
				entries: [
					{ binding: 0, resource: { buffer: sceneUniforms } },
					{ binding: 1, resource: (input ? t.final : blank).createView() },
					{ binding: 2, resource: sampler },
					{ binding: 3, resource: distanceOf(t, input).createView() },
				],
			}),
		);
	const copyGroup = (t: Targets) =>
		group(t, 'copy', () =>
			device.createBindGroup({
				layout: copyLayout,
				entries: [
					{ binding: 0, resource: { buffer: aoUniforms } },
					{ binding: 1, resource: t.depth.createView() },
				],
			}),
		);

	// Timestamp queries of one batch.
	const querySet = timestamps
		? device.createQuerySet({ type: 'timestamp', count: MAX_QUERIES })
		: null;
	const resolveBuffer = timestamps
		? device.createBuffer({
				size: MAX_QUERIES * 8,
				usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
			})
		: null;
	const readBuffer = timestamps
		? device.createBuffer({
				size: MAX_QUERIES * 8,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			})
		: null;
	let queryCount = 0;
	let queryKeys: string[] = [];
	const writes = (key: string): GPURenderPassTimestampWrites | undefined => {
		if (!querySet || queryCount + 2 > MAX_QUERIES) return undefined;
		queryKeys.push(key);
		const at = queryCount;
		queryCount += 2;
		return { querySet, beginningOfPassWriteIndex: at, endOfPassWriteIndex: at + 1 };
	};

	const views = new Map<GPUTexture, GPUTextureView>();
	const view = (texture: GPUTexture): GPUTextureView => {
		let found = views.get(texture);
		if (!found) {
			found = texture.createView();
			views.set(texture, found);
		}
		return found;
	};

	const drawScene = (pass: GPURenderPassEncoder) => {
		for (const mesh of meshes) {
			pass.setVertexBuffer(0, mesh.vertices);
			pass.setVertexBuffer(1, mesh.instances);
			pass.setIndexBuffer(mesh.indices, 'uint16');
			pass.drawIndexed(mesh.count, mesh.instanceCount);
		}
	};

	const screen = (
		encoder: GPUCommandEncoder,
		key: string,
		target: GPUTexture,
		bindGroup: GPUBindGroup,
		timeKey: string | null,
	) => {
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: view(target), loadOp: 'clear', storeOp: 'store' }],
			timestampWrites: timeKey ? writes(timeKey) : undefined,
		});
		pass.setPipeline(pipeline(key));
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	};

	const encodePass = (encoder: GPUCommandEncoder, p: Pass, timed: boolean) => {
		const t = targets as Targets;
		const key = passKey(p);
		const timeKey = timed ? key : null;
		switch (p.kind) {
			case 'prepass': {
				const pass = encoder.beginRenderPass({
					colorAttachments: [],
					depthStencilAttachment: {
						view: view(t.depth),
						depthClearValue: 0,
						depthLoadOp: 'clear',
						depthStoreOp: 'store',
					},
					timestampWrites: timeKey ? writes(timeKey) : undefined,
				});
				pass.setPipeline(pipeline(key));
				pass.setBindGroup(0, sceneGroup(t, null));
				drawScene(pass);
				pass.end();
				return;
			}
			case 'resolve':
				return;
			case 'structure': {
				const pass = encoder.beginRenderPass({
					colorAttachments: [
						{
							view: view(t.structure),
							loadOp: 'clear',
							storeOp: 'store',
							clearValue: [0, 0, 0, 0],
						},
					],
					depthStencilAttachment: {
						view: view(t.structureDepth),
						depthClearValue: 0,
						depthLoadOp: 'clear',
						depthStoreOp: 'discard',
					},
					timestampWrites: timeKey ? writes(timeKey) : undefined,
				});
				pass.setPipeline(pipeline(key));
				pass.setBindGroup(0, sceneGroup(t, null));
				drawScene(pass);
				pass.end();
				return;
			}
			case 'copy':
				screen(encoder, key, t.copied, copyGroup(t), timeKey);
				return;
			case 'ao':
				screen(
					encoder,
					key,
					p.ao === 'three' ? t.horizons : t.raw,
					aoGroup(t, p.input, blank),
					timeKey,
				);
				return;
			case 'blur':
				if (p.ao === 'three')
					screen(encoder, key, t.final, aoGroup(t, p.input, t.horizons), timeKey);
				else {
					screen(encoder, 'blur_x', t.across, aoGroup(t, p.input, t.raw), timeKey);
					screen(encoder, 'blur_y', t.final, aoGroup(t, p.input, t.across), timeKey);
				}
				return;
			case 'lit': {
				const pass = encoder.beginRenderPass({
					colorAttachments: [
						t.color
							? {
									view: view(t.color),
									resolveTarget: view(t.frame),
									loadOp: 'clear',
									storeOp: 'discard',
									clearValue: [0.11, 0.125, 0.15, 1],
								}
							: {
									view: view(t.frame),
									loadOp: 'clear',
									storeOp: 'store',
									clearValue: [0.11, 0.125, 0.15, 1],
								},
					],
					depthStencilAttachment: {
						view: view(t.depth),
						depthClearValue: 0,
						depthLoadOp: p.prepass ? 'load' : 'clear',
						depthStoreOp: 'store',
					},
					timestampWrites: timeKey ? writes(timeKey) : undefined,
				});
				pass.setPipeline(pipeline(key));
				pass.setBindGroup(0, sceneGroup(t, p.input));
				drawScene(pass);
				pass.end();
				return;
			}
		}
	};

	const prepare = async (passes: readonly Pass[]) => {
		for (const p of passes) {
			if (p.kind === 'blur') {
				if (p.ao === 'three')
					ensure('three_denoise', () =>
						screenPipeline('three_denoise', 'three_denoise', 'rg16float'),
					);
				else {
					ensure('blur_x', () => screenPipeline('blur_x', 'blur_x', 'rg16float'));
					ensure('blur_y', () => screenPipeline('blur_y', 'blur_y', 'rg16float'));
				}
			} else ensure(passKey(p), () => buildPipeline(p));
		}
		await Promise.all(pipelines.values());
	};

	const finishErrors = () => {
		if (errors.length > 0) throw new Error(`WebGPU errors: ${errors.slice(0, 4).join(' | ')}`);
	};

	const throughput = async (passes: readonly Pass[], frames: number) => {
		const started = performance.now();
		for (let f = 0; f < frames; f++) {
			const encoder = device.createCommandEncoder();
			for (const p of passes) encodePass(encoder, p, false);
			device.queue.submit([encoder.finish()]);
		}
		const issueMs = performance.now() - started;
		await device.queue.onSubmittedWorkDone();
		const ms = performance.now() - started;
		finishErrors();
		return { ms, issueMs };
	};

	/**
	 * One frame at a time, each waited for, with a timestamp at the beginning and end of every
	 * pass. Frames then never overlap on the GPU, which would stretch the timestamps of a pass.
	 */
	const timed = async (passes: readonly Pass[], frames: number) => {
		if (!querySet) return null;
		queryCount = 0;
		queryKeys = [];
		const frameStarts: number[] = [];
		for (let f = 0; f < frames; f++) {
			if (queryCount + 2 * (passes.length + 1) > MAX_QUERIES) break;
			frameStarts.push(queryCount);
			const encoder = device.createCommandEncoder();
			for (const p of passes) encodePass(encoder, p, true);
			device.queue.submit([encoder.finish()]);
			await device.queue.onSubmittedWorkDone();
		}
		frameStarts.push(queryCount);
		const counted = frameStarts.length - 1;
		const encoder = device.createCommandEncoder();
		encoder.resolveQuerySet(querySet, 0, queryCount, resolveBuffer as GPUBuffer, 0);
		encoder.copyBufferToBuffer(
			resolveBuffer as GPUBuffer,
			0,
			readBuffer as GPUBuffer,
			0,
			queryCount * 8,
		);
		device.queue.submit([encoder.finish()]);
		const read = readBuffer as GPUBuffer;
		await read.mapAsync(GPUMapMode.READ, 0, queryCount * 8);
		const times = new BigUint64Array(read.getMappedRange(0, queryCount * 8).slice(0));
		read.unmap();
		finishErrors();
		const sums: Record<string, number> = {};
		const spans: number[] = [];
		for (let f = 0; f < counted; f++) {
			let first = BigInt(Number.MAX_SAFE_INTEGER);
			let last = 0n;
			for (let q = frameStarts[f] as number; q < (frameStarts[f + 1] as number); q += 2) {
				const key = queryKeys[q / 2] as string;
				const begin = times[q] as bigint;
				const end = times[q + 1] as bigint;
				if (begin < first) first = begin;
				if (end > last) last = end;
				if (end >= begin) sums[key] = (sums[key] ?? 0) + Number(end - begin) / 1e6;
			}
			if (last >= first) spans.push(Number(last - first) / 1e6);
		}
		const passMs: Record<string, number> = {};
		for (const key of Object.keys(sums)) passMs[key] = (sums[key] as number) / counted;
		return { frameMs: spans.reduce((a, b) => a + b, 0) / Math.max(1, spans.length), passMs };
	};

	const picture = async (passes: readonly Pass[]) => {
		const t = targets as Targets;
		const encoder = device.createCommandEncoder();
		for (const p of passes) encodePass(encoder, p, false);
		const rowBytes = Math.ceil((t.sizes.width * 4) / 256) * 256;
		const read = device.createBuffer({
			size: rowBytes * t.sizes.height,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		encoder.copyTextureToBuffer({ texture: t.frame }, { buffer: read, bytesPerRow: rowBytes }, [
			t.sizes.width,
			t.sizes.height,
		]);
		device.queue.submit([encoder.finish()]);
		await read.mapAsync(GPUMapMode.READ);
		const padded = new Uint8Array(read.getMappedRange());
		const pixels = new Uint8Array(t.sizes.width * t.sizes.height * 4);
		for (let y = 0; y < t.sizes.height; y++)
			pixels.set(
				padded.subarray(y * rowBytes, y * rowBytes + t.sizes.width * 4),
				y * t.sizes.width * 4,
			);
		read.unmap();
		read.destroy();
		finishErrors();
		return pixels;
	};

	return {
		tier: 'webgpu',
		info: {
			vendor: info.vendor,
			architecture: info.architecture,
			device: info.device,
			description: info.description,
			timestamps,
		},
		timer: timestamps ? 'timestamps' : null,
		resolvesDepth: false,
		resize,
		setShowAo: (value) => {
			showAo = value;
			writeUniforms();
		},
		prepare,
		throughput,
		timed,
		picture,
		destroy: () => {
			if (targets) destroyTargets(targets);
			device.destroy();
		},
	};
}
