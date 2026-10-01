// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, from the shaders that the device loaded,
// and a page can add more, as the texture test page does. Only development builds define the
// template of the debug lines, so release builds hold none of its code.

import {
	LAYOUT_CULL,
	LAYOUT_DEPTH,
	LAYOUT_FINAL,
	LAYOUT_FRAME,
	LAYOUT_MATERIAL_MAPS,
	LAYOUT_TEXTURES,
	SIZE_INSTANCE_STRIDE,
	STATE_BLEND,
	STATE_BLEND_ADDITIVE,
	STATE_BLEND_MULTIPLY,
	STATE_BLEND_NORMAL,
	STATE_CULL_FRONT,
	STATE_CULL_NONE,
	STATE_LINE_LIST,
	STATE_NO_DEPTH_TEST,
	STATE_NO_DEPTH_WRITE,
	TEMPLATE_BACKGROUND,
	TEMPLATE_CULL,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_FINAL,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_STANDARD_MAPS,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
	TEMPLATE_INSTANCED_UNLIT_MAP,
	TEMPLATE_SHADOW_DEPTH,
	VERTEX_INSTANCE_LOCATION,
} from '../../generated/gpu';
import {
	DEBUG_LINES_SHADER,
	type DeviceShaders,
	type ShaderVariants,
	type WgslShader,
} from '../../generated/shaders';
import { DEV } from '../dev';
import { LINE_VERTICES } from '../line-vertices';
import { variantFor } from '../variants';
import { variantLocations, vertexAttribute, vertexStride } from '../vertex-format';

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

/** The map slots of a standard material, one texture array and sampler each. */
const MAP_SLOTS = [0, 1, 2, 3, 4, 5];

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

/**
 * The blend state of each blend mode, whose fragments write color premultiplied by alpha, as
 * three.js blends with `premultipliedAlpha`: normal blending covers the target, additive blending
 * adds light to it, and multiply blending tints it and keeps its alpha.
 */
const BLENDS: Readonly<Record<number, GPUBlendState>> = {
	[STATE_BLEND_NORMAL]: {
		color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
		alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
	},
	[STATE_BLEND_ADDITIVE]: {
		color: { srcFactor: 'one', dstFactor: 'one' },
		alpha: { srcFactor: 'one', dstFactor: 'one' },
	},
	[STATE_BLEND_MULTIPLY]: {
		color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha' },
		alpha: { srcFactor: 'zero', dstFactor: 'one' },
	},
};

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
 * meshes, with each location it reads where the vertex format places it. The variants with vertex
 * colors read the mesh's colors too.
 */
function vertexBuffers(
	t: RenderTemplate,
	vertexFormat: number,
	permutation: number,
): GPUVertexBufferLayout[] {
	if (!t.meshLocations) return t.vertexBuffers;
	const locations = variantLocations(t.meshLocations, permutation);
	const attributes = locations.map((shaderLocation): GPUVertexAttribute => {
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
	private readonly cull: WgslShader | undefined;
	private readonly mipmap: WgslShader | undefined;
	private readonly modules = new Map<WgslShader, GPUShaderModule>();
	/** The pipelines that make mip levels, by the format they draw. */
	private readonly mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();

	/** `shaders` are the WGSL builds that the device loaded, with the bits that it fixes. */
	constructor(
		private readonly device: GPUDevice,
		shaders: DeviceShaders,
	) {
		const fragment = GPUShaderStage.FRAGMENT;
		// The frame's constants and the material table, which depth-only pipelines read too.
		const frameEntries: GPUBindGroupLayoutEntry[] = [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | fragment,
				buffer: { type: 'uniform' },
			},
			{ binding: 1, visibility: fragment, buffer: { type: 'read-only-storage' } },
		];
		this.defineLayout(LAYOUT_DEPTH, 'depth', frameEntries);
		// The table of specular terms, then the shadow map, the sampler that compares depths in
		// it, and its cascades.
		this.defineLayout(LAYOUT_FRAME, 'frame', [
			...frameEntries,
			{ binding: 3, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
			{
				binding: 4,
				visibility: fragment,
				texture: { sampleType: 'depth', viewDimension: '2d-array' },
			},
			{ binding: 5, visibility: fragment, sampler: { type: 'comparison' } },
			{ binding: 6, visibility: fragment, buffer: { type: 'uniform' } },
		]);
		this.defineLayout(LAYOUT_TEXTURES, 'textures', [
			{ binding: 0, visibility: fragment, texture: { viewDimension: '2d-array' } },
			{ binding: 1, visibility: fragment, sampler: {} },
		]);
		// A texture array for each map slot, then each slot's sampler.
		this.defineLayout(LAYOUT_MATERIAL_MAPS, 'material maps', [
			...MAP_SLOTS.map(
				(binding): GPUBindGroupLayoutEntry => ({
					binding,
					visibility: fragment,
					texture: { viewDimension: '2d-array' },
				}),
			),
			...MAP_SLOTS.map(
				(slot): GPUBindGroupLayoutEntry => ({
					binding: MAP_SLOTS.length + slot,
					visibility: fragment,
					sampler: {},
				}),
			),
		]);
		this.defineLayout(LAYOUT_CULL, 'cull', [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
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
		for (const [id, label, shader, meshLocations, layouts] of [
			[TEMPLATE_INSTANCED_LIT, 'lit', shaders.lit, [0, 1], [LAYOUT_FRAME]],
			[TEMPLATE_INSTANCED_UNLIT, 'unlit', shaders.unlit, [0], [LAYOUT_FRAME]],
			[TEMPLATE_INSTANCED_TEXCOORDS, 'texcoords', shaders.texcoords, [0, 2], [LAYOUT_FRAME]],
			[
				TEMPLATE_INSTANCED_UNLIT_MAP,
				'unlit map',
				shaders.unlit_map,
				[0, 2, 3],
				[LAYOUT_FRAME, LAYOUT_TEXTURES],
			],
			[
				TEMPLATE_INSTANCED_STANDARD_MAPS,
				'standard maps',
				shaders.standard_maps,
				[0, 1, 2, 3],
				[LAYOUT_FRAME, LAYOUT_MATERIAL_MAPS],
			],
			[TEMPLATE_SHADOW_DEPTH, 'shadow depth', shaders.shadow_depth, [0], [LAYOUT_DEPTH]],
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
		this.defineTemplate(TEMPLATE_FINAL, {
			label: 'final',
			shader: shaders.final,
			pipeline: 'main',
			layouts: [LAYOUT_FINAL],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_BACKGROUND, {
			label: 'background',
			shader: shaders.background,
			pipeline: 'main',
			layouts: [LAYOUT_FRAME, LAYOUT_TEXTURES],
			vertexBuffers: [],
		});
		if (DEV)
			this.defineTemplate(TEMPLATE_DEBUG_LINES, {
				label: 'debug lines',
				shader: DEBUG_LINES_SHADER,
				pipeline: 'main',
				layouts: [LAYOUT_FRAME],
				vertexBuffers: [LINE_VERTICES],
			});
		this.cullLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_CULL)] });
		this.cull = variantFor(shaders.cull, 0, 'wgsl')?.wgsl ?? undefined;
		this.mipmap = variantFor(shaders.mipmap, 0, 'wgsl')?.wgsl ?? undefined;
	}

	/** Adds a bind group layout under an id that no other layout has. */
	defineLayout(id: number, label: string, entries: GPUBindGroupLayoutEntry[]): void {
		if (this.layouts[id]) throw new Error(`bind group layout ${id} already exists`);
		this.layouts[id] = this.device.createBindGroupLayout({ label, entries });
	}

	/**
	 * Adds a custom material's template: the standard material's template with the material's WGSL,
	 * in the shader variants that the plugin built, which also read the first texture coordinates.
	 */
	defineCustom(id: number, shader: ShaderVariants): void {
		this.defineTemplate(id, {
			label: `custom material ${id}`,
			shader,
			pipeline: 'main',
			layouts: [LAYOUT_FRAME],
			meshLocations: [0, 1, 2],
			vertexBuffers: INSTANCE_BUFFERS,
		});
	}

	/** True when a template has this id. */
	has(id: number): boolean {
		return this.templates[id] !== undefined;
	}

	/** Adds a render pipeline template under an id that no other template has. */
	defineTemplate(id: number, template: RenderTemplate): void {
		if (this.templates[id]) throw new Error(`render pipeline template ${id} already exists`);
		const variants = Object.values(template.shader);
		if (!variants.some((variant) => variant.wgsl?.pipelines[template.pipeline]))
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
	 * draws depth only. The depth bias is in reversed depth, as the draw list holds it.
	 */
	render(
		template: number,
		permutation: number,
		colorFormat: GPUTextureFormat | undefined,
		depthFormat: GPUTextureFormat | undefined,
		sampleCount: number,
		stateFlags: number,
		vertexFormat: number,
		depthBias: number,
		depthBiasSlopeScale: number,
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
				buffers: vertexBuffers(t, vertexFormat, permutation),
			},
			fragment: colorFormat
				? {
						module,
						entryPoint: entryPoints?.fragment,
						targets: [{ format: colorFormat, blend: BLENDS[stateFlags & STATE_BLEND] }],
					}
				: undefined,
			primitive: {
				topology: stateFlags & STATE_LINE_LIST ? 'line-list' : 'triangle-list',
				cullMode:
					stateFlags & STATE_CULL_NONE ? 'none' : stateFlags & STATE_CULL_FRONT ? 'front' : 'back',
				frontFace: 'ccw',
			},
			// Reversed depth: 1 at the near plane, 0 at the far plane. Without the depth test a surface
			// writes no depth either, as in three.js's WebGL renderer. Compatibility mode needs a bias
			// clamp of 0.
			depthStencil: depthFormat
				? {
						format: depthFormat,
						depthWriteEnabled: (stateFlags & (STATE_NO_DEPTH_WRITE | STATE_NO_DEPTH_TEST)) === 0,
						depthCompare: stateFlags & STATE_NO_DEPTH_TEST ? 'always' : 'greater',
						depthBias,
						depthBiasSlopeScale,
						depthBiasClamp: 0,
					}
				: undefined,
			multisample: { count: sampleCount },
		};
	}

	/** The pipeline that makes mip levels of textures of `format`, made at its first use. */
	mipmaps(format: GPUTextureFormat): GPURenderPipeline {
		let pipeline = this.mipPipelines.get(format);
		if (!pipeline) {
			const shader = this.mipmap;
			if (!shader) throw new Error("the device's shader module has no mip level shader");
			const module = this.module('mipmaps', shader);
			const entryPoints = shader.pipelines.main;
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
		if (!this.cull) throw new Error("the device's shader module has no culling shader");
		return {
			label: 'cull',
			layout: this.cullLayout,
			compute: { module: this.module('cull', this.cull), entryPoint: CULL_ENTRY_POINT },
		};
	}
}
