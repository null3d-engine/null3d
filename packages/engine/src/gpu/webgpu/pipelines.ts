// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, from the shaders that the device loaded,
// and a page can add more, as the texture test page does. Only development builds define the
// templates of the debug lines and the debug views, so release builds hold none of their code.

import {
	LAYOUT_AO,
	LAYOUT_AO_DEPTH,
	LAYOUT_AO_DEPTH_MS,
	LAYOUT_BACKGROUND,
	LAYOUT_BLOOM,
	LAYOUT_CULL,
	LAYOUT_DEPTH,
	LAYOUT_DEPTH_PYRAMID,
	LAYOUT_DOF_COMPOSITE,
	LAYOUT_DOF_COMPOSITE_MS,
	LAYOUT_EFFECT,
	LAYOUT_EFFECT_DEPTH_MS,
	LAYOUT_FINAL,
	LAYOUT_FINAL_BLOOM,
	LAYOUT_FINAL_EFFECTS,
	LAYOUT_FINAL_EFFECTS_DEPTH_MS,
	LAYOUT_FRAME,
	LAYOUT_INSTANCE_INDEX,
	LAYOUT_JOINTS,
	LAYOUT_LIGHT_CLUSTERS,
	LAYOUT_MATERIAL_MAPS,
	LAYOUT_SKIN,
	LAYOUT_TEXTURES,
	LAYOUT_VIEW_COPY,
	PERMUTATION_DEPTH_MULTISAMPLED,
	PERMUTATION_INSTANCE_INDEX,
	PERMUTATION_PREPASS,
	PERMUTATION_SKIN,
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	SIZE_INDEX_STRIDE,
	SIZE_INSTANCE_STRIDE,
	SIZE_MAP_SLOTS,
	STATE_ALPHA_TO_COVERAGE,
	STATE_BLEND,
	STATE_BLEND_ADDITIVE,
	STATE_BLEND_MULTIPLY,
	STATE_BLEND_NORMAL,
	STATE_CULL_FRONT,
	STATE_CULL_NONE,
	STATE_DEPTH_EQUAL,
	STATE_DEPTH_OR_EQUAL,
	STATE_LINE_LIST,
	STATE_NO_COLOR_WRITE,
	STATE_NO_DEPTH_TEST,
	STATE_NO_DEPTH_WRITE,
	TEMPLATE_AO,
	TEMPLATE_AO_DENOISE,
	TEMPLATE_AO_DEPTH,
	TEMPLATE_AO_DEPTH_MS,
	TEMPLATE_BACKGROUND,
	TEMPLATE_BACKGROUND_CUBE,
	TEMPLATE_BACKGROUND_SKY,
	TEMPLATE_BLOOM,
	TEMPLATE_CULL,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_DEBUG_VIEW,
	TEMPLATE_DEPTH_PYRAMID,
	TEMPLATE_DOF_BLUR,
	TEMPLATE_DOF_COMPOSITE,
	TEMPLATE_DOF_COMPOSITE_MS,
	TEMPLATE_DOF_FILTER,
	TEMPLATE_DOF_SETUP,
	TEMPLATE_DOF_SETUP_MS,
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
	TEMPLATE_OCCLUSION_EARLY,
	TEMPLATE_OCCLUSION_LATE,
	TEMPLATE_OUTLINE_MASK,
	TEMPLATE_SHADOW_CUTOUT,
	TEMPLATE_SHADOW_CUTOUT_MAP,
	TEMPLATE_SHADOW_DEPTH,
	TEMPLATE_SKIN,
	TEMPLATE_SPRITE,
	TEMPLATE_SPRITE_MAP,
	TEMPLATE_TRANSMISSION_COPY,
	TEMPLATE_VIEW_COPY,
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

declare const __NULL3D_DEV__: boolean | undefined;

/**
 * True in development builds, which add the debug views' templates. This file reads the constant
 * itself, as the files that load on first use do. It loads with its GPU path's renderers, apart from
 * the start's files, so a check through the shared constant would keep the debug views' shaders in
 * the start's files of a production build. A check that folds within this file drops them.
 */
const DEV: boolean = typeof __NULL3D_DEV__ === 'undefined' ? true : __NULL3D_DEV__;

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
	 * For a custom effect's template: the layouts of its builds that read a multisampled depth, the
	 * pipelines whose permutation has the DEPTH_MULTISAMPLED bit.
	 */
	readonly multisampledLayouts?: readonly number[];
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
	 * True for a template whose fragment shader runs in pipelines that draw depth only, as the
	 * masked casters' does: it discards the fragments that their alpha cuts. Other templates draw
	 * depth only with no fragment stage.
	 */
	readonly depthFragment?: boolean;
}

/** The fragment shader of a prepass that draws with a template's own vertex shader. */
const EMPTY_FRAGMENT = '@fragment\nfn fs() -> @location(0) vec4f {\n    return vec4f(0.0);\n}\n';

/** The map slots of a standard material, one texture array and sampler each. */
const MAP_SLOTS = Array.from({ length: SIZE_MAP_SLOTS }, (_, slot) => slot);

/** The culling shader's compute entry point. */
const CULL_ENTRY_POINT = 'main';

/** The entry points of occlusion culling's two phases, in the culling shader's occlusion build. */
const OCCLUSION_ENTRY_POINTS: Readonly<Record<number, string>> = {
	[TEMPLATE_OCCLUSION_EARLY]: 'early',
	[TEMPLATE_OCCLUSION_LATE]: 'late',
};

/**
 * The skinning pass's builds, by their permutation bits: with the vertex tangent's code for formats
 * that have a tangent, and with the vertex color's for formats whose color the pass morphs.
 */
export const SKIN_BUILDS = [
	0,
	PERMUTATION_VERTEX_TANGENT,
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT | PERMUTATION_VERTEX_COLOR,
] as const;

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
 * The compacted index that a mesh draw's instances read in the builds that read their instances by
 * index: the source's index, from which the vertex shader reads the rest.
 */
const INDEX_BUFFERS: GPUVertexBufferLayout[] = [
	{
		arrayStride: SIZE_INDEX_STRIDE,
		stepMode: 'instance',
		attributes: [{ shaderLocation: VERTEX_INSTANCE_LOCATION, offset: 0, format: 'uint32' }],
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
 * passes without the test, only the surface at the target's depth passes after the depth prepass,
 * and a background at the far plane passes where no object wrote depth.
 */
function depthCompare(stateFlags: number): GPUCompareFunction {
	if (stateFlags & STATE_NO_DEPTH_TEST) return 'always';
	if (stateFlags & STATE_DEPTH_OR_EQUAL) return 'greater-equal';
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
/** The id of the skinning pass's pipeline constant that writes normals and tangents in 8 bits. */
const NARROW_DIRECTIONS_ID = 1100;

/** The mesh locations that a template's variant reads, or undefined for a template without meshes. */
function meshLocations(t: RenderTemplate, permutation: number): number[] | undefined {
	return t.meshLocations && variantLocations(t.meshLocations, permutation);
}

/**
 * The vertex buffers of a template's pipeline: a mesh's vertices first, for a template that draws
 * meshes, with each location it reads where the vertex format places it. The variants with vertex
 * colors read the mesh's colors too. The builds that read their instances by index take an index
 * per instance in place of the template's compacted instance.
 */
function vertexBuffers(
	t: RenderTemplate,
	vertexFormat: number,
	permutation: number,
): GPUVertexBufferLayout[] {
	const locations = meshLocations(t, permutation);
	if (!locations) return t.vertexBuffers;
	const instances = permutation & PERMUTATION_INSTANCE_INDEX ? INDEX_BUFFERS : t.vertexBuffers;
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
	return [mesh, ...instances];
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
	/**
	 * True when the skinning pass writes normals and tangents as 32-bit floats, in place of 8-bit
	 * integers, as the core's skinned vertex format then has them. Only the switch that measures
	 * the two asks for it.
	 */
	floatSkinnedDirections = false;
	private readonly layouts: (GPUBindGroupLayout | undefined)[] = [];
	/** The layouts that only some devices bind, which the first pipeline or bind group to use them makes. */
	private readonly laterLayouts: (GPUBindGroupLayoutDescriptor | undefined)[] = [];
	private readonly templates: (RenderTemplate | undefined)[] = [];
	/**
	 * Each template's pipeline layouts, made for their first pipelines, by the groups after the
	 * template's own: the joint texture's for the builds that skin in the vertex shader, then the
	 * view's index group for the builds that read their instances by index.
	 */
	private readonly pipelineLayouts = new Map<number, GPUPipelineLayout>();
	private readonly cullLayout: GPUPipelineLayout;
	private readonly cull: WgslShader | undefined;
	/**
	 * The builds of occlusion culling's two phases and of its depth pyramid, which arrive with the
	 * occlusion feature's shader file.
	 */
	private readonly occlusion: ShaderVariants;
	private readonly pyramid: ShaderVariants;
	private readonly pyramidLayout: GPUPipelineLayout;
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
		// textureLoad, the environment's cube map with its filtering sampler, the sampler that reads
		// four texels of the shadow map at once, and the copy of the opaque color that surfaces which
		// let light through sample with the environment's sampler.
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
			{ binding: 15, visibility: fragment, texture: { viewDimension: '2d-array' } },
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
		const compute = GPUShaderStage.COMPUTE;
		// The culling pipelines' parameters, the scene's tables, the compacted instances and indirect
		// draws, then the depth pyramid of occlusion culling, whose first word counts the frame's
		// occluders. Their history shares the buffer of the indirect draws, as eight storage buffers
		// is all that every device allows a shader stage.
		this.defineLayout(LAYOUT_CULL, 'cull', [
			{ binding: 0, visibility: compute, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 3, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 4, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 5, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 6, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 7, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 8, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 9, visibility: compute, texture: { sampleType: 'unfilterable-float' } },
		]);
		// A batch's parameters at a dynamic offset, the pyramid, and the occluders' depth, read with
		// textureLoad as a float texture: compatibility mode forbids depth textures in textureLoad.
		this.defineLayout(LAYOUT_DEPTH_PYRAMID, 'depth pyramid', [
			{ binding: 0, visibility: compute, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 2, visibility: compute, texture: { sampleType: 'unfilterable-float' } },
		]);
		// The view's culling parameters, for its row of the cell offsets texture, the world matrices,
		// the bucket table, the bucket records and the cell offsets texture, which the vertex shaders
		// of the builds that read their instances by index read. Compatibility mode may have no storage buffers
		// in vertex shaders, and refuses the layout itself, so only core WebGPU makes and binds it.
		const vertex = GPUShaderStage.VERTEX;
		this.defineLayout(
			LAYOUT_INSTANCE_INDEX,
			'instance index',
			[
				{ binding: 0, visibility: vertex, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: vertex, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: vertex, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: vertex, buffer: { type: 'read-only-storage' } },
				{ binding: 4, visibility: vertex, texture: { sampleType: 'unfilterable-float' } },
			],
			true,
		);
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
		// The background's values, which the sky's vertex stage reads too, a cube map and its
		// filtering sampler.
		this.defineLayout(LAYOUT_BACKGROUND, 'background', [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | fragment, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: fragment, texture: { viewDimension: 'cube' } },
			{ binding: 2, visibility: fragment, sampler: {} },
		]);
		// The copy of a view's image into its target reads the image with textureLoad.
		this.defineLayout(LAYOUT_VIEW_COPY, 'view copy', [unfiltered(0)]);
		// A custom effect: its block, the color it reads with a linear filter and the sampler, then
		// the scene's depth as plain floats, or a blank texture where the effect reads no depth.
		const effectEntries: GPUBindGroupLayoutEntry[] = [
			aoSettings,
			{ binding: 1, visibility: fragment, texture: {} },
			{ binding: 2, visibility: fragment, sampler: {} },
		];
		this.defineLayout(LAYOUT_EFFECT, 'effect', [...effectEntries, unfiltered(3)]);
		this.defineLayout(LAYOUT_EFFECT_DEPTH_MS, 'effect depth ms', [
			...effectEntries,
			unfiltered(3, true),
		]);
		// Depth of field's composite: an effect's entries with the scene's depth, then the blurred
		// image, which it reads with the linear sampler.
		const blurred: GPUBindGroupLayoutEntry = { binding: 4, visibility: fragment, texture: {} };
		this.defineLayout(LAYOUT_DOF_COMPOSITE, 'dof', [...effectEntries, unfiltered(3), blurred]);
		this.defineLayout(LAYOUT_DOF_COMPOSITE_MS, 'dof ms', [
			...effectEntries,
			unfiltered(3, true),
			blurred,
		]);
		// The final pass with custom effects folded into it: the pass's own entries, then every
		// effect's block and the scene's depth, which the effects read as a group does. The effects
		// sample the scene color with a linear filter, so it binds as a filterable float texture:
		// effects run on the HDR path, whose color formats filter.
		const foldEntries: GPUBindGroupLayoutEntry[] = [
			...finalEntries.map((entry) =>
				entry.binding === 1 ? { binding: 1, visibility: fragment, texture: {} } : entry,
			),
			{ binding: 4, visibility: fragment, buffer: { type: 'uniform' } },
		];
		this.defineLayout(LAYOUT_FINAL_EFFECTS, 'final effects', [...foldEntries, unfiltered(5)]);
		this.defineLayout(LAYOUT_FINAL_EFFECTS_DEPTH_MS, 'final effects depth ms', [
			...foldEntries,
			unfiltered(5, true),
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
			[TEMPLATE_SHADOW_CUTOUT, 'shadow cutout', shaders.shadow_cutout, [0, 1], [LAYOUT_DEPTH]],
			[
				TEMPLATE_SHADOW_CUTOUT_MAP,
				'shadow cutout map',
				shaders.shadow_cutout_map,
				[0, 1, 2, 3],
				[LAYOUT_DEPTH, LAYOUT_TEXTURES],
			],
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
				depthFragment: id === TEMPLATE_SHADOW_CUTOUT || id === TEMPLATE_SHADOW_CUTOUT_MAP,
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
			[TEMPLATE_DOF_SETUP, 'dof setup', shaders.dof, 'setup', LAYOUT_EFFECT],
			[TEMPLATE_DOF_SETUP_MS, 'dof setup ms', shaders.dof_ms, 'setup', LAYOUT_EFFECT_DEPTH_MS],
			[TEMPLATE_DOF_BLUR, 'dof gather', shaders.dof, 'gather', LAYOUT_BLOOM],
			[TEMPLATE_DOF_FILTER, 'dof tent', shaders.dof, 'tent', LAYOUT_BLOOM],
			[TEMPLATE_DOF_COMPOSITE, 'dof composite', shaders.dof, 'composite', LAYOUT_DOF_COMPOSITE],
			[
				TEMPLATE_DOF_COMPOSITE_MS,
				'dof composite ms',
				shaders.dof_ms,
				'composite',
				LAYOUT_DOF_COMPOSITE_MS,
			],
		] as const) {
			this.defineTemplate(id, { label, shader, pipeline, layouts: [layout], vertexBuffers: [] });
		}
		this.defineTemplate(TEMPLATE_VIEW_COPY, {
			label: 'view copy',
			shader: shaders.view_copy,
			pipeline: 'main',
			layouts: [LAYOUT_VIEW_COPY],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_TRANSMISSION_COPY, {
			label: 'transmission copy',
			shader: shaders.transmission_copy,
			pipeline: 'main',
			layouts: [LAYOUT_VIEW_COPY],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_BACKGROUND, {
			label: 'background',
			shader: shaders.background,
			pipeline: 'main',
			layouts: [LAYOUT_FRAME, LAYOUT_TEXTURES, LAYOUT_BACKGROUND],
			vertexBuffers: [],
		});
		for (const [id, label, shader] of [
			[TEMPLATE_BACKGROUND_CUBE, 'background cube', shaders.background_cube],
			[TEMPLATE_BACKGROUND_SKY, 'background sky', shaders.sky],
		] as const) {
			this.defineTemplate(id, {
				label,
				shader,
				pipeline: 'main',
				layouts: [LAYOUT_FRAME, LAYOUT_BACKGROUND],
				vertexBuffers: [],
			});
		}
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
		this.occlusion = shaders.cull_occlusion;
		this.pyramid = shaders.pyramid;
		this.pyramidLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_DEPTH_PYRAMID)],
		});
		this.lightLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_LIGHT_CLUSTERS)],
		});
		this.lightClusters = variantFor(shaders.light_clusters, 0, 'wgsl')?.wgsl ?? undefined;
		this.skinLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_SKIN)] });
		this.skin = shaders.skin;
		this.mipmap = variantFor(shaders.mipmap, 0, 'wgsl')?.wgsl ?? undefined;
	}

	/**
	 * Adds a bind group layout under an id that no other layout has. With `onFirstUse`, the layout
	 * is made only when a pipeline or a bind group first needs it, for a layout that some devices
	 * cannot make.
	 */
	defineLayout(
		id: number,
		label: string,
		entries: GPUBindGroupLayoutEntry[],
		onFirstUse = false,
	): void {
		if (this.layouts[id] || this.laterLayouts[id])
			throw new Error(`bind group layout ${id} already exists`);
		if (onFirstUse) this.laterLayouts[id] = { label, entries };
		else this.layouts[id] = this.device.createBindGroupLayout({ label, entries });
	}

	/**
	 * Adds a template of the sketch's compiled WGSL. A custom material's is the standard material's
	 * template with the material's WGSL, in the shader variants that the plugin built, which also
	 * read the first texture coordinates. A material with textures binds them in the slots of the
	 * maps' layout. A custom effect's draws one triangle with the effect's layout, and so does a
	 * group of joined effects. A custom tone curve's binds as the final pass or its bloom build does,
	 * and the final pass with effects folded into it binds their buffer and the depth too.
	 */
	defineCustom(id: number, shader: CustomShader): void {
		const { kind } = shader;
		if (kind !== undefined) {
			const effect = kind === 'effect' || kind === 'effectGroup';
			const [layout, multisampled, label] = effect
				? [LAYOUT_EFFECT, LAYOUT_EFFECT_DEPTH_MS, `custom effect ${id}`]
				: kind === 'effectFold'
					? [LAYOUT_FINAL_EFFECTS, LAYOUT_FINAL_EFFECTS_DEPTH_MS, `folded effects ${id}`]
					: [
							kind === 'final' ? LAYOUT_FINAL : LAYOUT_FINAL_BLOOM,
							undefined,
							`custom tone curve ${id}`,
						];
			this.defineTemplate(id, {
				label,
				shader: shader.variants,
				pipeline: 'main',
				layouts: [layout],
				multisampledLayouts: multisampled === undefined ? undefined : [multisampled],
				vertexBuffers: [],
			});
			return;
		}
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

	/**
	 * Gives a custom material's template the shader of a hot update, and forgets the shader modules
	 * of its old shader. The pipelines that `render` describes from then on use the new shader.
	 */
	replaceCustom(id: number, shader: CustomShader): void {
		const old = this.templates[id];
		for (const variant of Object.values(old?.shader ?? {}))
			if (variant.wgsl) this.modules.delete(variant.wgsl);
		this.templates[id] = undefined;
		this.defineCustom(id, shader);
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
		if (layout) return layout;
		const later = this.laterLayouts[id];
		if (!later) throw new Error(`unknown bind group layout ${id}`);
		const made = this.device.createBindGroupLayout(later);
		this.layouts[id] = made;
		return made;
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
		const byIndex = (permutation & PERMUTATION_INSTANCE_INDEX) !== 0;
		const multisampled =
			t.multisampledLayouts !== undefined && (permutation & PERMUTATION_DEPTH_MULTISAMPLED) !== 0;
		const key = template * 8 + (skins ? 1 : 0) + (byIndex ? 2 : 0) + (multisampled ? 4 : 0);
		let layout = this.pipelineLayouts.get(key);
		if (!layout) {
			const groups = [
				...(multisampled ? (t.multisampledLayouts as readonly number[]) : t.layouts),
				...(skins ? [LAYOUT_JOINTS] : []),
				...(byIndex ? [LAYOUT_INSTANCE_INDEX] : []),
			];
			layout = this.device.createPipelineLayout({
				label: t.label,
				bindGroupLayouts: groups.map((id) => this.layout(id)),
			});
			this.pipelineLayouts.set(key, layout);
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
				: t.depthFragment
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
			multisample: {
				count: sampleCount,
				alphaToCoverageEnabled: (stateFlags & STATE_ALPHA_TO_COVERAGE) !== 0,
			},
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
	 * The shader variants of a compute template whose shader loads on first use, the skinning pass's
	 * or one of occlusion culling's, or undefined for a template whose shader the device's module of
	 * the start holds.
	 */
	computeVariants(template: number): ShaderVariants | undefined {
		if (template === TEMPLATE_SKIN) return this.skin;
		if (template === TEMPLATE_DEPTH_PYRAMID) return this.pyramid;
		return OCCLUSION_ENTRY_POINTS[template] !== undefined ? this.occlusion : undefined;
	}

	/**
	 * How to build a compute pipeline of a template: culling or a phase of occlusion culling, the
	 * depth pyramid, skinning, or a step of light clustering. The skinning pass takes the build of
	 * its permutation bits (see `SKIN_BUILDS`).
	 */
	compute(template: number, permutation: number): GPUComputePipelineDescriptor {
		if (template === TEMPLATE_SKIN) {
			const tangent = (permutation & PERMUTATION_VERTEX_TANGENT) !== 0 ? ' tangent' : '';
			const color = (permutation & PERMUTATION_VERTEX_COLOR) !== 0 ? ' color' : '';
			const shader = variantFor(this.skin, permutation, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no skinning shader");
			const constants = this.floatSkinnedDirections ? { [NARROW_DIRECTIONS_ID]: 0 } : undefined;
			return {
				label: `skin${tangent}${color}`,
				layout: this.skinLayout,
				compute: { module: this.module('skin', shader), entryPoint: 'main', constants },
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
		const phase = OCCLUSION_ENTRY_POINTS[template];
		if (phase) {
			const shader = variantFor(this.occlusion, 0, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no occlusion culling shader");
			return {
				label: `occlusion ${phase}`,
				layout: this.cullLayout,
				compute: { module: this.module('occlusion', shader), entryPoint: phase },
			};
		}
		if (template === TEMPLATE_DEPTH_PYRAMID) {
			const shader = variantFor(this.pyramid, 0, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no depth pyramid shader");
			return {
				label: 'depth pyramid',
				layout: this.pyramidLayout,
				compute: { module: this.module('depth pyramid', shader), entryPoint: 'main' },
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
