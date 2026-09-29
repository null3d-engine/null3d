// Standard bind group layouts and the pipelines built from shader templates. Every render pipeline
// shares the same layouts, so switching pipelines never forces a rebind of the per-frame group.

import {
	LAYOUT_CULL,
	LAYOUT_FRAME,
	SIZE_INSTANCE_STRIDE,
	SIZE_VERTEX_STRIDE,
	STATE_CULL_NONE,
	TEMPLATE_CULL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_UNLIT,
} from '../../generated/gpu';
import { SHADERS, type WgslShader } from '../../generated/shaders';

/** The WebGPU build of a shader, which every shader the WebGPU backend uses has. */
function wgsl<Pipeline extends string>(shader: {
	webgpu: { wgsl: WgslShader<Pipeline> | null };
}): WgslShader<Pipeline> {
	if (!shader.webgpu.wgsl) throw new Error('a shader has no WebGPU build');
	return shader.webgpu.wgsl;
}

const MESH = wgsl(SHADERS.mesh);
const CULL = wgsl(SHADERS.cull);
/** The culling shader's compute entry point. */
const CULL_ENTRY_POINT = 'main';

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

	private module(label: string, shader: WgslShader): GPUShaderModule {
		let module = this.modules.get(label);
		if (!module) {
			module = this.device.createShaderModule({ label, code: shader.source });
			this.modules.set(label, module);
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
		const module = this.module('mesh', MESH);
		const pipeline = MESH.pipelines[template === TEMPLATE_INSTANCED_LIT ? 'lit' : 'unlit'];
		return this.device.createRenderPipeline({
			label: template === TEMPLATE_INSTANCED_LIT ? 'mesh lit' : 'mesh unlit',
			layout: this.renderLayout,
			vertex: {
				module,
				entryPoint: pipeline.vertex,
				buffers: [
					{
						arrayStride: SIZE_VERTEX_STRIDE,
						stepMode: 'vertex',
						attributes: [
							{ shaderLocation: 0, offset: 0, format: 'float32x3' },
							{ shaderLocation: 1, offset: 12, format: 'float32x3' },
						],
					},
					{
						arrayStride: SIZE_INSTANCE_STRIDE,
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
				entryPoint: pipeline.fragment,
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
			compute: { module: this.module('cull', CULL), entryPoint: CULL_ENTRY_POINT },
		});
	}
}
