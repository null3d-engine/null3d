// Environment maps made on WebGPU (D-19), which the thread that draws loads with the first
// generator that a sketch asks for: the built-in room, or a panorama from an HDR file. Each step of
// environment-steps.ts draws a level's six faces, side by side, into an rgba8unorm texture, as
// shared-exponent texels packed into its bytes. It copies the bytes into a buffer, and from there
// each face's part into its face of the level of a shared-exponent cube texture. Every step goes
// into one command buffer, which the generator submits at once, before the frame's passes, so the
// map is whole before any frame reads it (D-66). The textures and buffers of a map go once that
// work has run, and the pipelines stay for the next map on the device.

import type { ShaderVariant } from '../../generated/shaders';
import type { GeneratorSource } from '../../shared/images';
import {
	chainLevels,
	environmentSteps,
	STEP_BYTES,
	type Step,
	type StepSource,
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
	 * Fills every level of every face of a shared-exponent cube texture with `COPY_DST` usage from
	 * `source`, in one submit.
	 */
	run(device: GPUDevice, target: GPUTexture, source: GeneratorSource): void;
}

/** WebGPU aligns dynamic uniform offsets, and buffer rows of texel copies, to 256 bytes. */
const ALIGNMENT = 256;

/**
 * What a device keeps between maps: the pipelines, the bind group layouts of the steps that read a
 * cube and of the step that reads the panorama, and their samplers.
 */
interface Kept {
	layouts: { cube: GPUBindGroupLayout; panorama: GPUBindGroupLayout };
	pipelines: Record<Pipeline, GPURenderPipeline>;
	samplers: { cube: GPUSampler; panorama: GPUSampler };
}

/** The generator of environment maps, from the environment shader's WGSL build. */
export function environmentGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
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
		};
		const module = device.createShaderModule({ label: 'environment', code: wgsl.source });
		const pipelineLayouts = {
			cube: device.createPipelineLayout({ bindGroupLayouts: [layouts.cube] }),
			panorama: device.createPipelineLayout({ bindGroupLayouts: [layouts.panorama] }),
		};
		const describe = (name: Pipeline): GPURenderPipelineDescriptor => ({
			label: `environment ${name}`,
			layout: pipelineLayouts[name === 'panorama' ? 'panorama' : 'cube'],
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
		const names: Pipeline[] = ['trace', 'blur', 'half', 'prefilter', 'panorama'];
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
	return { prepare, run };
}

/** The bytes of a row of a level's six faces in the copy buffer, faces `size` texels wide. */
function rowBytes(size: number): number {
	return Math.ceil((6 * size * 4) / ALIGNMENT) * ALIGNMENT;
}
