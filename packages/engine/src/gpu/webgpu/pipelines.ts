// Standard bind group layouts and the pipelines built from shader templates. Every render pipeline
// shares the same layouts, so switching pipelines never forces a rebind of the per-frame group.

import {
	LAYOUT_CULL,
	LAYOUT_FRAME,
	TEMPLATE_CULL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_UNLIT,
} from '../../generated/gpu';
import { INSTANCE_STRIDE, VERTEX_STRIDE, WGSL } from '../../render/wgsl';

/** Bits of a render pipeline's state flags. */
export const STATE_CULL_NONE = 1;

export class Pipelines {
	readonly layouts: GPUBindGroupLayout[] = [];
	private readonly renderLayout: GPUPipelineLayout;
	private readonly cullLayout: GPUPipelineLayout;
	private readonly modules = new Map<string, GPUShaderModule>();

	constructor(private readonly device: GPUDevice) {
		this.layouts[LAYOUT_FRAME] = device.createBindGroupLayout({
			label: 'frame',
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform' },
				},
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});
		this.layouts[LAYOUT_CULL] = device.createBindGroupLayout({
			label: 'cull',
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
				{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		this.renderLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layouts[LAYOUT_FRAME] as GPUBindGroupLayout],
		});
		this.cullLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layouts[LAYOUT_CULL] as GPUBindGroupLayout],
		});
	}

	private module(name: keyof typeof WGSL): GPUShaderModule {
		let module = this.modules.get(name);
		if (!module) {
			module = this.device.createShaderModule({ label: name, code: WGSL[name] });
			this.modules.set(name, module);
		}
		return module;
	}

	render(
		template: number,
		colorFormat: GPUTextureFormat,
		depthFormat: GPUTextureFormat | undefined,
		sampleCount: number,
		stateFlags: number,
	): GPURenderPipeline {
		if (template !== TEMPLATE_INSTANCED_LIT && template !== TEMPLATE_INSTANCED_UNLIT) {
			throw new Error(`unknown render template ${template}`);
		}
		const module = this.module('instanced');
		return this.device.createRenderPipeline({
			label: template === TEMPLATE_INSTANCED_LIT ? 'instanced lit' : 'instanced unlit',
			layout: this.renderLayout,
			vertex: {
				module,
				entryPoint: 'vs',
				buffers: [
					{
						arrayStride: VERTEX_STRIDE,
						stepMode: 'vertex',
						attributes: [
							{ shaderLocation: 0, offset: 0, format: 'float32x3' },
							{ shaderLocation: 1, offset: 12, format: 'float32x3' },
						],
					},
					{
						arrayStride: INSTANCE_STRIDE,
						stepMode: 'instance',
						attributes: [
							{ shaderLocation: 2, offset: 0, format: 'float32x4' },
							{ shaderLocation: 3, offset: 16, format: 'float32x4' },
							{ shaderLocation: 4, offset: 32, format: 'float32x4' },
							{ shaderLocation: 5, offset: 48, format: 'uint32x4' },
						],
					},
				],
			},
			fragment: {
				module,
				entryPoint: template === TEMPLATE_INSTANCED_LIT ? 'fs_lit' : 'fs_unlit',
				targets: [{ format: colorFormat }],
			},
			primitive: {
				topology: 'triangle-list',
				cullMode: stateFlags & STATE_CULL_NONE ? 'none' : 'back',
				frontFace: 'ccw',
			},
			// Reversed depth: 1 at the near plane, 0 at the far plane.
			depthStencil: depthFormat
				? { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }
				: undefined,
			multisample: { count: sampleCount },
		});
	}

	compute(template: number): GPUComputePipeline {
		if (template !== TEMPLATE_CULL) throw new Error(`unknown compute template ${template}`);
		return this.device.createComputePipeline({
			label: 'cull',
			layout: this.cullLayout,
			compute: { module: this.module('cull'), entryPoint: 'main' },
		});
	}
}
