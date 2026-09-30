// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, and a page can add more, as the texture
// test page does.

import {
	LAYOUT_CULL,
	LAYOUT_FRAME,
	LAYOUT_TEXTURES,
	SIZE_INSTANCE_STRIDE,
	STATE_CULL_NONE,
	TEMPLATE_CULL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
	TEMPLATE_INSTANCED_UNLIT_MAP,
	VERTEX_INSTANCE_LOCATION,
} from '../../generated/gpu';
import {
	CULL_SHADER,
	LIT_SHADER,
	MIPMAP_SHADER,
	TEXCOORDS_SHADER,
	UNLIT_MAP_SHADER,
	UNLIT_SHADER,
	type WgslShader,
} from '../../generated/shaders';
import { type ShaderVariants, variantFor } from '../variants';
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
	/**
	 * The shader's variants. A pipeline's permutation word picks one, whose WGSL module the
	 * backend compiles once for every pipeline that draws with it.
	 */
	readonly shader: ShaderVariants;
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

const CULL = wgslOf(CULL_SHADER.webgpu);
const MIPMAP = wgslOf(MIPMAP_SHADER.webgpu);
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
	/** The pipelines that make mip levels, by the format they draw. */
	private readonly mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();

	constructor(private readonly device: GPUDevice) {
		const fragment = GPUShaderStage.FRAGMENT;
		this.defineLayout(LAYOUT_FRAME, 'frame', [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | fragment,
				buffer: { type: 'uniform' },
			},
			{ binding: 1, visibility: fragment, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: fragment, buffer: { type: 'read-only-storage' } },
		]);
		this.defineLayout(LAYOUT_TEXTURES, 'textures', [
			{ binding: 0, visibility: fragment, texture: { viewDimension: '2d-array' } },
			{ binding: 1, visibility: fragment, sampler: {} },
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
		for (const [id, label, shader, meshLocations, layouts] of [
			[TEMPLATE_INSTANCED_LIT, 'lit', LIT_SHADER, [0, 1], [LAYOUT_FRAME]],
			[TEMPLATE_INSTANCED_UNLIT, 'unlit', UNLIT_SHADER, [0], [LAYOUT_FRAME]],
			[TEMPLATE_INSTANCED_TEXCOORDS, 'texcoords', TEXCOORDS_SHADER, [0, 2], [LAYOUT_FRAME]],
			[
				TEMPLATE_INSTANCED_UNLIT_MAP,
				'unlit map',
				UNLIT_MAP_SHADER,
				[0, 2],
				[LAYOUT_FRAME, LAYOUT_TEXTURES],
			],
		] as const) {
			this.defineTemplate(id, {
				label: `mesh ${label}`,
				shader,
				pipeline: 'main',
				layouts,
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
		if (!variantFor(template.shader, 0, 'wgsl')?.wgsl?.pipelines[template.pipeline])
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
	 * How to build a render pipeline of a template, in the shader variant that its permutation bits
	 * pick, for meshes of a vertex format where the template draws meshes. Without a color format it
	 * draws depth only.
	 */
	render(
		template: number,
		permutation: number,
		colorFormat: GPUTextureFormat | undefined,
		depthFormat: GPUTextureFormat | undefined,
		sampleCount: number,
		stateFlags: number,
		vertexFormat: number,
	): GPURenderPipelineDescriptor {
		const t = this.templates[template];
		if (!t) throw new Error(`unknown render template ${template}`);
		const shader = variantFor(t.shader, permutation, 'wgsl')?.wgsl;
		if (!shader)
			throw new Error(`render template ${template} has no variant for permutation ${permutation}`);
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
		return {
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
		};
	}

	/** The pipeline that makes mip levels of textures of `format`, made at its first use. */
	mipmaps(format: GPUTextureFormat): GPURenderPipeline {
		let pipeline = this.mipPipelines.get(format);
		if (!pipeline) {
			const module = this.module('mipmaps', MIPMAP);
			const entryPoints = MIPMAP.pipelines.main;
			pipeline = this.device.createRenderPipeline({
				label: 'mipmaps',
				layout: 'auto',
				vertex: { module, entryPoint: entryPoints?.vertex },
				fragment: { module, entryPoint: entryPoints?.fragment, targets: [{ format }] },
			});
			this.mipPipelines.set(format, pipeline);
		}
		return pipeline;
	}

	/** How to build a compute pipeline of a template. */
	compute(template: number): GPUComputePipelineDescriptor {
		if (template !== TEMPLATE_CULL) throw new Error(`unknown compute template ${template}`);
		return {
			label: 'cull',
			layout: this.cullLayout,
			compute: { module: this.module('cull', CULL), entryPoint: CULL_ENTRY_POINT },
		};
	}
}
