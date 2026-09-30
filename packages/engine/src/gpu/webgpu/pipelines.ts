// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, and a page can add more, as the texture
// test page does.

import {
	LAYOUT_CULL,
	LAYOUT_FRAME,
	SIZE_INSTANCE_STRIDE,
	STATE_CULL_NONE,
	TEMPLATE_CULL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
	VERTEX_INSTANCE_LOCATION,
} from '../../generated/gpu';
import { CULL_SHADER, MESH_SHADER, type WgslShader } from '../../generated/shaders';
import { vertexAttribute, vertexStride } from '../vertex-format';

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
	/** The render pipeline of the shader that the template draws with. */
	readonly pipeline: string;
	/** The bind group layout of each group, by layout id, from group 0 on. */
	readonly layouts: readonly number[];
	/**
	 * For a template that draws meshes: the vertex shader locations that it reads from a mesh's
	 * vertices, in slot 0, where each pipeline's vertex format places them.
	 */
	readonly meshLocations?: readonly number[];
	/** The other vertex buffers that the vertex stage reads, by slot, after the mesh's vertices. */
	readonly vertexBuffers: GPUVertexBufferLayout[];
}

const MESH = wgslOf(MESH_SHADER.webgpu);
const CULL = wgslOf(CULL_SHADER.webgpu);
/** The culling shader's compute entry point. */
const CULL_ENTRY_POINT = 'main';

/** The compacted instance that a mesh draw's instances read: its matrix rows, then its ids. */
const INSTANCE_BUFFERS: GPUVertexBufferLayout[] = [
	{
		arrayStride: SIZE_INSTANCE_STRIDE,
		stepMode: 'instance',
		attributes: [
			{ shaderLocation: VERTEX_INSTANCE_LOCATION, offset: 0, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 1, offset: 16, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 2, offset: 32, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 3, offset: 48, format: 'uint32x4' },
		],
	},
];

/** WebGPU's vertex formats of 32-bit floats, by float count. */
const FLOAT_FORMATS: (GPUVertexFormat | undefined)[] = [
	undefined,
	'float32',
	'float32x2',
	'float32x3',
	'float32x4',
];

/**
 * The vertex buffers of a template's pipeline: a mesh's vertices first, for a template that draws
 * meshes, with each location it reads where the vertex format places it.
 */
function vertexBuffers(t: RenderTemplate, vertexFormat: number): GPUVertexBufferLayout[] {
	if (!t.meshLocations) return t.vertexBuffers;
	const attributes = t.meshLocations.map((shaderLocation): GPUVertexAttribute => {
		const attribute = vertexAttribute(vertexFormat, shaderLocation);
		if (!attribute)
			throw new Error(`vertex format ${vertexFormat} has no attribute at ${shaderLocation}`);
		const format = FLOAT_FORMATS[attribute.floats] as GPUVertexFormat;
		return { shaderLocation, offset: attribute.offset, format };
	});
	const mesh: GPUVertexBufferLayout = {
		arrayStride: vertexStride(vertexFormat),
		stepMode: 'vertex',
		attributes,
	};
	return [mesh, ...t.vertexBuffers];
}

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
			{ binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
		]);
		for (const [id, pipeline, meshLocations] of [
			[TEMPLATE_INSTANCED_LIT, 'lit', [0, 1]],
			[TEMPLATE_INSTANCED_UNLIT, 'unlit', [0, 1]],
			[TEMPLATE_INSTANCED_TEXCOORDS, 'texcoords', [0, 2]],
		] as const) {
			this.defineTemplate(id, {
				label: `mesh ${pipeline}`,
				shader: MESH,
				pipeline,
				layouts: [LAYOUT_FRAME],
				meshLocations,
				vertexBuffers: INSTANCE_BUFFERS,
			});
		}
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
	 * A render pipeline of a template, for meshes of a vertex format where the template draws
	 * meshes. Without a color format it draws depth only.
	 */
	render(
		template: number,
		colorFormat: GPUTextureFormat | undefined,
		depthFormat: GPUTextureFormat | undefined,
		sampleCount: number,
		stateFlags: number,
		vertexFormat: number,
	): GPURenderPipeline {
		const t = this.templates[template];
		if (!t) throw new Error(`unknown render template ${template}`);
		const module = this.module(t.label, t.shader);
		const entryPoints = t.shader.pipelines[t.pipeline];
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
			vertex: {
				module,
				entryPoint: entryPoints?.vertex,
				buffers: vertexBuffers(t, vertexFormat),
			},
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
