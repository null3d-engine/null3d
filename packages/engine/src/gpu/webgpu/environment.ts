// Environment maps made on WebGPU (D-19), which the thread that draws loads with the first
// generator that a sketch asks for. Each step of environment-steps.ts draws a level's six faces,
// side by side, into an rgba8unorm texture, as shared-exponent texels packed into its bytes. It
// copies the bytes into a buffer, and from there each face's part into its face of the level of a
// shared-exponent cube texture. Every step goes into one command buffer, which the generator
// submits at once, before the frame's passes, so the map is whole before any frame reads it
// (D-66). The textures and buffers of a map go once that work has run, and the pipelines stay for
// the next map on the device.

import type { ShaderVariant } from '../../generated/shaders';
import {
	chainLevels,
	roomSteps,
	STEP_BYTES,
	type Step,
	type StepTexture,
} from '../environment-steps';

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
	 * Fills every level of every face of a shared-exponent cube texture with `COPY_DST` usage, in
	 * one submit.
	 */
	run(device: GPUDevice, target: GPUTexture): void;
}

/** WebGPU aligns dynamic uniform offsets, and buffer rows of texel copies, to 256 bytes. */
const ALIGNMENT = 256;

/** What a device keeps between maps: the pipelines, their bind group layout and the sampler. */
interface Kept {
	layout: GPUBindGroupLayout;
	pipelines: Record<Pipeline, GPURenderPipeline>;
	sampler: GPUSampler;
}

/** The generator of the built-in room, from the environment shader's WGSL build. */
export function roomGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
	const wgsl = shader.wgsl;
	if (!wgsl) throw new Error('the environment shader has no WebGPU build');
	const kept = new WeakMap<GPUDevice, Kept>();
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
	const run = (device: GPUDevice, target: GPUTexture) => {
		const { layout, pipelines, sampler } = keep(device);
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
		const textures: Record<StepTexture, GPUTexture> = {
			traced: cube('traced room', 1),
			chain: cube('blurred room', chainLevels(size)),
			target,
		};
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
		const groups = { traced: group(textures.traced), chain: group(textures.chain) };
		const view = staging.createView();
		const encoder = device.createCommandEncoder({ label: 'environment' });
		steps.forEach((step, k) => {
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
			});
			pass.setViewport(0, 0, 6 * step.size, step.size, 0, 1);
			pass.setPipeline(pipelines[step.pipeline]);
			pass.setBindGroup(0, groups[step.source], [k * ALIGNMENT]);
			pass.draw(3);
			pass.end();
			const strip = { buffer: copies, bytesPerRow: rowBytes(step.size), rowsPerImage: step.size };
			encoder.copyTextureToBuffer({ texture: staging }, strip, [6 * step.size, step.size, 1]);
			for (let face = 0; face < 6; face++)
				for (const into of step.into)
					encoder.copyBufferToTexture(
						{ ...strip, offset: face * step.size * 4 },
						{ texture: textures[into], mipLevel: step.level, origin: [0, 0, face] },
						[step.size, step.size, 1],
					);
		});
		device.queue.submit([encoder.finish()]);
		// Each goes once the work just submitted has run.
		for (const texture of [textures.traced, textures.chain, staging]) texture.destroy();
		copies.destroy();
		uniforms.destroy();
	};
	return { prepare, run };
}

/** The bytes of a row of a level's six faces in the copy buffer, faces `size` texels wide. */
function rowBytes(size: number): number {
	return Math.ceil((6 * size * 4) / ALIGNMENT) * ALIGNMENT;
}
