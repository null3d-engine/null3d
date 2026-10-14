// Reflection probes' maps made on WebGPU (D-149), in the frame's own command encoder, ahead of its
// passes. A filter copies each capture view's image into its layer of the chain, makes the chain's
// smaller levels a layer and a level at a time, then fills each level of the probe's layer of the
// probes' array, each draw straight into its level: half floats need no copy. The draws' uniform
// values never change for a pair of textures, and their views, bind groups and pass descriptors
// stay with the textures, so a filter allocates nothing after the first on them.

import type { ShaderVariant } from '../../generated/shaders';
import type { GpuMemory } from '../memory';
import { PROBE_STEP_BYTES, type ProbeSteps, probeSteps } from '../probe-steps';
import type { CubeGenerator } from './environment';

/** The probe shader's render pipelines. */
type Pipeline = 'gather' | 'half' | 'prefilter';

/** WebGPU aligns dynamic uniform offsets to 256 bytes. */
const ALIGNMENT = 256;

/** The format of the chain and of the probes' maps. */
const FORMAT: GPUTextureFormat = 'rgba16float';

/**
 * The generators' code that the thread that draws loads with the first generator: environment maps,
 * and reflection probes' filters.
 */
export interface Generators {
	readonly environment: CubeGenerator;
	readonly probes: ProbeFilter;
}

/** Runs reflection probes' filters on a device. */
export interface ProbeFilter {
	/** Builds the device's pipelines in the background, so that the first filter waits for none. */
	prepare(device: GPUDevice): Promise<void>;
	/**
	 * Records into `encoder` the filter that makes layer `layer` of `probes` from `faces`, the six
	 * capture views' images, through `chain`, as the draw list's `ProbeFilter` command says. The
	 * first filter on a pair of textures counts the bytes of what it keeps in `memory`.
	 */
	run(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		probes: GPUTexture,
		chain: GPUTexture,
		layer: number,
		faces: readonly GPUTexture[],
		memory: GpuMemory,
	): void;
}

/** What a device keeps: the pipelines, their bind group layout and the sampler. */
interface Kept {
	layout: GPUBindGroupLayout;
	pipelines: Record<Pipeline, GPURenderPipeline>;
	sampler: GPUSampler;
}

/** What a filter on one pair of textures keeps: its draws' values and every descriptor. */
interface Pair {
	chain: GPUTexture;
	steps: ProbeSteps;
	uniforms: GPUBuffer;
	/** The bind group that reads the chain's whole array at each level, and the one per face image. */
	chainGroup: GPUBindGroup;
	levelGroups: GPUBindGroup[];
	faceGroups: WeakMap<GPUTexture, GPUBindGroup>;
	/** The pass that draws into each layer's level of the chain, by `layer * levels + level`. */
	chainPasses: GPURenderPassDescriptor[];
	/** The pass that draws into each layer's level of the probes' array, by the same key. */
	probePasses: GPURenderPassDescriptor[];
}

/** The dynamic offset of the next draw's uniform values, kept so that a draw allocates none. */
const offsets = [0];

/** Records one draw of the whole target of `pass`, with the uniform values of slot `place`. */
function draw(
	encoder: GPUCommandEncoder,
	pass: GPURenderPassDescriptor,
	pipeline: GPURenderPipeline,
	group: GPUBindGroup,
	place: number,
): void {
	offsets[0] = place * ALIGNMENT;
	const encoded = encoder.beginRenderPass(pass);
	encoded.setPipeline(pipeline);
	encoded.setBindGroup(0, group, offsets);
	encoded.draw(3);
	encoded.end();
}

/** The filter of reflection probes, from the probe shader's WGSL build. */
export function probeFilter(shader: ShaderVariant<Pipeline>): ProbeFilter {
	const wgsl = shader.wgsl;
	if (!wgsl) throw new Error('the probe shader has no WebGPU build');
	const kept = new WeakMap<GPUDevice, Kept>();
	const preparing = new WeakMap<GPUDevice, Promise<void>>();
	const pairs = new WeakMap<GPUTexture, Pair>();
	const build = (device: GPUDevice, background: boolean): [Kept, Promise<void>] => {
		const fragment = GPUShaderStage.FRAGMENT;
		const layout = device.createBindGroupLayout({
			label: 'probe filter',
			entries: [
				{
					binding: 0,
					visibility: fragment,
					buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PROBE_STEP_BYTES },
				},
				{ binding: 1, visibility: fragment, texture: { viewDimension: '2d-array' } },
				{ binding: 2, visibility: fragment, sampler: {} },
			],
		});
		const module = device.createShaderModule({ label: 'probe filter', code: wgsl.source });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
		const describe = (name: Pipeline): GPURenderPipelineDescriptor => ({
			label: `probe ${name}`,
			layout: pipelineLayout,
			vertex: { module, entryPoint: wgsl.pipelines[name].vertex },
			fragment: {
				module,
				entryPoint: wgsl.pipelines[name].fragment,
				targets: [{ format: FORMAT }],
			},
		});
		const made: Kept = {
			layout,
			pipelines: {} as Record<Pipeline, GPURenderPipeline>,
			sampler: device.createSampler({
				magFilter: 'linear',
				minFilter: 'linear',
				mipmapFilter: 'linear',
			}),
		};
		const names: Pipeline[] = ['gather', 'half', 'prefilter'];
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
	/** What a filter on `probes` through `chain` keeps, made on the first filter. */
	const pairOf = (
		device: GPUDevice,
		{ layout, sampler }: Kept,
		probes: GPUTexture,
		chain: GPUTexture,
		memory: GpuMemory,
	): Pair => {
		const known = pairs.get(probes);
		if (known && known.chain === chain) return known;
		const steps = probeSteps(probes.width, probes.mipLevelCount, chain.width, ALIGNMENT);
		const uniforms = device.createBuffer({
			label: 'probe filter steps',
			size: steps.values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(uniforms, 0, steps.values);
		memory.addBuffers(steps.values.byteLength);
		const group = (view: GPUTextureView) =>
			device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: { buffer: uniforms, size: PROBE_STEP_BYTES } },
					{ binding: 1, resource: view },
					{ binding: 2, resource: sampler },
				],
			});
		const levelGroups: GPUBindGroup[] = [];
		for (let level = 0; level < chain.mipLevelCount; level++)
			levelGroups.push(
				group(chain.createView({ dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1 })),
			);
		const target = (
			texture: GPUTexture,
			layer: number,
			level: number,
		): GPURenderPassDescriptor => ({
			colorAttachments: [
				{
					view: texture.createView({
						dimension: '2d',
						baseArrayLayer: layer,
						arrayLayerCount: 1,
						baseMipLevel: level,
						mipLevelCount: 1,
					}),
					loadOp: 'clear',
					storeOp: 'store',
				},
			],
		});
		const chainPasses: GPURenderPassDescriptor[] = [];
		for (let layer = 0; layer < 6; layer++)
			for (let level = 0; level < chain.mipLevelCount; level++)
				chainPasses.push(target(chain, layer, level));
		const probePasses: GPURenderPassDescriptor[] = [];
		for (let layer = 0; layer < probes.depthOrArrayLayers; layer++)
			for (let level = 0; level < probes.mipLevelCount; level++)
				probePasses.push(target(probes, layer, level));
		const pair: Pair = {
			chain,
			steps,
			uniforms,
			chainGroup: group(chain.createView({ dimension: '2d-array' })),
			levelGroups,
			faceGroups: new WeakMap(),
			chainPasses,
			probePasses,
		};
		pairs.set(probes, pair);
		return pair;
	};
	/** The first layer of the shared array that holds a probe's map: the light tables' layers
	 * (crate::light_tables) come first, so the probes follow them. */
	const PROBE_LAYER_BASE = 3;
	const run: ProbeFilter['run'] = (device, encoder, probes, chain, layer, faces, memory) => {
		const made = keep(device);
		const pair = pairOf(device, made, probes, chain, memory);
		const { steps } = pair;
		const { pipelines } = made;
		const chainLevels = chain.mipLevelCount;
		for (let face = 0; face < 6; face++) {
			const image = faces[face] as GPUTexture;
			let group = pair.faceGroups.get(image);
			if (!group) {
				group = device.createBindGroup({
					layout: made.layout,
					entries: [
						{ binding: 0, resource: { buffer: pair.uniforms, size: PROBE_STEP_BYTES } },
						{ binding: 1, resource: image.createView({ dimension: '2d-array' }) },
						{ binding: 2, resource: made.sampler },
					],
				});
				pair.faceGroups.set(image, group);
			}
			draw(
				encoder,
				pair.chainPasses[face * chainLevels] as GPURenderPassDescriptor,
				pipelines.gather,
				group,
				steps.gather,
			);
		}
		for (let face = 0; face < 6; face++)
			for (let level = 1; level < chainLevels; level++)
				draw(
					encoder,
					pair.chainPasses[face * chainLevels + level] as GPURenderPassDescriptor,
					pipelines.half,
					pair.levelGroups[level - 1] as GPUBindGroup,
					steps.half(face, level),
				);
		const levels = probes.mipLevelCount;
		for (let level = 0; level < levels; level++)
			draw(
				encoder,
				pair.probePasses[(PROBE_LAYER_BASE + layer) * levels + level] as GPURenderPassDescriptor,
				pipelines.prefilter,
				pair.chainGroup,
				steps.prefilter(level),
			);
	};
	return { prepare, run };
}
