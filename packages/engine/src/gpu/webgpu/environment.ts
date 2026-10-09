// Environment maps made on WebGPU (D-19), which the thread that draws loads with the first
// generator that a sketch asks for: the built-in room, a map of the scene's sky, or a panorama from
// an HDR file. Each step of environment-steps.ts draws a level's six faces, side by side, into an
// rgba8unorm texture, as shared-exponent texels packed into its bytes. It copies the bytes into a
// buffer, and from there each face's part into its face of the level of a shared-exponent cube
// texture. Every step of the room or a panorama goes into one command buffer, which the generator
// submits at once, before the frame's passes, so the map is whole before any frame reads it
// (D-66). The textures and buffers of such a map go once that work has run, and the pipelines stay
// for the next map on the device.
//
// A sky map runs in stages that the frame's own command encoder records (D-118), each a few faces
// of its draws, as `skyStages` plans them. Its filtered levels gather in a buffer, and the last
// stage copies them all into the map, so frames draw with the old levels until then. The map keeps its chain, its buffers and its bind groups between
// stages and refreshes, and every stage reuses its descriptors, so a refresh allocates nothing of
// its own.

import type { ShaderVariant } from '../../generated/shaders';
import type { GeneratorSource } from '../../shared/images';
import {
	chainLevels,
	environmentSteps,
	levelOffsets,
	SKY_BYTES,
	SKY_FILTER,
	type SkyFilter,
	type SkyPart,
	STEP_BYTES,
	type Step,
	type StepSource,
	type StepTexture,
	skyRows,
	skyStages,
	skySteps,
} from '../environment-steps';
import type { GpuMemory } from '../memory';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/** A generator that fills every level of every face of a cube texture on the GPU. */
export interface CubeGenerator {
	/**
	 * Builds the device's pipelines in the background, so that the map waits for no build. A map on
	 * a device that has none builds them at once.
	 */
	prepare(device: GPUDevice): Promise<void>;
	/**
	 * Fills every level of every face of a shared-exponent cube texture with `COPY_DST` usage from
	 * `source`, in one submit. A sky map's source does nothing: its stages fill it.
	 */
	run(device: GPUDevice, target: GPUTexture, source: GeneratorSource): void;
	/**
	 * Records a stage of the sky map in `target` into `encoder`, as the draw list's `SkyMapStep`
	 * command at `at` of `words` (and of `floats`, the same memory) names it, as `skyStages` plans
	 * them: the first ones draw the sky of stage 0's settings into the chain, the next ones filter
	 * the map's levels, and the last copies every level into the map. The map's first stage makes
	 * what it keeps between stages, and counts its bytes in `memory`.
	 */
	skyStage(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		target: GPUTexture,
		words: Uint32Array,
		floats: Float32Array,
		at: number,
		memory: GpuMemory,
	): void;
	/**
	 * Frees what the sky map in `target` keeps between its stages, if it is one, and takes its
	 * bytes out of `memory`.
	 */
	release(target: GPUTexture, memory: GpuMemory): void;
}

/** WebGPU aligns dynamic uniform offsets, and buffer rows of texel copies, to 256 bytes. */
const ALIGNMENT = 256;

/**
 * What a device keeps between maps: the pipelines, the bind group layouts of the steps that read a
 * cube, of the step that reads the panorama and of the step that draws the sky, and the samplers.
 */
interface Kept {
	layouts: { cube: GPUBindGroupLayout; panorama: GPUBindGroupLayout; sky: GPUBindGroupLayout };
	pipelines: Record<Pipeline, GPURenderPipeline>;
	samplers: { cube: GPUSampler; panorama: GPUSampler };
}

/** The generator of environment maps, from the environment shader's WGSL build. */
export function environmentGenerator(
	shader: ShaderVariant<Pipeline>,
	skyFilter: SkyFilter = SKY_FILTER,
): CubeGenerator {
	const wgsl = shader.wgsl;
	if (!wgsl) throw new Error('the environment shader has no WebGPU build');
	const kept = new WeakMap<GPUDevice, Kept>();
	const preparing = new WeakMap<GPUDevice, Promise<void>>();
	/** The layouts, the samplers and how to build each pipeline, at once or in the background. */
	const build = (device: GPUDevice, background: boolean): [Kept, Promise<void>] => {
		const fragment = GPUShaderStage.FRAGMENT;
		const uniforms: GPUBindGroupLayoutEntry = {
			binding: 0,
			visibility: fragment,
			buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: STEP_BYTES },
		};
		const layouts = {
			cube: device.createBindGroupLayout({
				label: 'environment',
				entries: [
					uniforms,
					{ binding: 1, visibility: fragment, texture: { viewDimension: 'cube' } },
					{ binding: 2, visibility: fragment, sampler: {} },
				],
			}),
			panorama: device.createBindGroupLayout({
				label: 'environment panorama',
				entries: [
					uniforms,
					{ binding: 3, visibility: fragment, texture: {} },
					{ binding: 4, visibility: fragment, sampler: {} },
				],
			}),
			sky: device.createBindGroupLayout({
				label: 'environment sky',
				entries: [
					uniforms,
					{
						binding: 5,
						visibility: fragment,
						buffer: { type: 'uniform', minBindingSize: SKY_BYTES },
					},
				],
			}),
		};
		const module = device.createShaderModule({ label: 'environment', code: wgsl.source });
		const pipelineLayouts = {
			cube: device.createPipelineLayout({ bindGroupLayouts: [layouts.cube] }),
			panorama: device.createPipelineLayout({ bindGroupLayouts: [layouts.panorama] }),
			sky: device.createPipelineLayout({ bindGroupLayouts: [layouts.sky] }),
		};
		const layoutOf = (name: Pipeline) =>
			name === 'panorama' || name === 'sky' ? pipelineLayouts[name] : pipelineLayouts.cube;
		const describe = (name: Pipeline): GPURenderPipelineDescriptor => ({
			label: `environment ${name}`,
			layout: layoutOf(name),
			vertex: { module, entryPoint: wgsl.pipelines[name].vertex },
			fragment: {
				module,
				entryPoint: wgsl.pipelines[name].fragment,
				targets: [{ format: 'rgba8unorm' }],
			},
		});
		const linear = { magFilter: 'linear', minFilter: 'linear' } as const;
		const made: Kept = {
			layouts,
			pipelines: {} as Record<Pipeline, GPURenderPipeline>,
			samplers: {
				cube: device.createSampler({ ...linear, mipmapFilter: 'linear' }),
				// The panorama wraps around across its width and stops at its top and bottom rows.
				panorama: device.createSampler({ ...linear, addressModeU: 'repeat' }),
			},
		};
		const names: Pipeline[] = ['trace', 'blur', 'half', 'prefilter', 'panorama', 'sky'];
		if (!background) {
			for (const name of names) made.pipelines[name] = device.createRenderPipeline(describe(name));
			return [made, Promise.resolve()];
		}
		const built = names.map(async (name) => {
			made.pipelines[name] = await device.createRenderPipelineAsync(describe(name));
		});
		return [made, Promise.all(built).then(() => undefined)];
	};
	const keep = (device: GPUDevice): Kept => {
		let made = kept.get(device);
		if (!made) {
			[made] = build(device, false);
			kept.set(device, made);
		}
		return made;
	};
	const prepare = (device: GPUDevice): Promise<void> => {
		let ready = preparing.get(device);
		if (!ready) {
			const [made, built] = build(device, true);
			ready = built.then(() => {
				if (!kept.has(device)) kept.set(device, made);
			});
			preparing.set(device, ready);
		}
		return ready;
	};
	const run = (device: GPUDevice, target: GPUTexture, source: GeneratorSource) => {
		if (source === 'sky') return;
		const { layouts, pipelines, samplers } = keep(device);
		const size = target.width;
		const [steps, values] = environmentSteps(source, size, target.mipLevelCount, ALIGNMENT);
		const made: GPUTexture[] = [];
		const texture = (descriptor: GPUTextureDescriptor) => {
			const t = device.createTexture(descriptor);
			made.push(t);
			return t;
		};
		const cube = (label: string, levels: number) =>
			texture({
				label,
				size: [size, size, 6],
				format: 'rgb9e5ufloat',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				mipLevelCount: levels,
				textureBindingViewDimension: 'cube',
			});
		const textures: Partial<Record<StepTexture, GPUTexture>> = {
			chain: cube('environment chain', chainLevels(size)),
			target,
		};
		if (source === 'room') textures.traced = cube('traced room', 1);
		const staging = texture({
			label: 'environment step',
			size: [6 * size, size],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		const copies = device.createBuffer({
			label: 'environment texels',
			size: rowBytes(size) * size,
			usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});
		const uniforms = device.createBuffer({
			label: 'environment steps',
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(uniforms, 0, values);
		const block = { binding: 0, resource: { buffer: uniforms, size: STEP_BYTES } };
		const cubeGroup = (from: GPUTexture) =>
			device.createBindGroup({
				layout: layouts.cube,
				entries: [
					block,
					{ binding: 1, resource: from.createView({ dimension: 'cube' }) },
					{ binding: 2, resource: samplers.cube },
				],
			});
		const groups: Partial<Record<StepSource, GPUBindGroup>> = {
			chain: cubeGroup(textures.chain as GPUTexture),
		};
		if (textures.traced) groups.traced = cubeGroup(textures.traced);
		if (source !== 'room') {
			const { width, height, texels } = source;
			const panorama = texture({
				label: 'environment panorama',
				size: [width, height],
				format: 'rgb9e5ufloat',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			device.queue.writeTexture({ texture: panorama }, texels, { bytesPerRow: 4 * width }, [
				width,
				height,
			]);
			groups.panorama = device.createBindGroup({
				layout: layouts.panorama,
				entries: [
					block,
					{ binding: 3, resource: panorama.createView() },
					{ binding: 4, resource: samplers.panorama },
				],
			});
		}
		const view = staging.createView();
		const encoder = device.createCommandEncoder({ label: 'environment' });
		steps.forEach((step, k) => {
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
			});
			pass.setViewport(0, 0, 6 * step.size, step.size, 0, 1);
			pass.setPipeline(pipelines[step.pipeline]);
			pass.setBindGroup(0, groups[step.source] as GPUBindGroup, [k * ALIGNMENT]);
			pass.draw(3);
			pass.end();
			const strip = { buffer: copies, bytesPerRow: rowBytes(step.size), rowsPerImage: step.size };
			encoder.copyTextureToBuffer({ texture: staging }, strip, [6 * step.size, step.size, 1]);
			for (let face = 0; face < 6; face++)
				for (const into of step.into)
					encoder.copyBufferToTexture(
						{ ...strip, offset: face * step.size * 4 },
						{ texture: textures[into] as GPUTexture, mipLevel: step.level, origin: [0, 0, face] },
						[step.size, step.size, 1],
					);
		});
		device.queue.submit([encoder.finish()]);
		// Each goes once the work just submitted has run.
		for (const t of made) t.destroy();
		copies.destroy();
		uniforms.destroy();
	};
	const skyMaps = new Map<GPUTexture, SkyMap>();
	const skyStage: CubeGenerator['skyStage'] = (
		device,
		encoder,
		target,
		words,
		floats,
		at,
		memory,
	) => {
		let map = skyMaps.get(target);
		if (!map) {
			map = makeSkyMap(device, keep(device), target, skyFilter);
			skyMaps.set(target, map);
			memory.addTextures(map.textureBytes);
			memory.addBuffers(map.bufferBytes);
		}
		map.stage(encoder, words[at + 2] as number, floats, at + 3);
	};
	const release = (target: GPUTexture, memory: GpuMemory) => {
		const map = skyMaps.get(target);
		if (!map) return;
		map.destroy();
		skyMaps.delete(target);
		memory.addTextures(-map.textureBytes);
		memory.addBuffers(-map.bufferBytes);
	};
	return { prepare, run, skyStage, release };
}

/** The bytes of a row of a level's six faces in the copy buffer, faces `size` texels wide. */
function rowBytes(size: number): number {
	return Math.ceil((6 * size * 4) / ALIGNMENT) * ALIGNMENT;
}

/** What a sky map keeps between its stages, and how it records each. */
interface SkyMap {
	/** The GPU bytes of the textures and of the buffers that the map keeps. */
	readonly textureBytes: number;
	readonly bufferBytes: number;
	stage(encoder: GPUCommandEncoder, stage: number, settings: Float32Array, at: number): void;
	destroy(): void;
}

/**
 * Makes the chain, the buffers, the bind groups and the descriptors that the sky map in `target`
 * keeps, once, so that its stages allocate nothing.
 */
function makeSkyMap(device: GPUDevice, kept: Kept, target: GPUTexture, filter: SkyFilter): SkyMap {
	const { layouts, pipelines, samplers } = kept;
	const size = target.width;
	const levels = target.mipLevelCount;
	const [steps, values] = skySteps(size, levels, ALIGNMENT, filter);
	const stages = skyStages(size, levels);
	const chained = chainLevels(size);
	const chain = device.createTexture({
		label: 'sky chain',
		size: [size, size, 6],
		format: 'rgb9e5ufloat',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		mipLevelCount: chained,
		textureBindingViewDimension: 'cube',
	});
	const staging = device.createTexture({
		label: 'sky step',
		size: [6 * size, skyRows(size)],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const buffer = (label: string, bytes: number, usage: number) =>
		device.createBuffer({ label, size: bytes, usage });
	const copy = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
	const strip = buffer('sky chain texels', rowBytes(size) * size, copy);
	// The map's finished levels, one after another, until the last stage copies them into the map.
	const offsets = levelOffsets(size, levels, rowBytes);
	const finished = buffer('sky map texels', offsets[levels] as number, copy);
	const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
	const uniforms = buffer('sky steps', values.byteLength, uniform);
	device.queue.writeBuffer(uniforms, 0, values);
	const sky = buffer('sky settings', SKY_BYTES, uniform);
	const block = { binding: 0, resource: { buffer: uniforms, size: STEP_BYTES } };
	const groups: Partial<Record<StepSource, GPUBindGroup>> = {
		sky: device.createBindGroup({
			layout: layouts.sky,
			entries: [block, { binding: 5, resource: { buffer: sky } }],
		}),
		chain: device.createBindGroup({
			layout: layouts.cube,
			entries: [
				block,
				{ binding: 1, resource: chain.createView({ dimension: 'cube' }) },
				{ binding: 2, resource: samplers.cube },
			],
		}),
	};
	const pass: GPURenderPassDescriptor = {
		colorAttachments: [{ view: staging.createView(), loadOp: 'clear', storeOp: 'store' }],
	};
	const dynamicOffset = new Uint32Array(1);
	const stagingOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const fromStaging: GPUTexelCopyTextureInfo = { texture: staging, origin: stagingOrigin };
	const toBuffer: GPUTexelCopyBufferInfo = { buffer: strip, offset: 0, bytesPerRow: 0 };
	const fromBuffer: GPUTexelCopyBufferInfo = { buffer: strip, offset: 0, bytesPerRow: 0 };
	const origin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const toCube: GPUTexelCopyTextureInfo = { texture: chain, mipLevel: 0, origin };
	const stripSize: GPUExtent3DDict = { width: 0, height: 0, depthOrArrayLayers: 1 };
	const faceSize: GPUExtent3DDict = { width: 0, height: 0, depthOrArrayLayers: 1 };
	/**
	 * Copies faces `first` to `first + faces - 1` of a level's rows in `from` at `start` into the
	 * level of `into`.
	 */
	const copyFaces = (
		encoder: GPUCommandEncoder,
		from: GPUBuffer,
		start: number,
		into: GPUTexture,
		level: number,
		first: number,
		faces: number,
	) => {
		const side = size >> level;
		fromBuffer.buffer = from;
		fromBuffer.bytesPerRow = rowBytes(side);
		toCube.texture = into;
		toCube.mipLevel = level;
		faceSize.width = side;
		faceSize.height = side;
		for (let face = first; face < first + faces; face++) {
			fromBuffer.offset = start + face * side * 4;
			origin.z = face;
			encoder.copyBufferToTexture(fromBuffer, toCube, faceSize);
		}
	};
	/** Draws a stage's parts in one render pass, each into its own rectangle, then copies each. */
	const draw = (encoder: GPUCommandEncoder, parts: readonly SkyPart[]) => {
		const render = encoder.beginRenderPass(pass);
		for (let p = 0; p < parts.length; p++) {
			const { step: k, first, faces } = parts[p] as SkyPart;
			const step = steps[k] as Step;
			render.setViewport(first * step.size, step.row, faces * step.size, step.size, 0, 1);
			render.setPipeline(pipelines[step.pipeline]);
			dynamicOffset[0] = k * ALIGNMENT;
			render.setBindGroup(0, groups[step.source] as GPUBindGroup, dynamicOffset, 0, 1);
			render.draw(3);
		}
		render.end();
		for (let p = 0; p < parts.length; p++) copyOut(encoder, parts[p] as SkyPart);
	};
	/** Copies a part's texels into the chain and into the finished levels. */
	const copyOut = (encoder: GPUCommandEncoder, { step: k, first, faces }: SkyPart) => {
		const step = steps[k] as Step;
		const side = step.size;
		// Each face's texels lie at the same place in the buffer's rows as in the drawn rows.
		const across = first * side * 4;
		stagingOrigin.x = first * side;
		stagingOrigin.y = step.row;
		stripSize.width = faces * side;
		stripSize.height = side;
		toBuffer.bytesPerRow = rowBytes(side);
		for (let i = 0; i < step.into.length; i++) {
			const chaining = step.into[i] === 'chain';
			toBuffer.buffer = chaining ? strip : finished;
			toBuffer.offset = (chaining ? 0 : (offsets[step.level] as number)) + across;
			encoder.copyTextureToBuffer(fromStaging, toBuffer, stripSize);
			if (chaining) copyFaces(encoder, strip, 0, chain, step.level, first, faces);
		}
	};
	let texels = 0;
	for (let level = 0; level < chained; level++) texels += 6 * (size >> level) ** 2;
	return {
		textureBytes: 4 * (texels + 6 * size * skyRows(size)),
		bufferBytes: strip.size + finished.size + uniforms.size + sky.size,
		stage(encoder, stage, settings, at) {
			const parts = stages[stage] as readonly SkyPart[];
			if (stage === 0) device.queue.writeBuffer(sky, 0, settings, at, SKY_BYTES / 4);
			if (parts.length > 0) draw(encoder, parts);
			else
				for (let level = 0; level < levels; level++)
					copyFaces(encoder, finished, offsets[level] as number, target, level, 0, 6);
		},
		destroy() {
			for (const resource of [chain, staging, strip, finished, uniforms, sky]) resource.destroy();
		},
	};
}
