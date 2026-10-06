// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, from the shaders that the device loaded,
// and a page can add more, as the texture test page does. Only development builds define the
// templates of the debug lines and the debug views, so release builds hold none of their code.

import {
	LAYOUT_AO,
	LAYOUT_AO_DEPTH,
	LAYOUT_AO_DEPTH_MS,
	LAYOUT_BLOOM,
	LAYOUT_CULL,
	LAYOUT_DEPTH,
	LAYOUT_FINAL,
	LAYOUT_FINAL_BLOOM,
	LAYOUT_FRAME,
	LAYOUT_JOINTS,
	LAYOUT_LIGHT_CLUSTERS,
	LAYOUT_MATERIAL_MAPS,
	LAYOUT_SHADOW_RESTORE,
	LAYOUT_SKIN,
	LAYOUT_TEXTURES,
	PERMUTATION_PREPASS,
	PERMUTATION_SKIN,
	SIZE_INSTANCE_STRIDE,
	STATE_BLEND,
	STATE_BLEND_ADDITIVE,
	STATE_BLEND_MULTIPLY,
	STATE_BLEND_NORMAL,
	STATE_CULL_FRONT,
	STATE_CULL_NONE,
	STATE_DEPTH_EQUAL,
	STATE_LINE_LIST,
	STATE_NO_COLOR_WRITE,
	STATE_NO_DEPTH_TEST,
	STATE_NO_DEPTH_WRITE,
	TEMPLATE_AO,
	TEMPLATE_AO_DENOISE,
	TEMPLATE_AO_DEPTH,
	TEMPLATE_AO_DEPTH_MS,
	TEMPLATE_BACKGROUND,
	TEMPLATE_BLOOM,
	TEMPLATE_CULL,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_DEBUG_VIEW,
	TEMPLATE_FINAL,
	TEMPLATE_FINAL_BLOOM,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_STANDARD_MAPS,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
	TEMPLATE_INSTANCED_UNLIT_MAP,
	TEMPLATE_LIGHT_COUNT,
	TEMPLATE_LIGHT_PLACE,
	TEMPLATE_LIGHT_WRITE,
	TEMPLATE_LINE,
	TEMPLATE_LINE_LIT,
	TEMPLATE_OUTLINE_MASK,
	TEMPLATE_SHADOW_DEPTH,
	TEMPLATE_SHADOW_RESTORE,
	TEMPLATE_SKIN,
	TEMPLATE_SPRITE,
	TEMPLATE_SPRITE_MAP,
	VERTEX_INSTANCE_LOCATION,
	VERTEX_TYPE_F32,
	VERTEX_TYPE_SINT8,
	VERTEX_TYPE_SINT16,
	VERTEX_TYPE_SNORM8,
	VERTEX_TYPE_SNORM16,
	VERTEX_TYPE_UINT8,
	VERTEX_TYPE_UINT16,
	VERTEX_TYPE_UNORM8,
	VERTEX_TYPE_UNORM16,
} from '../../generated/gpu';
import {
	DEBUG_LINES_SHADER,
	DEBUG_VIEW_SHADER,
	type DeviceShaders,
	type ShaderVariants,
	type WgslShader,
} from '../../generated/shaders';
import { DEV } from '../../shared/dev';
import type { CustomShader } from '../../shared/images';
import { LINE_VERTICES } from '../line-vertices';
import { variantFor } from '../variants';
import {
	plainScale,
	type VertexAttribute,
	variantLocations,
	vertexAttribute,
	vertexStride,
} from '../vertex-format';

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
	/**
	 * True for a template whose pipelines draw the depth prepass with their own vertex shader: a
	 * custom material's or a sprite's, whose vertices the depth template does not place. A pipeline
	 * with the prepass bit then takes the build without the bit, and a fragment shader that writes
	 * nothing.
	 */
	readonly ownPrepass?: boolean;
	/**
	 * True for a template whose fragment shader writes the depth, so its pipelines keep their
	 * fragment stage where they draw into a depth target alone.
	 */
	readonly writesDepth?: boolean;
}

/** The fragment shader of a prepass that draws with a template's own vertex shader. */
const EMPTY_FRAGMENT = '@fragment\nfn fs() -> @location(0) vec4f {\n    return vec4f(0.0);\n}\n';

/** The map slots of a standard material, one texture array and sampler each. */
const MAP_SLOTS = [0, 1, 2, 3, 4, 5];

/** The culling shader's compute entry point. */
const CULL_ENTRY_POINT = 'main';

/** The compute templates of light clustering: each one's entry point in the light clustering shader. */
const LIGHT_ENTRY_POINTS: Readonly<Record<number, string>> = {
	[TEMPLATE_LIGHT_COUNT]: 'count_lights',
	[TEMPLATE_LIGHT_PLACE]: 'place_lights',
	[TEMPLATE_LIGHT_WRITE]: 'write_lights',
};

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

/** The formats whose mip levels the GPU makes: 8-bit color, as the draw list allows. */
const MIP_FORMATS: readonly GPUTextureFormat[] = ['rgba8unorm', 'rgba8unorm-srgb'];

/** The write mask of every color channel, as `GPUColorWrite.ALL` holds it. */
const ALL_CHANNELS = 0xf;

/**
 * The depth test of a pipeline's state flags, in reversed depth: nearer surfaces pass, every one
 * passes without the test, and only the surface at the target's depth passes after the depth
 * prepass.
 */
function depthCompare(stateFlags: number): GPUCompareFunction {
	if (stateFlags & STATE_NO_DEPTH_TEST) return 'always';
	return stateFlags & STATE_DEPTH_EQUAL ? 'equal' : 'greater';
}

/**
 * WebGPU's vertex format of each vertex attribute type, by code, for attributes that shaders read
 * as floats. WebGPU has no format that reads plain integers as whole floats, so it reads them as
 * their normalized twins, and the shader multiplies them back (`plainScale`).
 */
const FLOAT_READS: Readonly<Record<number, string>> = {
	[VERTEX_TYPE_F32]: 'float32',
	[VERTEX_TYPE_UNORM8]: 'unorm8',
	[VERTEX_TYPE_SNORM8]: 'snorm8',
	[VERTEX_TYPE_UNORM16]: 'unorm16',
	[VERTEX_TYPE_SNORM16]: 'snorm16',
	[VERTEX_TYPE_UINT8]: 'unorm8',
	[VERTEX_TYPE_SINT8]: 'snorm8',
	[VERTEX_TYPE_UINT16]: 'unorm16',
	[VERTEX_TYPE_SINT16]: 'snorm16',
};

/** WebGPU's vertex format of each plain integer type, by code, for attributes read as integers. */
const WHOLE_READS: Readonly<Record<number, string>> = {
	[VERTEX_TYPE_UINT8]: 'uint8',
	[VERTEX_TYPE_SINT8]: 'sint8',
	[VERTEX_TYPE_UINT16]: 'uint16',
	[VERTEX_TYPE_SINT16]: 'sint16',
};

/** The WebGPU vertex format that reads an attribute. */
export function gpuVertexFormat(attribute: VertexAttribute): GPUVertexFormat {
	const base = attribute.integer ? WHOLE_READS[attribute.type] : FLOAT_READS[attribute.type];
	if (!base) throw new Error(`no WebGPU vertex format reads vertex type ${attribute.type}`);
	return (attribute.size === 1 ? base : `${base}x${attribute.size}`) as GPUVertexFormat;
}

/** The id of the pipeline constant that scales the attribute at a location: 1000 plus it. */
const SCALE_ID = 1000;

/** The mesh locations that a template's variant reads, or undefined for a template without meshes. */
function meshLocations(t: RenderTemplate, permutation: number): number[] | undefined {
	return t.meshLocations && variantLocations(t.meshLocations, permutation);
}

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
	const locations = meshLocations(t, permutation);
	if (!locations) return t.vertexBuffers;
	const attributes = locations.map((shaderLocation): GPUVertexAttribute => {
		const attribute = vertexAttribute(vertexFormat, shaderLocation);
		if (!attribute)
			throw new Error(`vertex format ${vertexFormat} has no attribute at ${shaderLocation}`);
		return { shaderLocation, offset: attribute.offset, format: gpuVertexFormat(attribute) };
	});
	const mesh: GPUVertexBufferLayout = {
		arrayStride: vertexStride(vertexFormat),
		stepMode: 'vertex',
		attributes,
	};
	return [mesh, ...t.vertexBuffers];
}

/**
 * The pipeline constants that scale a mesh's plain integer attributes back to whole values, for
 * each location the variant reads whose constant its WGSL declares. Shaders that declare none
 * read such attributes as fractions.
 */
function scaleConstants(
	t: RenderTemplate,
	shader: WgslShader,
	vertexFormat: number,
	permutation: number,
): Record<string, number> | undefined {
	let constants: Record<string, number> | undefined;
	for (const location of meshLocations(t, permutation) ?? []) {
		const attribute = vertexAttribute(vertexFormat, location);
		const scale = attribute ? plainScale(attribute) : 1;
		const id = SCALE_ID + location;
		if (scale === 1 || !shader.source.includes(`@id(${id})`)) continue;
		constants ??= {};
		constants[id] = scale;
	}
	return constants;
}

export class Pipelines {
	private readonly layouts: (GPUBindGroupLayout | undefined)[] = [];
	private readonly templates: (RenderTemplate | undefined)[] = [];
	/**
	 * Each template's pipeline layout, made for its first pipeline, and its layout with the joint
	 * texture's group after its own, for the builds that skin in the vertex shader.
	 */
	private readonly pipelineLayouts: (GPUPipelineLayout | undefined)[] = [];
	private readonly skinLayouts: (GPUPipelineLayout | undefined)[] = [];
	private readonly cullLayout: GPUPipelineLayout;
	private readonly cull: WgslShader | undefined;
	private readonly lightLayout: GPUPipelineLayout;
	private readonly lightClusters: WgslShader | undefined;
	private readonly skinLayout: GPUPipelineLayout;
	/** The skinning pass's builds, which arrive with the skinning feature's shader file. */
	private readonly skin: ShaderVariants;
	private readonly mipmap: WgslShader | undefined;
	private readonly modules = new Map<WgslShader, GPUShaderModule>();
	/** The module of the fragment shader that writes nothing, made at its first use. */
	private emptyFragment: GPUShaderModule | undefined;
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
		// The materials' custom values, the table of specular terms, then the shadow map, whose
		// depths the receivers read as floats, the sampler that compares depths in the shadow
		// atlas, the cascades, the camera's light grid and light list, the shadow atlas of point and
		// spot lights with its tiles, ambient occlusion's texture, which the lit shading reads with
		// textureLoad, the environment's cube map with its filtering sampler, and the sampler that
		// reads four texels of the shadow map at once.
		this.defineLayout(LAYOUT_FRAME, 'frame', [
			...frameEntries,
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX | fragment,
				texture: { sampleType: 'unfilterable-float' },
			},
			{ binding: 3, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
			{
				binding: 4,
				visibility: fragment,
				texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
			},
			{ binding: 5, visibility: fragment, sampler: { type: 'comparison' } },
			{ binding: 6, visibility: fragment, buffer: { type: 'uniform' } },
			// The light grid and the light list of the camera's point and spot lights.
			{ binding: 7, visibility: fragment, buffer: { type: 'read-only-storage' } },
			{ binding: 8, visibility: fragment, buffer: { type: 'read-only-storage' } },
			{
				binding: 9,
				visibility: fragment,
				texture: { sampleType: 'depth', viewDimension: '2d-array' },
			},
			{ binding: 10, visibility: fragment, buffer: { type: 'uniform' } },
			{ binding: 11, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 12, visibility: fragment, texture: { viewDimension: 'cube' } },
			{ binding: 13, visibility: fragment, sampler: {} },
			{ binding: 14, visibility: fragment, sampler: { type: 'non-filtering' } },
		]);
		this.defineLayout(LAYOUT_TEXTURES, 'textures', [
			{ binding: 0, visibility: fragment, texture: { viewDimension: '2d-array' } },
			{ binding: 1, visibility: fragment, sampler: {} },
		]);
		// A texture array for each map slot, then each slot's sampler. Custom materials' vertex
		// stages sample their textures too.
		const maps = GPUShaderStage.VERTEX | fragment;
		this.defineLayout(LAYOUT_MATERIAL_MAPS, 'material maps', [
			...MAP_SLOTS.map(
				(binding): GPUBindGroupLayoutEntry => ({
					binding,
					visibility: maps,
					texture: { viewDimension: '2d-array' },
				}),
			),
			...MAP_SLOTS.map(
				(slot): GPUBindGroupLayoutEntry => ({
					binding: MAP_SLOTS.length + slot,
					visibility: maps,
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
		// Light clustering's parameters, the light list, and the light grid that it fills.
		this.defineLayout(LAYOUT_LIGHT_CLUSTERS, 'light clusters', [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		]);
		// The joint texture, which the builds that skin in the vertex shader read.
		this.defineLayout(LAYOUT_JOINTS, 'joints', [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				texture: { sampleType: 'unfilterable-float' },
			},
		]);
		// The skinning pass's table of formats and parts, a mesh page's vertices, the skinned
		// vertices that it writes, the joint matrices, and the morph textures of deltas and of
		// weights, which it reads with textureLoad.
		const computeData: GPUBindGroupLayoutEntry['texture'] = { sampleType: 'unfilterable-float' };
		this.defineLayout(LAYOUT_SKIN, 'skin', [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, texture: computeData },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, texture: computeData },
			{ binding: 5, visibility: GPUShaderStage.COMPUTE, texture: computeData },
		]);
		// The final pass reads the scene color with textureLoad, which takes any float format, and
		// its color grading table, a 3D texture, with a linear filter, which reads the outline mask
		// too.
		const finalEntries: GPUBindGroupLayoutEntry[] = [
			{ binding: 0, visibility: fragment, buffer: { type: 'uniform' } },
			{
				binding: 1,
				visibility: fragment,
				texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
			},
			{ binding: 9, visibility: fragment, texture: { viewDimension: '3d' } },
			{ binding: 10, visibility: fragment, sampler: {} },
			{ binding: 11, visibility: fragment, texture: {} },
		];
		this.defineLayout(LAYOUT_FINAL, 'final', finalEntries);
		// The base level of bloom's chain, which the final pass's bloom build reads with a linear
		// filter, after its settings.
		this.defineLayout(LAYOUT_FINAL_BLOOM, 'final bloom', [
			...finalEntries,
			{ binding: 2, visibility: fragment, buffer: { type: 'uniform' } },
			{ binding: 3, visibility: fragment, texture: {} },
			{ binding: 8, visibility: fragment, sampler: {} },
		]);
		// A step of bloom: its settings, the texture it reads, and the linear sampler.
		this.defineLayout(LAYOUT_BLOOM, 'bloom', [
			{ binding: 0, visibility: fragment, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: fragment, texture: {} },
			{ binding: 2, visibility: fragment, sampler: {} },
		]);
		// Ambient occlusion's steps read every texture with textureLoad. The depth step reads the
		// depth target as plain floats: compatibility mode reads no depth texture type with
		// textureLoad, and it does read a depth format bound as unfilterable floats.
		const aoSettings: GPUBindGroupLayoutEntry = {
			binding: 0,
			visibility: fragment,
			buffer: { type: 'uniform' },
		};
		const unfiltered = (binding: number, multisampled = false): GPUBindGroupLayoutEntry => ({
			binding,
			visibility: fragment,
			texture: { sampleType: 'unfilterable-float', multisampled },
		});
		this.defineLayout(LAYOUT_AO_DEPTH, 'ao depth', [aoSettings, unfiltered(1)]);
		this.defineLayout(LAYOUT_AO_DEPTH_MS, 'ao depth ms', [aoSettings, unfiltered(1, true)]);
		this.defineLayout(LAYOUT_AO, 'ao', [aoSettings, unfiltered(1), unfiltered(2)]);
		// The far shadow cascades' cache, which the copy into a cascade's layer reads with
		// textureLoad, as ambient occlusion reads the depth target.
		this.defineLayout(LAYOUT_SHADOW_RESTORE, 'shadow restore', [
			{
				binding: 0,
				visibility: fragment,
				texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
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
			[TEMPLATE_SHADOW_DEPTH, 'shadow depth', shaders.shadow_depth, [0, 1], [LAYOUT_DEPTH]],
			[TEMPLATE_OUTLINE_MASK, 'outline mask', shaders.outline_mask, [0, 1], [LAYOUT_DEPTH]],
			[TEMPLATE_SPRITE, 'sprite', shaders.sprite, [0, 2], [LAYOUT_FRAME]],
			[TEMPLATE_LINE, 'line', shaders.line, [0], [LAYOUT_FRAME]],
			[TEMPLATE_LINE_LIT, 'lit line', shaders.line_lit, [0], [LAYOUT_FRAME]],
			[
				TEMPLATE_SPRITE_MAP,
				'sprite map',
				shaders.sprite_map,
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
				ownPrepass: id === TEMPLATE_SPRITE || id === TEMPLATE_SPRITE_MAP,
			});
		}
		this.defineTemplate(TEMPLATE_FINAL, {
			label: 'final',
			shader: shaders.final,
			pipeline: 'main',
			layouts: [LAYOUT_FINAL],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_FINAL_BLOOM, {
			label: 'final bloom',
			shader: shaders.final,
			pipeline: 'main',
			layouts: [LAYOUT_FINAL_BLOOM],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_BLOOM, {
			label: 'bloom',
			shader: shaders.bloom,
			pipeline: 'main',
			layouts: [LAYOUT_BLOOM],
			vertexBuffers: [],
		});
		for (const [id, label, shader, pipeline, layout] of [
			[TEMPLATE_AO_DEPTH, 'ao depth', shaders.ao, 'depth', LAYOUT_AO_DEPTH],
			[TEMPLATE_AO_DEPTH_MS, 'ao depth ms', shaders.ao_ms, 'depth', LAYOUT_AO_DEPTH_MS],
			[TEMPLATE_AO, 'ao horizon', shaders.ao, 'horizon', LAYOUT_AO],
			[TEMPLATE_AO_DENOISE, 'ao denoise', shaders.ao, 'denoise', LAYOUT_AO],
		] as const) {
			this.defineTemplate(id, { label, shader, pipeline, layouts: [layout], vertexBuffers: [] });
		}
		this.defineTemplate(TEMPLATE_SHADOW_RESTORE, {
			label: 'shadow restore',
			shader: shaders.shadow_restore,
			pipeline: 'main',
			layouts: [LAYOUT_SHADOW_RESTORE],
			vertexBuffers: [],
			writesDepth: true,
		});
		this.defineTemplate(TEMPLATE_BACKGROUND, {
			label: 'background',
			shader: shaders.background,
			pipeline: 'main',
			layouts: [LAYOUT_FRAME, LAYOUT_TEXTURES],
			vertexBuffers: [],
		});
		if (DEV) {
			this.defineTemplate(TEMPLATE_DEBUG_LINES, {
				label: 'debug lines',
				shader: DEBUG_LINES_SHADER,
				pipeline: 'main',
				layouts: [LAYOUT_FRAME],
				vertexBuffers: [LINE_VERTICES],
			});
			this.defineTemplate(TEMPLATE_DEBUG_VIEW, {
				label: 'mesh debug view',
				shader: DEBUG_VIEW_SHADER,
				pipeline: 'main',
				layouts: [LAYOUT_FRAME],
				meshLocations: [0, 1],
				vertexBuffers: INSTANCE_BUFFERS,
			});
		}
		this.cullLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_CULL)] });
		this.cull = variantFor(shaders.cull, 0, 'wgsl')?.wgsl ?? undefined;
		this.lightLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_LIGHT_CLUSTERS)],
		});
		this.lightClusters = variantFor(shaders.light_clusters, 0, 'wgsl')?.wgsl ?? undefined;
		this.skinLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_SKIN)] });
		this.skin = shaders.skin;
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
	 * A material with textures binds them in the slots of the maps' layout.
	 */
	defineCustom(id: number, shader: CustomShader): void {
		this.defineTemplate(id, {
			label: `custom material ${id}`,
			shader: shader.variants,
			pipeline: 'main',
			layouts: shader.textures > 0 ? [LAYOUT_FRAME, LAYOUT_MATERIAL_MAPS] : [LAYOUT_FRAME],
			meshLocations: shader.locations,
			vertexBuffers: INSTANCE_BUFFERS,
			ownPrepass: true,
		});
	}

	/** True when a template has this id. */
	has(id: number): boolean {
		return this.templates[id] !== undefined;
	}

	/** The shader variants of a template that exists. */
	variants(id: number): ShaderVariants {
		const template = this.templates[id];
		if (!template) throw new Error(`unknown render template ${id}`);
		return template.shader;
	}

	/**
	 * Adds a render pipeline template under an id that no other template has. The shader of a
	 * feature that loads on first use has no variants until its module arrives.
	 */
	defineTemplate(id: number, template: RenderTemplate): void {
		if (this.templates[id]) throw new Error(`render pipeline template ${id} already exists`);
		const variants = Object.values(template.shader);
		if (
			variants.length > 0 &&
			!variants.some((variant) => variant.wgsl?.pipelines[template.pipeline])
		)
			throw new Error(`the shader of template ${id} has no pipeline ${template.pipeline}`);
		this.templates[id] = template;
	}

	layout(id: number): GPUBindGroupLayout {
		const layout = this.layouts[id];
		if (!layout) throw new Error(`unknown bind group layout ${id}`);
		return layout;
	}

	/** Creates the shader module of `shader` ahead of the pipelines that will share it. */
	prepareModule(label: string, shader: WgslShader): void {
		this.module(label, shader);
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
	 * draws depth only, and with the state that writes no color it keeps the color target untouched.
	 * The depth bias is in reversed depth, as the draw list holds it.
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
		const ownPrepass = t.ownPrepass === true && (permutation & PERMUTATION_PREPASS) !== 0;
		const build = ownPrepass ? permutation & ~PERMUTATION_PREPASS : permutation;
		const shader = variantFor(t.shader, build, 'wgsl')?.wgsl;
		if (!shader)
			throw new Error(`render template ${template} has no variant for permutation ${permutation}`);
		const module = this.module(t.label, shader);
		const entryPoints = shader.pipelines[t.pipeline];
		const skins = (permutation & PERMUTATION_SKIN) !== 0;
		const layouts = skins ? this.skinLayouts : this.pipelineLayouts;
		let layout = layouts[template];
		if (!layout) {
			const groups = skins ? [...t.layouts, LAYOUT_JOINTS] : t.layouts;
			layout = this.device.createPipelineLayout({
				label: t.label,
				bindGroupLayouts: groups.map((id) => this.layout(id)),
			});
			layouts[template] = layout;
		}
		return {
			label: t.label,
			layout,
			vertex: {
				module,
				entryPoint: entryPoints?.vertex,
				buffers: vertexBuffers(t, vertexFormat, permutation),
				constants: scaleConstants(t, shader, vertexFormat, permutation),
			},
			fragment: colorFormat
				? {
						module: ownPrepass ? this.emptyFragmentModule() : module,
						entryPoint: ownPrepass ? 'fs' : entryPoints?.fragment,
						targets: [
							{
								format: colorFormat,
								blend: BLENDS[stateFlags & STATE_BLEND],
								writeMask: stateFlags & STATE_NO_COLOR_WRITE ? 0 : ALL_CHANNELS,
							},
						],
					}
				: t.writesDepth
					? { module, entryPoint: entryPoints?.fragment, targets: [] }
					: undefined,
			primitive: {
				topology: stateFlags & STATE_LINE_LIST ? 'line-list' : 'triangle-list',
				cullMode:
					stateFlags & STATE_CULL_NONE ? 'none' : stateFlags & STATE_CULL_FRONT ? 'front' : 'back',
				frontFace: 'ccw',
			},
			// Reversed depth: 1 at the near plane, 0 at the far plane. Without the depth test a surface
			// writes no depth either, as in three.js's WebGL renderer. After the depth prepass, the
			// opaque pass draws only at the depth that the prepass found. Compatibility mode needs a
			// bias clamp of 0.
			depthStencil: depthFormat
				? {
						format: depthFormat,
						depthWriteEnabled: (stateFlags & (STATE_NO_DEPTH_WRITE | STATE_NO_DEPTH_TEST)) === 0,
						depthCompare: depthCompare(stateFlags),
						depthBias,
						depthBiasSlopeScale,
						depthBiasClamp: 0,
					}
				: undefined,
			multisample: { count: sampleCount },
		};
	}

	/** The module of the fragment shader that writes nothing, which a template's own prepass draws with. */
	private emptyFragmentModule(): GPUShaderModule {
		this.emptyFragment ??= this.device.createShaderModule({
			label: 'empty fragment',
			code: EMPTY_FRAGMENT,
		});
		return this.emptyFragment;
	}

	/**
	 * Starts to build the pipelines that make mip levels, in the background, for each format whose
	 * levels the GPU makes. The first texture of each format then makes its levels without a
	 * compile inside the frame. A build that fails is made again at first use, which reports it.
	 */
	prebuildMipmaps(): void {
		if (!this.mipmap) return;
		for (const format of MIP_FORMATS)
			this.device.createRenderPipelineAsync(this.mipDescriptor(format)).then(
				(pipeline) => {
					if (!this.mipPipelines.has(format)) this.mipPipelines.set(format, pipeline);
				},
				() => {},
			);
	}

	/**
	 * The pipeline that makes mip levels of textures of `format`: the one built in the background
	 * when it is done, else one made at once.
	 */
	mipmaps(format: GPUTextureFormat): GPURenderPipeline {
		let pipeline = this.mipPipelines.get(format);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline(this.mipDescriptor(format));
			this.mipPipelines.set(format, pipeline);
		}
		return pipeline;
	}

	/** How to build the pipeline that makes mip levels of textures of `format`. */
	private mipDescriptor(format: GPUTextureFormat): GPURenderPipelineDescriptor {
		const shader = this.mipmap;
		if (!shader) throw new Error("the device's shader module has no mip level shader");
		const module = this.module('mipmaps', shader);
		const entryPoints = shader.pipelines.main;
		return {
			label: 'mipmaps',
			layout: 'auto',
			vertex: { module, entryPoint: entryPoints?.vertex },
			fragment: { module, entryPoint: entryPoints?.fragment, targets: [{ format }] },
		};
	}

	/**
	 * The shader variants of a compute template whose shader loads on first use, the skinning pass's,
	 * or undefined for a template whose shader the device's module of the start holds.
	 */
	computeVariants(template: number): ShaderVariants | undefined {
		return template === TEMPLATE_SKIN ? this.skin : undefined;
	}

	/** How to build a compute pipeline of a template: culling, skinning, or a step of light clustering. */
	compute(template: number): GPUComputePipelineDescriptor {
		if (template === TEMPLATE_SKIN) {
			const skin = variantFor(this.skin, 0, 'wgsl')?.wgsl;
			if (!skin) throw new Error("the device's shader modules have no skinning shader");
			return {
				label: 'skin',
				layout: this.skinLayout,
				compute: { module: this.module('skin', skin), entryPoint: 'main' },
			};
		}
		if (template === TEMPLATE_CULL) {
			if (!this.cull) throw new Error("the device's shader module has no culling shader");
			return {
				label: 'cull',
				layout: this.cullLayout,
				compute: { module: this.module('cull', this.cull), entryPoint: CULL_ENTRY_POINT },
			};
		}
		const entryPoint = LIGHT_ENTRY_POINTS[template];
		if (!entryPoint) throw new Error(`unknown compute template ${template}`);
		const shader = this.lightClusters;
		if (!shader) throw new Error("the device's shader module has no light clustering shader");
		return {
			label: entryPoint,
			layout: this.lightLayout,
			compute: { module: this.module('light clusters', shader), entryPoint },
		};
	}
}
