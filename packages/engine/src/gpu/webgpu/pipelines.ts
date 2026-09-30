// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, and a page can add more, as the texture
// test page does.

import {
	LAYOUT_CULL,
	LAYOUT_FINAL,
	LAYOUT_FRAME,
	PERMUTATION_TONE_MAP,
	SIZE_INSTANCE_STRIDE,
	SIZE_VERTEX_STRIDE,
	STATE_CULL_NONE,
	TEMPLATE_CULL,
	TEMPLATE_FINAL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_UNLIT,
} from '../../generated/gpu';
import { CULL_SHADER, FINAL_SHADER, MESH_SHADER, type WgslShader } from '../../generated/shaders';

/** The WebGPU build of a shader variant. */
export function wgslOf<Pipeline extends string>(variant: {
	wgsl: WgslShader<Pipeline> | null;
}): WgslShader<Pipeline> {
	if (!variant.wgsl) throw new Error('a shader variant has no WebGPU build');
	return variant.wgsl;
}

/** How the backend builds the render pipelines of one template. */
export interface RenderTemplate {
	/** A name for the browser's messages. */
	readonly label: string;
	/** The WGSL module, which the backend compiles once for every template that shares it. */
	readonly shader: WgslShader;
	/**
	 * The module of the 8-bit path's pipelines, whose fragment shaders tone map their output
	 * themselves, where the template has one.
	 */
	readonly toneMapShader?: WgslShader;
	/** The render pipeline of the shader that the template draws with. */
	readonly pipeline: string;
	/** The bind group layout of each group, by layout id, from group 0 on. */
	readonly layouts: readonly number[];
	/** The vertex buffers that the vertex stage reads, by slot. */
	readonly vertexBuffers: GPUVertexBufferLayout[];
}

const MESH = wgslOf(MESH_SHADER.webgpu);
const MESH_TONE_MAP = wgslOf(MESH_SHADER.webgpu_tone_map);
const FINAL = wgslOf(FINAL_SHADER.main);
const CULL = wgslOf(CULL_SHADER.webgpu);
/** The culling shader's compute entry point. */
const CULL_ENTRY_POINT = 'main';

/** A mesh vertex, then the compacted instance that the draw's instances read. */
const MESH_BUFFERS: GPUVertexBufferLayout[] = [
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
];

export class Pipelines {
	private readonly layouts: (GPUBindGroupLayout | undefined)[] = [];
	private readonly templates: (RenderTemplate | undefined)[] = [];
	/** Each template's pipeline layout, made for its first pipeline. */
	private readonly pipelineLayouts: (GPUPipelineLayout | undefined)[] = [];
	private readonly cullLayout: GPUPipelineLayout;
	private readonly modules = new Map<WgslShader, GPUShaderModule>();

	constructor(private readonly device: GPUDevice) {
		this.defineLayout(LAYOUT_FRAME, 'frame', [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: 'uniform' },
			},
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		]);
		this.defineLayout(LAYOUT_CULL, 'cull', [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		]);
		// The final pass reads the scene color with textureLoad, which takes any float format.
		this.defineLayout(LAYOUT_FINAL, 'final', [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
			},
		]);
		for (const [id, pipeline] of [
			[TEMPLATE_INSTANCED_LIT, 'lit'],
			[TEMPLATE_INSTANCED_UNLIT, 'unlit'],
		] as const) {
			this.defineTemplate(id, {
				label: `mesh ${pipeline}`,
				shader: MESH,
				toneMapShader: MESH_TONE_MAP,
				pipeline,
				layouts: [LAYOUT_FRAME],
				vertexBuffers: MESH_BUFFERS,
			});
		}
		this.defineTemplate(TEMPLATE_FINAL, {
			label: 'final',
			shader: FINAL,
			pipeline: 'main',
			layouts: [LAYOUT_FINAL],
			vertexBuffers: [],
		});
		this.cullLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_CULL)] });
	}

	/** Adds a bind group layout under an id that no other layout has. */
	defineLayout(id: number, label: string, entries: GPUBindGroupLayoutEntry[]): void {
		if (this.layouts[id]) throw new Error(`bind group layout ${id} already exists`);
		this.layouts[id] = this.device.createBindGroupLayout({ label, entries });
	}

	/** Adds a render pipeline template under an id that no other template has. */
	defineTemplate(id: number, template: RenderTemplate): void {
		if (this.templates[id]) throw new Error(`render pipeline template ${id} already exists`);
		if (!template.shader.pipelines[template.pipeline])
			throw new Error(`the shader of template ${id} has no pipeline ${template.pipeline}`);
		this.templates[id] = template;
	}

	layout(id: number): GPUBindGroupLayout {
		const layout = this.layouts[id];
		if (!layout) throw new Error(`unknown bind group layout ${id}`);
		return layout;
	}

	private module(label: string, shader: WgslShader): GPUShaderModule {
		let module = this.modules.get(shader);
		if (!module) {
			module = this.device.createShaderModule({ label, code: shader.source });
			this.modules.set(shader, module);
		}
		return module;
	}

	/**
	 * A render pipeline of a template, in the shader variant that its permutation bits pick.
	 * Without a color format it draws depth only.
	 */
	render(
		template: number,
		permutation: number,
		colorFormat: GPUTextureFormat | undefined,
		depthFormat: GPUTextureFormat | undefined,
		sampleCount: number,
		stateFlags: number,
	): GPURenderPipeline {
		const t = this.templates[template];
		if (!t) throw new Error(`unknown render template ${template}`);
		const shader = permutation & PERMUTATION_TONE_MAP ? t.toneMapShader : t.shader;
		if (!shader) throw new Error(`render template ${template} has no tone-mapped variant`);
		const module = this.module(t.label, shader);
		const entryPoints = shader.pipelines[t.pipeline];
		let layout = this.pipelineLayouts[template];
		if (!layout) {
			layout = this.device.createPipelineLayout({
				label: t.label,
				bindGroupLayouts: t.layouts.map((id) => this.layout(id)),
			});
			this.pipelineLayouts[template] = layout;
		}
		return this.device.createRenderPipeline({
			label: t.label,
			layout,
			vertex: { module, entryPoint: entryPoints?.vertex, buffers: t.vertexBuffers },
			fragment: colorFormat
				? { module, entryPoint: entryPoints?.fragment, targets: [{ format: colorFormat }] }
				: undefined,
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
