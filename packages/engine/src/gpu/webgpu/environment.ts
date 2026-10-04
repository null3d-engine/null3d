// Environment maps made on WebGPU (D-19), which the thread that draws loads with the first
// generator that a sketch asks for. Each step of environment-steps.ts draws one face of one level
// into an rgba8unorm texture, as shared-exponent texels packed into its bytes, and copies the bytes
// through a buffer into the face's level of a shared-exponent cube texture. The steps go into one
// command buffer of their own, which the generator submits at once and which runs before the
// frame's passes that sample the map. Its textures and buffers are destroyed after the submit, and
// its pipelines stay for the next map on the device.

import type { ShaderVariant } from '../../generated/shaders';
import { roomSteps, STEP_BYTES, type Step, type StepTexture } from '../environment-steps';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/** Fills every level of every face of a shared-exponent cube texture with `COPY_DST` usage. */
export type CubeGenerator = (device: GPUDevice, target: GPUTexture) => void;

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
	const keep = (device: GPUDevice): Kept => {
		let made = kept.get(device);
		if (made) return made;
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
		const pipeline = (name: Pipeline) =>
			device.createRenderPipeline({
				label: `environment ${name}`,
				layout: pipelineLayout,
				vertex: { module, entryPoint: wgsl.pipelines[name].vertex },
				fragment: {
					module,
					entryPoint: wgsl.pipelines[name].fragment,
					targets: [{ format: 'rgba8unorm' }],
				},
			});
		made = {
			layout,
			pipelines: {
				trace: pipeline('trace'),
				blur: pipeline('blur'),
				half: pipeline('half'),
				prefilter: pipeline('prefilter'),
			},
			sampler: device.createSampler({
				magFilter: 'linear',
				minFilter: 'linear',
				mipmapFilter: 'linear',
			}),
		};
		kept.set(device, made);
		return made;
	};
	return (device, target) => {
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
		const traced = cube('traced room', 1);
		const chain = cube('blurred room', Math.log2(size) + 1);
		const textures: Record<StepTexture, GPUTexture> = { traced, chain, target };
		const staging = device.createTexture({
			label: 'environment step',
			size: [size, size],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		const rowBytes = Math.max(ALIGNMENT, size * 4);
		const copies = device.createBuffer({
			label: 'environment texels',
			size: rowBytes * size,
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
		const groups = { traced: group(traced), chain: group(chain) };
		const view = staging.createView();
		const encoder = device.createCommandEncoder({ label: 'environment' });
		steps.forEach((step, k) => {
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
			});
			pass.setViewport(0, 0, step.size, step.size, 0, 1);
			pass.setPipeline(pipelines[step.pipeline]);
			pass.setBindGroup(0, groups[step.source], [k * ALIGNMENT]);
			pass.draw(3);
			pass.end();
			const extent = [step.size, step.size, 1];
			const buffer = { buffer: copies, bytesPerRow: rowBytes, rowsPerImage: step.size };
			encoder.copyTextureToBuffer({ texture: staging }, buffer, extent);
			for (const into of step.into)
				encoder.copyBufferToTexture(
					buffer,
					{ texture: textures[into], mipLevel: step.level, origin: [0, 0, step.face] },
					extent,
				);
		});
		device.queue.submit([encoder.finish()]);
		// Each object stays alive until the work that the submit sent has run.
		for (const texture of [traced, chain, staging]) texture.destroy();
		copies.destroy();
		uniforms.destroy();
	};
}
