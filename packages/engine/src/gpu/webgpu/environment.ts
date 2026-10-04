// Environment maps made on WebGPU (D-19), which the thread that draws loads with the first
// generator that a sketch asks for. Each band of environment-steps.ts draws rows of a level's six
// faces, side by side, into an rgba8unorm texture, as shared-exponent texels packed into its bytes.
// It copies the bytes into a buffer, and from there each face's part into its face of the level of
// a shared-exponent cube texture. Each slice's
// bands go into a command buffer of their own, which the generator submits at once, before the
// frame's passes. The textures and buffers of a map last from its first slice to its last, and its
// pipelines stay for the next map on the device.

import type { ShaderVariant } from '../../generated/shaders';
import {
	type Band,
	roomSteps,
	STEP_BYTES,
	type Step,
	type StepTexture,
	sliceBands,
} from '../environment-steps';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/** A generator that fills every level of every face of a cube texture on the GPU. */
export interface CubeGenerator {
	/**
	 * Builds the device's pipelines in the background, so that the first slice waits for no build.
	 * A slice on a device that has none builds them at once.
	 */
	prepare(device: GPUDevice): Promise<void>;
	/**
	 * Runs slice `slice` of `slices` of the work that fills a shared-exponent cube texture with
	 * `COPY_DST` usage. Slice 0 starts the map. A slice that comes before the slices ahead of it ran
	 * runs them first, and a slice of a map that is done does nothing.
	 */
	run(device: GPUDevice, target: GPUTexture, slice: number, slices: number): void;
}

/** WebGPU aligns dynamic uniform offsets, and buffer rows of texel copies, to 256 bytes. */
const ALIGNMENT = 256;

/** What a device keeps between maps: the pipelines, their bind group layout and the sampler. */
interface Kept {
	layout: GPUBindGroupLayout;
	pipelines: Record<Pipeline, GPURenderPipeline>;
	sampler: GPUSampler;
}

/** A map on its way: its steps, the slices' bands, its own textures and buffers, and the next slice. */
interface Making {
	steps: Step[];
	plan: Band[][];
	textures: Record<StepTexture, GPUTexture>;
	groups: Record<'traced' | 'chain', GPUBindGroup>;
	view: GPUTextureView;
	staging: GPUTexture;
	copies: GPUBuffer;
	uniforms: GPUBuffer;
	next: number;
}

/** The generator of the built-in room, from the environment shader's WGSL build. */
export function roomGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
	const wgsl = shader.wgsl;
	if (!wgsl) throw new Error('the environment shader has no WebGPU build');
	const kept = new WeakMap<GPUDevice, Kept>();
	const making = new WeakMap<GPUTexture, Making>();
	const done = new WeakSet<GPUTexture>();
	const preparing = new WeakMap<GPUDevice, Promise<void>>();
	/** The layout, the sampler and how to build each pipeline, built at once or in the background. */
	const build = (device: GPUDevice, background: boolean): [Kept, Promise<void>] => {
		const fragment = GPUShaderStage.FRAGMENT;
		const layout = device.createBindGroupLayout({
			label: 'environment',
			entries: [
				{
					binding: 0,
					visibility: fragment,
					buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: STEP_BYTES },
				},
				{ binding: 1, visibility: fragment, texture: { viewDimension: 'cube' } },
				{ binding: 2, visibility: fragment, sampler: {} },
			],
		});
		const module = device.createShaderModule({ label: 'environment', code: wgsl.source });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
		const describe = (name: Pipeline): GPURenderPipelineDescriptor => ({
			label: `environment ${name}`,
			layout: pipelineLayout,
			vertex: { module, entryPoint: wgsl.pipelines[name].vertex },
			fragment: {
				module,
				entryPoint: wgsl.pipelines[name].fragment,
				targets: [{ format: 'rgba8unorm' }],
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
		const names: Pipeline[] = ['trace', 'blur', 'half', 'prefilter'];
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
	/** Makes the textures and buffers of a map, and writes every step's uniform values. */
	const start = (device: GPUDevice, target: GPUTexture, slices: number): Making => {
		const { layout, sampler } = keep(device);
		const size = target.width;
		const [steps, values] = roomSteps(size, target.mipLevelCount, ALIGNMENT);
		const cube = (label: string, levels: number) =>
			device.createTexture({
				label,
				size: [size, size, 6],
				format: 'rgb9e5ufloat',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				mipLevelCount: levels,
				textureBindingViewDimension: 'cube',
			});
		const traced = cube('traced room', 1);
		const chain = cube('blurred room', Math.log2(size) + 1);
		const staging = device.createTexture({
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
		const group = (source: GPUTexture) =>
			device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: { buffer: uniforms, size: STEP_BYTES } },
					{ binding: 1, resource: source.createView({ dimension: 'cube' }) },
					{ binding: 2, resource: sampler },
				],
			});
		return {
			steps,
			plan: sliceBands(steps, slices),
			textures: { traced, chain, target },
			groups: { traced: group(traced), chain: group(chain) },
			view: staging.createView(),
			staging,
			copies,
			uniforms,
			next: 0,
		};
	};
	/** Draws and copies one slice's bands, in a submit of their own. */
	const run = (device: GPUDevice, map: Making, slice: number) => {
		const { pipelines } = keep(device);
		const encoder = device.createCommandEncoder({ label: 'environment' });
		for (const { step: k, y, rows } of map.plan[slice] ?? []) {
			const step = map.steps[k] as Step;
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view: map.view, loadOp: 'clear', storeOp: 'store' }],
			});
			// Fragments keep their place in the whole level, so the band's rows read as the faces'.
			pass.setViewport(0, y, 6 * step.size, rows, 0, 1);
			pass.setPipeline(pipelines[step.pipeline]);
			pass.setBindGroup(0, map.groups[step.source], [k * ALIGNMENT]);
			pass.draw(3);
			pass.end();
			const bytesPerRow = rowBytes(step.size);
			const strip = { buffer: map.copies, bytesPerRow, rowsPerImage: rows };
			const origin = { texture: map.staging, origin: [0, y] };
			encoder.copyTextureToBuffer(origin, strip, [6 * step.size, rows, 1]);
			for (let face = 0; face < 6; face++)
				for (const into of step.into)
					encoder.copyBufferToTexture(
						{ ...strip, offset: face * step.size * 4 },
						{ texture: map.textures[into], mipLevel: step.level, origin: [0, y, face] },
						[step.size, rows, 1],
					);
		}
		device.queue.submit([encoder.finish()]);
	};
	const runSlice = (device: GPUDevice, target: GPUTexture, slice: number, slices: number) => {
		let map = making.get(target);
		if (slice === 0) {
			if (map) end(map);
			done.delete(target);
			map = start(device, target, slices);
			making.set(target, map);
		} else if (!map) {
			// A list that a capture replays again can name a slice of a map that is done.
			if (done.has(target)) return;
			map = start(device, target, slices);
			making.set(target, map);
		}
		for (; map.next <= slice; map.next++) run(device, map, map.next);
		if (slice < slices - 1) return;
		end(map);
		making.delete(target);
		done.add(target);
	};
	return { prepare, run: runSlice };
}

/** The bytes of a row of a level's six faces in the copy buffer, faces `size` texels wide. */
function rowBytes(size: number): number {
	return Math.ceil((6 * size * 4) / ALIGNMENT) * ALIGNMENT;
}

/** Destroys a map's own textures and buffers, which stay alive until the work sent so far has run. */
function end(map: Making): void {
	for (const texture of [map.textures.traced, map.textures.chain, map.staging]) texture.destroy();
	map.copies.destroy();
	map.uniforms.destroy();
}
