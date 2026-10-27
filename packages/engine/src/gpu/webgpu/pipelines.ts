// Standard bind group layouts and the render pipeline templates. Every render pipeline shares the
// layouts of its template's groups, so switching pipelines never forces a rebind of the per-frame
// group. The engine defines its own layouts and templates, from the shaders that the device loaded,
// and a page can add more, as the texture test page does. Only development builds define the
// templates of the debug lines and the debug views, so release builds hold none of their code.

import {
	FORMAT_R32_FLOAT,
	FORMAT_RGBA8_UNORM,
	LAYOUT_ACCUMULATE,
	LAYOUT_AO,
	LAYOUT_AO_DEPTH,
	LAYOUT_AO_DEPTH_MS,
	LAYOUT_ATMOSPHERE,
	LAYOUT_BACKGROUND,
	LAYOUT_BACKGROUND_LAYER,
	LAYOUT_BLOOM,
	LAYOUT_CLUSTER_CULL,
	LAYOUT_COMPUTE_HISTORY_R32_FLOAT,
	LAYOUT_COMPUTE_HISTORY_RGBA8_UNORM,
	LAYOUT_COMPUTE_HISTORY_RGBA16_FLOAT,
	LAYOUT_COMPUTE_INSTANCE_BUFFERS,
	LAYOUT_COMPUTE_R32_FLOAT,
	LAYOUT_COMPUTE_RGBA8_UNORM,
	LAYOUT_COMPUTE_RGBA16_FLOAT,
	LAYOUT_CULL,
	LAYOUT_DECAL_DEPTH,
	LAYOUT_DECAL_DEPTH_MS,
	LAYOUT_DECAL_FRAME,
	LAYOUT_DEPTH,
	LAYOUT_DEPTH_PYRAMID,
	LAYOUT_DOF_COMPOSITE,
	LAYOUT_DOF_COMPOSITE_MS,
	LAYOUT_EFFECT,
	LAYOUT_EFFECT_BLOOM,
	LAYOUT_EFFECT_BLOOM_DEPTH_MS,
	LAYOUT_EFFECT_DEPTH_MS,
	LAYOUT_EXPOSURE,
	LAYOUT_FEATURE_ROWS,
	LAYOUT_FINAL,
	LAYOUT_FINAL_BLOOM,
	LAYOUT_FINAL_EFFECTS,
	LAYOUT_FINAL_EFFECTS_DEPTH_MS,
	LAYOUT_FRAME,
	LAYOUT_FRAME_PARALLAX,
	LAYOUT_INSTANCE_INDEX,
	LAYOUT_JOINTS,
	LAYOUT_LIGHT_CLUSTERS,
	LAYOUT_MATERIAL_MAPS,
	LAYOUT_MATERIAL_MAPS_PARALLAX,
	LAYOUT_MATERIAL_MAPS_SCENE,
	LAYOUT_MATERIAL_SCENE,
	LAYOUT_MOTION_FRAME,
	LAYOUT_PARTICLE,
	LAYOUT_PARTICLE_DEPTH_MS,
	LAYOUT_PARTICLE_SCENE_DEPTH,
	LAYOUT_SKIN,
	LAYOUT_SSR_REDUCE,
	LAYOUT_SSR_TRACE,
	LAYOUT_SUBSURFACE_BLUR,
	LAYOUT_SUBSURFACE_COMPOSITE,
	LAYOUT_SUBSURFACE_COMPOSITE_MS,
	LAYOUT_TAA,
	LAYOUT_TAA_MS,
	LAYOUT_TEXTURES,
	LAYOUT_TRANSMISSION_COPY_MS,
	LAYOUT_VIEW_COPY,
	LAYOUT_WEIGHTED_COMPOSITE,
	LAYOUT_WEIGHTED_DEPTH_MS,
	PERMUTATION_ALPHA_MASK,
	PERMUTATION_CASTER,
	PERMUTATION_DEPTH_MULTISAMPLED,
	PERMUTATION_DISPLACEMENT,
	PERMUTATION_INSTANCE_INDEX,
	PERMUTATION_MOTION,
	PERMUTATION_PARALLAX,
	PERMUTATION_PICK,
	PERMUTATION_PREPASS,
	PERMUTATION_SKIN,
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	PERMUTATION_WEIGHTED,
	SIZE_INDEX_STRIDE,
	SIZE_INSTANCE_STRIDE,
	SIZE_MAP_SLOTS,
	SIZE_MOTION_INSTANCE_STRIDE,
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
	TEMPLATE_ACCUMULATE,
	TEMPLATE_AO,
	TEMPLATE_AO_DENOISE,
	TEMPLATE_AO_DEPTH,
	TEMPLATE_AO_DEPTH_MS,
	TEMPLATE_BACKGROUND,
	TEMPLATE_BACKGROUND_ATMOSPHERE,
	TEMPLATE_BACKGROUND_CUBE,
	TEMPLATE_BACKGROUND_SKY,
	TEMPLATE_BLOOM,
	TEMPLATE_CLUSTER,
	TEMPLATE_CULL,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_DEBUG_VIEW,
	TEMPLATE_DECAL,
	TEMPLATE_DECAL_MAPS,
	TEMPLATE_DEPTH_PYRAMID,
	TEMPLATE_DOF_BLUR,
	TEMPLATE_DOF_COMPOSITE,
	TEMPLATE_DOF_COMPOSITE_MS,
	TEMPLATE_DOF_FILTER,
	TEMPLATE_DOF_SETUP,
	TEMPLATE_DOF_SETUP_MS,
	TEMPLATE_EXPOSURE_ADAPT,
	TEMPLATE_EXPOSURE_ADAPT_HISTOGRAM,
	TEMPLATE_EXPOSURE_HISTOGRAM,
	TEMPLATE_EXPOSURE_LUMINANCE,
	TEMPLATE_FEATURE_ROWS,
	TEMPLATE_FINAL,
	TEMPLATE_FINAL_BLOOM,
	TEMPLATE_FOG_APPLY,
	TEMPLATE_FOG_APPLY_MS,
	TEMPLATE_FOG_BLOCK,
	TEMPLATE_FOG_LIGHT,
	TEMPLATE_FOG_SUM,
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
	TEMPLATE_MOTION,
	TEMPLATE_MOTION_VIEW,
	TEMPLATE_OCCLUSION_EARLY,
	TEMPLATE_OCCLUSION_LATE,
	TEMPLATE_OUTLINE_MASK,
	TEMPLATE_PARTICLE,
	TEMPLATE_PARTICLE_DEPTH,
	TEMPLATE_PARTICLE_DEPTH_MS,
	TEMPLATE_PARTICLE_MAP,
	TEMPLATE_PICK,
	TEMPLATE_PICK_MAPS,
	TEMPLATE_PICK_RESOLVE,
	TEMPLATE_PICK_TEXTURE_MAPS,
	TEMPLATE_PROBE_GRID,
	TEMPLATE_PROBE_GRID_MAPS,
	TEMPLATE_SHADOW_CUTOUT,
	TEMPLATE_SHADOW_CUTOUT_MAP,
	TEMPLATE_SHADOW_DEPTH,
	TEMPLATE_SKIN,
	TEMPLATE_SKY_TABLE,
	TEMPLATE_SPRITE,
	TEMPLATE_SPRITE_MAP,
	TEMPLATE_SSR_REDUCE,
	TEMPLATE_SSR_TRACE,
	TEMPLATE_SUBSURFACE,
	TEMPLATE_SUBSURFACE_BLUR,
	TEMPLATE_SUBSURFACE_COMPOSITE,
	TEMPLATE_SUBSURFACE_COMPOSITE_MS,
	TEMPLATE_SUBSURFACE_MAPS,
	TEMPLATE_TAA_COPY,
	TEMPLATE_TAA_RESOLVE,
	TEMPLATE_TAA_RESOLVE_MS,
	TEMPLATE_TONE_MASK,
	TEMPLATE_TRANSMISSION_COPY,
	TEMPLATE_VIEW_COPY,
	TEMPLATE_WEIGHTED_COMPOSITE,
	TEMPLATE_WEIGHTED_DEPTH,
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
	MOTION_VIEW_SHADER,
	type ShaderVariants,
	type WgslShader,
} from '../../generated/shaders';
import type { CustomShader } from '../../shared/images';
import { LINE_VERTICES } from '../line-vertices';
import { PARTICLE_RECORDS } from '../particle-records';
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
	 * For a custom effect's template or a decal template: the layouts of its builds that read a
	 * multisampled depth, the pipelines whose permutation has the DEPTH_MULTISAMPLED bit.
	 */
	readonly multisampledLayouts?: readonly number[];
	/**
	 * For a template that draws meshes: the vertex shader locations that it reads from a mesh's
	 * vertices, in slot 0, where each pipeline's vertex format places them.
	 */
	readonly meshLocations?: readonly number[];
	/** For a template that tests masks: the mesh locations that only its ALPHA_MASK builds read. */
	readonly maskLocations?: readonly number[];
	/**
	 * True for the motion template, which reads each vertex's place in the last frame from vertex
	 * buffer slot 2 at location 4: the last frame's copy of a skinned region, or the mesh's own
	 * vertices.
	 */
	readonly lastVertices?: boolean;
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

/**
 * The shader of an add-on's compute pass: a whole WGSL module with a `@compute` entry point, whose
 * pipelines run it once for each workgroup of a dispatch.
 */
export interface ComputeTemplate {
	/** The shader's builds, which hold the module for WebGPU. */
	readonly shader: ShaderVariants;
}

/**
 * The bit of a compute pass's format code that says the pass samples textures at group 1. The core
 * sets it when the pass has textures, and clears it otherwise, since a pipeline layout with a
 * group that nothing binds fails its dispatch.
 */
export const COMPUTE_MAPS_BIT = 1 << 8;

/**
 * The bit of a compute pass's format code that says the pass keeps two states: each run writes one
 * state as its storage texture and reads the other, so its group 0 also binds the other state as a
 * sampled texture.
 */
export const COMPUTE_HISTORY_BIT = 1 << 9;

/**
 * The bind group layout of an add-on compute pass's group 0 for the target's format code: its
 * block of uniforms, then the storage texture that it fills. A format code of 0 names a pass that
 * fills an instance draw's two buffers instead, with no texture. The maps bit says the pass also
 * samples textures at group 1. The history bit names the layout that also binds the previous
 * state.
 */
export function layoutOfComputeFormat(code: number): number {
	const format = code & ~(COMPUTE_MAPS_BIT | COMPUTE_HISTORY_BIT);
	const history = (code & COMPUTE_HISTORY_BIT) !== 0;
	if (format === 0) return LAYOUT_COMPUTE_INSTANCE_BUFFERS;
	if (history) {
		if (format === FORMAT_R32_FLOAT) return LAYOUT_COMPUTE_HISTORY_R32_FLOAT;
		if (format === FORMAT_RGBA8_UNORM) return LAYOUT_COMPUTE_HISTORY_RGBA8_UNORM;
		return LAYOUT_COMPUTE_HISTORY_RGBA16_FLOAT;
	}
	if (format === FORMAT_R32_FLOAT) return LAYOUT_COMPUTE_R32_FLOAT;
	if (format === FORMAT_RGBA8_UNORM) return LAYOUT_COMPUTE_RGBA8_UNORM;
	return LAYOUT_COMPUTE_RGBA16_FLOAT;
}

/**
 * The name of the `@compute` entry point of a whole WGSL module: the function that the attribute
 * precedes, or `main` for a module without one.
 */
export function computeEntryPoint(source: string): string {
	const at = source.search(/@\s*compute\b/u);
	if (at < 0) return 'main';
	const name = /fn\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(source.slice(at))?.[1];
	return name ?? 'main';
}

/**
 * The binding of the row values texture of instance batches in the frame group and in the depth
 * template's group, as the frame builder binds it and the mesh shaders declare it.
 */
const ROW_VALUES_BINDING = 16;

/**
 * The binding of the table of object ranges in the frame group and in the depth template's group,
 * which the vertex shaders of custom materials that read an instance's index or an object's id
 * search.
 */
const OBJECT_RANGES_BINDING = 17;

/**
 * The binding of the view's list of reflection probes in the frame group, which the lit shading
 * reads beside the probes' texture array at binding 3 (decision record D-149).
 */
const PROBE_LIST_BINDING = 18;

/** The fragment shader of a prepass that draws with a template's own vertex shader. */
const EMPTY_FRAGMENT = '@fragment\nfn fs() -> @location(0) vec4f {\n    return vec4f(0.0);\n}\n';

/** The map slots of a standard material, one texture array and sampler each. */
const MAP_SLOTS = Array.from({ length: SIZE_MAP_SLOTS }, (_, slot) => slot);

/**
 * The binding of the displacement map's texture array in the maps group, after every slot's array
 * and sampler, as the frame builder binds it. Its sampler takes the next binding.
 */
const HEIGHT_BINDING = 2 * SIZE_MAP_SLOTS;

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

/** The automatic exposure's compute templates: each one's entry point in the histogram shader. */
const EXPOSURE_ENTRY_POINTS: Readonly<Record<number, string>> = {
	[TEMPLATE_EXPOSURE_HISTOGRAM]: 'histogram_main',
	[TEMPLATE_EXPOSURE_ADAPT_HISTOGRAM]: 'adapt_main',
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
 * The motion view's compacted instance: the matrix rows and the ids, then the rows of the last
 * frame's matrix at locations 13 to 15.
 */
const MOTION_INSTANCE_BUFFERS: GPUVertexBufferLayout[] = [
	{
		arrayStride: SIZE_MOTION_INSTANCE_STRIDE,
		stepMode: 'instance',
		attributes: [
			...(INSTANCE_BUFFERS[0] as GPUVertexBufferLayout).attributes,
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 4, offset: 64, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 5, offset: 80, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 6, offset: 96, format: 'float32x4' },
		],
	},
];

/** The location of the last frame's place of each vertex in the motion template. */
const LAST_POSITION_LOCATION = 4;

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
 * The color targets of a pipeline of `template` that draws into `colorFormat`. The weighted
 * layer's pipelines draw into a second target too, its coverage sum in one 16-bit float: the
 * builds of the weighted bit, and the depth copy that draws first in the layer's pass, which
 * writes no color. Both targets blend the same way, as compatibility mode requires.
 */
function colorTargets(
	colorFormat: GPUTextureFormat,
	template: number,
	permutation: number,
	stateFlags: number,
): GPUColorTargetState[] {
	const blend = BLENDS[stateFlags & STATE_BLEND];
	const writeMask = stateFlags & STATE_NO_COLOR_WRITE ? 0 : ALL_CHANNELS;
	const first: GPUColorTargetState = { format: colorFormat, blend, writeMask };
	const two = (permutation & PERMUTATION_WEIGHTED) !== 0 || template === TEMPLATE_WEIGHTED_DEPTH;
	return two ? [first, { format: 'r16float', blend, writeMask }] : [first];
}

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
	if (!t.meshLocations) return undefined;
	const masked = t.maskLocations && permutation & PERMUTATION_ALPHA_MASK ? t.maskLocations : [];
	return variantLocations([...t.meshLocations, ...masked], permutation);
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
	const instances =
		permutation & PERMUTATION_INSTANCE_INDEX
			? INDEX_BUFFERS
			: permutation & PERMUTATION_MOTION
				? MOTION_INSTANCE_BUFFERS
				: t.vertexBuffers;
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
	if (!t.lastVertices) return [mesh, ...instances];
	const position = attributes.find((attribute) => attribute.shaderLocation === 0);
	if (!position) throw new Error(`vertex format ${vertexFormat} has no position`);
	const last: GPUVertexBufferLayout = {
		arrayStride: mesh.arrayStride,
		stepMode: 'vertex',
		attributes: [{ ...position, shaderLocation: LAST_POSITION_LOCATION }],
	};
	return [mesh, ...instances, last];
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
	/** The add-on compute passes' shaders, by their compute pipeline template. */
	private readonly computeTemplates = new Map<number, ComputeTemplate>();
	/** Each compute pass's pipeline layout, by the layout of its group 0. */
	private readonly computeLayouts = new Map<number, GPUPipelineLayout>();
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
	/** The motion view's culling build, which arrives with the motion feature's shader file. */
	private readonly cullMotion: ShaderVariants;
	private readonly pyramid: ShaderVariants;
	private readonly pyramidLayout: GPUPipelineLayout;
	/**
	 * The conversion of a feature-instance draw's world rows to camera-relative rows, which the
	 * engine dispatches once for each draw in a frame that holds one (D-229).
	 */
	private readonly featureRows: ShaderVariants;
	/** The conversion's pipeline layout, made at its first pipeline. */
	private featureRowsLayout: GPUPipelineLayout | undefined;
	/**
	 * The cluster pass's builds, which arrive with the cluster levels feature's shader file. It is
	 * read by name so that a build whose generated modules are older than the manifest still type
	 * checks, and the pipeline reports the shader as missing instead.
	 */
	private readonly cluster: ShaderVariants | undefined;
	private readonly clusterLayout: GPUPipelineLayout;
	private readonly lightLayout: GPUPipelineLayout;
	private readonly lightClusters: WgslShader | undefined;
	private readonly skinLayout: GPUPipelineLayout;
	/** The skinning pass's builds, which arrive with the skinning feature's shader file. */
	private readonly skin: ShaderVariants;
	/** The automatic exposure's histogram steps, which arrive with the exposure feature's file. */
	private readonly exposureHistogram: ShaderVariants;
	/** The histogram steps' pipeline layout, made at their first pipeline. */
	private exposureLayout: GPUPipelineLayout | undefined;
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
		// The frame's constants and the material table, which depth-only pipelines read too, then
		// the materials' custom values, the row values of instance batches and the table of object
		// ranges, which the vertex shaders of custom materials' shadow casters read too.
		const frameEntries: GPUBindGroupLayoutEntry[] = [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | fragment,
				buffer: { type: 'uniform' },
			},
			{ binding: 1, visibility: fragment, buffer: { type: 'read-only-storage' } },
		];
		const rowValues: GPUBindGroupLayoutEntry = {
			binding: ROW_VALUES_BINDING,
			visibility: GPUShaderStage.VERTEX,
			texture: { sampleType: 'unfilterable-float' },
		};
		const objectRanges: GPUBindGroupLayoutEntry = {
			binding: OBJECT_RANGES_BINDING,
			visibility: GPUShaderStage.VERTEX,
			buffer: { type: 'uniform' },
		};
		this.defineLayout(LAYOUT_DEPTH, 'depth', [
			...frameEntries,
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX,
				texture: { sampleType: 'unfilterable-float' },
			},
			rowValues,
			objectRanges,
		]);
		// The materials' custom values, with the table of specular terms in the columns after the
		// first rows, the light tables and the reflection probes' maps in the layers of one array,
		// then the shadow map, whose depths the receivers read as floats, the sampler that compares
		// depths in the shadow atlas, the cascades, the camera's light grid and light list, the
		// shadow atlas of point and spot lights with its tiles, the light probe grids' 3D texture,
		// ambient occlusion's texture, which the lit shading reads with textureLoad, the
		// environment's cube map with its filtering sampler, the sampler that reads four texels of
		// the shadow map at once, the copy of the opaque color that surfaces which let light through
		// sample with the environment's sampler, the row values of instance batches and the table
		// of object ranges, which only vertex shaders read, and the view's list of reflection
		// probes.
		const probeGrid: GPUBindGroupLayoutEntry = {
			binding: 10,
			visibility: fragment,
			texture: { viewDimension: '3d' },
		};
		const transmission: GPUBindGroupLayoutEntry = {
			binding: 15,
			visibility: fragment,
			texture: { viewDimension: '2d-array' },
		};
		const frame: GPUBindGroupLayoutEntry[] = [
			...frameEntries,
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX | fragment,
				texture: { sampleType: 'unfilterable-float' },
			},
			{ binding: 3, visibility: fragment, texture: { viewDimension: '2d-array' } },
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
			probeGrid,
			{ binding: 11, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 12, visibility: fragment, texture: { viewDimension: 'cube' } },
			{ binding: 13, visibility: fragment, sampler: {} },
			{ binding: 14, visibility: fragment, sampler: { type: 'non-filtering' } },
			transmission,
			rowValues,
			objectRanges,
			{ binding: PROBE_LIST_BINDING, visibility: fragment, buffer: { type: 'uniform' } },
		];
		this.defineLayout(LAYOUT_FRAME, 'frame', frame);
		// The frame group of the builds of parallax occlusion mapping leaves out the copy of the
		// opaque color, which no such build reads: the draw list never pairs parallax with
		// transmission. Their maps' group holds one sampled texture more than any other material's,
		// so this keeps their fragment stage within the default count.
		this.defineLayout(
			LAYOUT_FRAME_PARALLAX,
			'frame with parallax',
			frame.filter((entry) => entry !== transmission),
			true,
		);
		// The decals' frame group leaves out the probe grid, which no decal build reads, so that a
		// decal with maps stays within the default count of sampled textures in the fragment stage.
		// It carries the copy of the opaque color, which the reflections' lit code reads in every
		// lit build, decals included. It is made at the first decal.
		this.defineLayout(
			LAYOUT_DECAL_FRAME,
			'decal frame',
			frame.filter((entry) => entry !== probeGrid),
			true,
		);
		// The motion pass's frame group: the depth group's entries, then the motion block and the last
		// frame's joints, which vertex shaders read, and the table of object ranges for custom
		// materials that read object ids.
		this.defineLayout(LAYOUT_MOTION_FRAME, 'motion frame', [
			...frameEntries,
			{
				binding: 2,
				visibility: GPUShaderStage.VERTEX,
				texture: { sampleType: 'unfilterable-float' },
			},
			{ binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
			{
				binding: 5,
				visibility: GPUShaderStage.VERTEX,
				texture: { sampleType: 'unfilterable-float' },
			},
			rowValues,
			objectRanges,
		]);
		this.defineLayout(LAYOUT_TEXTURES, 'textures', [
			{ binding: 0, visibility: fragment, texture: { viewDimension: '2d-array' } },
			{ binding: 1, visibility: fragment, sampler: {} },
		]);
		// A texture array for each map slot, then each slot's sampler, then the displacement map's
		// array and sampler. Custom materials' vertex stages sample their textures too, and an
		// add-on's compute pass samples them in its own stage. The displacement map is the vertex
		// stage's alone, so the fragment stage keeps a sampled texture free, apart from the layout
		// of parallax, whose fragment stage reads it too.
		const maps = GPUShaderStage.VERTEX | fragment | GPUShaderStage.COMPUTE;
		const mapEntries = (height: GPUShaderStageFlags): GPUBindGroupLayoutEntry[] => [
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
			{ binding: HEIGHT_BINDING, visibility: height, texture: { viewDimension: '2d-array' } },
			{ binding: HEIGHT_BINDING + 1, visibility: height, sampler: {} },
		];
		this.defineLayout(LAYOUT_MATERIAL_MAPS, 'material maps', mapEntries(GPUShaderStage.VERTEX));
		this.defineLayout(
			LAYOUT_MATERIAL_MAPS_PARALLAX,
			'material maps with parallax',
			mapEntries(maps),
		);
		// A custom material that reads the copy of the scene's depth takes the maps' group with the
		// last slot and the displacement map left out, which no custom material reads. Its fragment
		// stage then holds the frame group's eight sampled textures, this group's seven and the
		// copy, within the sixteen that every device allows.
		const sceneMaps = MAP_SLOTS.slice(0, MAP_SLOTS.length - 1);
		this.defineLayout(LAYOUT_MATERIAL_MAPS_SCENE, 'material maps with scene depth', [
			...sceneMaps.map(
				(binding): GPUBindGroupLayoutEntry => ({
					binding,
					visibility: maps,
					texture: { viewDimension: '2d-array' },
				}),
			),
			...sceneMaps.map(
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
		// occluders, the cell offsets, the first joint of each skinned source, and the distances
		// between which each source draws. Their history shares the buffer of the indirect draws, as
		// eight storage buffers is all that every device allows a shader stage.
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
			{ binding: 10, visibility: compute, texture: { sampleType: 'uint' } },
			{ binding: 11, visibility: compute, texture: { sampleType: 'unfilterable-float' } },
		]);
		// The cluster levels' pass: one dispatch's parameters at a dynamic offset, the scene's
		// patches and indices, the view's compacted instances and indirect draws, then the view's
		// runs, offsets, index list and draws.
		this.defineLayout(LAYOUT_CLUSTER_CULL, 'cluster cull', [
			{ binding: 0, visibility: compute, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 3, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 4, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 5, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 6, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 7, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 8, visibility: compute, buffer: { type: 'storage' } },
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
		// Group 0 of an add-on's compute pass: its block of uniforms, then the storage texture that
		// it fills. The storage texture's format is part of the layout, so a pass of another
		// format takes the layout of that format. Shaders read the target as an array of one
		// layer, as they sample every pass's target.
		const computeEntries = (format: GPUTextureFormat): GPUBindGroupLayoutEntry[] => [
			{ binding: 0, visibility: compute, buffer: { type: 'uniform' } },
			{
				binding: 1,
				visibility: compute,
				storageTexture: { access: 'write-only', format, viewDimension: '2d-array' },
			},
		];
		this.defineLayout(
			LAYOUT_COMPUTE_RGBA16_FLOAT,
			'compute rgba16float',
			computeEntries('rgba16float'),
			true,
		);
		this.defineLayout(
			LAYOUT_COMPUTE_R32_FLOAT,
			'compute r32float',
			computeEntries('r32float'),
			true,
		);
		this.defineLayout(
			LAYOUT_COMPUTE_RGBA8_UNORM,
			'compute rgba8unorm',
			computeEntries('rgba8unorm'),
			true,
		);
		// Group 0 of a compute pass that keeps two states: its block of uniforms, the state that
		// this run writes as a storage texture, and the state of the run before, which the shader
		// reads. Each run binds a view of one state's layers, so no subresource is both written
		// and read in one dispatch.
		const historyEntries = (
			format: GPUTextureFormat,
			sampleType: GPUTextureSampleType,
		): GPUBindGroupLayoutEntry[] => [
			...computeEntries(format),
			{ binding: 2, visibility: compute, texture: { sampleType, viewDimension: '2d-array' } },
		];
		this.defineLayout(
			LAYOUT_COMPUTE_HISTORY_RGBA16_FLOAT,
			'compute history rgba16float',
			historyEntries('rgba16float', 'float'),
			true,
		);
		this.defineLayout(
			LAYOUT_COMPUTE_HISTORY_R32_FLOAT,
			'compute history r32float',
			historyEntries('r32float', 'unfilterable-float'),
			true,
		);
		this.defineLayout(
			LAYOUT_COMPUTE_HISTORY_RGBA8_UNORM,
			'compute history rgba8unorm',
			historyEntries('rgba8unorm', 'float'),
			true,
		);
		// Group 0 of an add-on's compute pass that fills an instance draw: its block of uniforms,
		// the draw's count word and its per-instance rows, both read and written as storage.
		this.defineLayout(
			LAYOUT_COMPUTE_INSTANCE_BUFFERS,
			'compute instance buffers',
			[
				{ binding: 0, visibility: compute, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: compute, buffer: { type: 'storage' } },
				{ binding: 2, visibility: compute, buffer: { type: 'storage' } },
			],
			true,
		);
		// Group 0 of the conversion of a feature-instance draw's world rows: its block of
		// uniforms, which holds the camera's world position, the draw's count word and world rows,
		// which it reads, and the camera-relative rows that it writes.
		this.defineLayout(
			LAYOUT_FEATURE_ROWS,
			'feature rows',
			[
				{ binding: 0, visibility: compute, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: compute, buffer: { type: 'read-only-storage' } },
				{ binding: 2, visibility: compute, buffer: { type: 'read-only-storage' } },
				{ binding: 3, visibility: compute, buffer: { type: 'storage' } },
			],
			true,
		);
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
			// The automatic exposure's texel, in 32-bit floats, which no device need filter.
			{ binding: 12, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
			// The built-in grading table, a 3D texture that a job worker baked.
			{ binding: 13, visibility: fragment, texture: { viewDimension: '3d' } },
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
		this.defineLayout(LAYOUT_AO, 'ao', [aoSettings, unfiltered(1), unfiltered(2), unfiltered(3)]);
		// Screen-space reflections' steps read every texture with textureLoad too: a level of the
		// depth pyramid reads the level below it, and the trace ambient occlusion's depth copy and
		// the pyramid's six levels above it.
		this.defineLayout(LAYOUT_SSR_REDUCE, 'ssr reduce', [aoSettings, unfiltered(1)]);
		this.defineLayout(LAYOUT_SSR_TRACE, 'ssr trace', [
			aoSettings,
			...[1, 2, 3, 4, 5, 6, 7].map((binding) => unfiltered(binding)),
		]);
		// The background's values, which the sky's vertex stage reads too, a cube map and its
		// filtering sampler.
		this.defineLayout(LAYOUT_BACKGROUND, 'background', [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | fragment, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: fragment, texture: { viewDimension: 'cube' } },
			{ binding: 2, visibility: fragment, sampler: {} },
		]);
		// A sky layer's values: its uniform block alone, which its template's fragment stage
		// reads.
		this.defineLayout(LAYOUT_BACKGROUND_LAYER, 'background layer', [
			{ binding: 0, visibility: fragment, buffer: { type: 'uniform' } },
		]);
		// The physical sky's group: its values, its three tables, which it reads with a linear
		// filter, a sampler that clamps and one that repeats across the width.
		this.defineLayout(LAYOUT_ATMOSPHERE, 'atmosphere', [
			{ binding: 0, visibility: fragment, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: fragment, texture: {} },
			{ binding: 2, visibility: fragment, texture: {} },
			{ binding: 3, visibility: fragment, texture: {} },
			{ binding: 4, visibility: fragment, sampler: {} },
			{ binding: 5, visibility: fragment, sampler: {} },
		]);
		// The copy of a view's image into its target reads the image with textureLoad.
		this.defineLayout(LAYOUT_VIEW_COPY, 'view copy', [unfiltered(0)]);
		// The still-camera accumulation's blend: its values, and the color it reads with textureLoad.
		this.defineLayout(LAYOUT_ACCUMULATE, 'accumulate', [
			{ binding: 0, visibility: fragment, buffer: { type: 'uniform' } },
			unfiltered(1),
		]);
		// The weighted layer's composite reads its two sums, and its depth copy a multisampled scene
		// depth, with textureLoad. The copy of the opaque color for transmission reads the scene
		// color and depth as the composite reads its sums, or with a multisampled depth.
		this.defineLayout(LAYOUT_WEIGHTED_COMPOSITE, 'weighted composite', [
			unfiltered(0),
			unfiltered(1),
		]);
		this.defineLayout(LAYOUT_WEIGHTED_DEPTH_MS, 'weighted depth ms', [unfiltered(0, true)]);
		this.defineLayout(LAYOUT_TRANSMISSION_COPY_MS, 'transmission copy ms', [
			unfiltered(0),
			unfiltered(1, true),
		]);
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
		// An effect that reads a level of bloom's chain binds the level after its depth, which it
		// samples with its linear sampler.
		const bloomLevel: GPUBindGroupLayoutEntry = {
			binding: 4,
			visibility: fragment,
			texture: {},
		};
		this.defineLayout(LAYOUT_EFFECT_BLOOM, 'effect bloom', [
			...effectEntries,
			unfiltered(3),
			bloomLevel,
		]);
		this.defineLayout(LAYOUT_EFFECT_BLOOM_DEPTH_MS, 'effect bloom depth ms', [
			...effectEntries,
			unfiltered(3, true),
			bloomLevel,
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
		// Temporal anti-aliasing's resolve: its block, the scene's color, depth and motion, each
		// read with textureLoad, the two histories, which it samples with the linear sampler, and
		// the sampler at binding 6. The multisampled build reads the scene depth's samples.
		const taa = (depthMultisampled: boolean): GPUBindGroupLayoutEntry[] => [
			aoSettings,
			unfiltered(1),
			unfiltered(2, depthMultisampled),
			unfiltered(3),
			{ binding: 4, visibility: fragment, texture: {} },
			{ binding: 5, visibility: fragment, texture: {} },
			{ binding: 6, visibility: fragment, sampler: {} },
		];
		this.defineLayout(LAYOUT_TAA, 'taa', taa(false));
		this.defineLayout(LAYOUT_TAA_MS, 'taa ms', taa(true));
		// The subsurface blur's steps read every texture with textureLoad: the across step the skin
		// pass's light, and the down step that, the across step's light, the scene color and the
		// scene's depth as plain floats.
		this.defineLayout(LAYOUT_SUBSURFACE_BLUR, 'subsurface blur', [aoSettings, unfiltered(1)]);
		const composite = [aoSettings, unfiltered(1), unfiltered(2), unfiltered(3)];
		this.defineLayout(LAYOUT_SUBSURFACE_COMPOSITE, 'subsurface composite', [
			...composite,
			unfiltered(4),
		]);
		this.defineLayout(LAYOUT_SUBSURFACE_COMPOSITE_MS, 'subsurface composite ms', [
			...composite,
			unfiltered(4, true),
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
		// A particle system's values, then the block of the view that draws, at a dynamic offset;
		// then the view's copy of its opaque depth, which soft particles read with textureLoad.
		const vertexAndFragment = GPUShaderStage.VERTEX | fragment;
		this.defineLayout(LAYOUT_PARTICLE, 'particle', [
			{ binding: 0, visibility: vertexAndFragment, buffer: { type: 'uniform' } },
			{
				binding: 1,
				visibility: vertexAndFragment,
				buffer: { type: 'uniform', hasDynamicOffset: true },
			},
		]);
		this.defineLayout(LAYOUT_PARTICLE_SCENE_DEPTH, 'particle scene depth', [unfiltered(0)]);
		// The copy of the opaque depth for soft particles reads a multisampled depth's first sample;
		// the one-sample copy binds as a view's copy does.
		this.defineLayout(LAYOUT_PARTICLE_DEPTH_MS, 'particle depth ms', [unfiltered(0, true)]);
		for (const [id, label, shader, layout] of [
			[TEMPLATE_PARTICLE_DEPTH, 'particle depth', shaders.particle_depth, LAYOUT_VIEW_COPY],
			[
				TEMPLATE_PARTICLE_DEPTH_MS,
				'particle depth ms',
				shaders.particle_depth_ms,
				LAYOUT_PARTICLE_DEPTH_MS,
			],
		] as const)
			this.defineTemplate(id, {
				label,
				shader,
				pipeline: 'main',
				layouts: [layout],
				vertexBuffers: [],
			});
		for (const [id, label, shader, map] of [
			[TEMPLATE_PARTICLE, 'particles', shaders.particle, false],
			[TEMPLATE_PARTICLE_MAP, 'particles map', shaders.particle_map, true],
		] as const) {
			const layouts = [LAYOUT_FRAME, LAYOUT_PARTICLE, LAYOUT_PARTICLE_SCENE_DEPTH];
			this.defineTemplate(id, {
				label,
				shader,
				pipeline: 'main',
				layouts: map ? [...layouts, LAYOUT_TEXTURES] : layouts,
				vertexBuffers: [PARTICLE_RECORDS],
			});
		}
		for (const [id, label, shader, meshLocations, layouts] of [
			[TEMPLATE_INSTANCED_LIT, 'lit', shaders.lit, [0, 1], [LAYOUT_FRAME]],
			[TEMPLATE_PROBE_GRID, 'probe grid', shaders.probe_grid, [0, 1], [LAYOUT_FRAME]],
			[
				TEMPLATE_PROBE_GRID_MAPS,
				'probe grid maps',
				shaders.probe_grid_maps,
				[0, 1, 2, 3],
				[LAYOUT_FRAME, LAYOUT_MATERIAL_MAPS],
			],
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
			[TEMPLATE_TONE_MASK, 'tone mask', shaders.tone_mask, [0, 1], [LAYOUT_DEPTH]],
			[TEMPLATE_SUBSURFACE, 'subsurface', shaders.subsurface, [0, 1], [LAYOUT_FRAME]],
			[
				TEMPLATE_SUBSURFACE_MAPS,
				'subsurface maps',
				shaders.subsurface_maps,
				[0, 1, 2, 3],
				[LAYOUT_FRAME, LAYOUT_MATERIAL_MAPS],
			],
			[TEMPLATE_PICK, 'pick', shaders.pick, [0], [LAYOUT_FRAME]],
			[
				TEMPLATE_PICK_MAPS,
				'pick maps',
				shaders.pick_maps,
				[0, 2, 3],
				[LAYOUT_FRAME, LAYOUT_MATERIAL_MAPS],
			],
			[
				TEMPLATE_PICK_TEXTURE_MAPS,
				'pick texture maps',
				shaders.pick_texture_maps,
				[0, 2, 3],
				[LAYOUT_FRAME, LAYOUT_TEXTURES],
			],
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
		// Decals: their frame group, the maps' where the build samples them, then the scene's depth,
		// which the builds that read a multisampled depth bind through a layout of their own. They
		// read the position of the box's corners alone.
		this.defineLayout(LAYOUT_DECAL_DEPTH, 'decal depth', [unfiltered(0)]);
		this.defineLayout(LAYOUT_DECAL_DEPTH_MS, 'decal depth ms', [unfiltered(0, true)]);
		// A custom material that reads the scene's depth binds the copy of the camera's opaque
		// depth after the maps' group, or after the frame's when it has no textures. The copy is
		// one sample whatever the scene's antialiasing, so it needs no multisampled layout.
		this.defineLayout(LAYOUT_MATERIAL_SCENE, 'material scene depth', [unfiltered(0)]);
		for (const [id, label, shader, maps] of [
			[TEMPLATE_DECAL, 'decal', shaders.decal, []],
			[TEMPLATE_DECAL_MAPS, 'decal maps', shaders.decal_maps, [LAYOUT_MATERIAL_MAPS]],
		] as const) {
			this.defineTemplate(id, {
				label: `mesh ${label}`,
				shader,
				pipeline: 'main',
				layouts: [LAYOUT_DECAL_FRAME, ...maps, LAYOUT_DECAL_DEPTH],
				multisampledLayouts: [LAYOUT_DECAL_FRAME, ...maps, LAYOUT_DECAL_DEPTH_MS],
				meshLocations: [0],
				vertexBuffers: INSTANCE_BUFFERS,
			});
		}
		// GPU picking's resolve: one triangle over the render size that copies the id target that
		// the device resolved, at group 0 of a view copy's layout.
		this.defineTemplate(TEMPLATE_PICK_RESOLVE, {
			label: 'pick resolve',
			shader: shaders.pick_resolve,
			pipeline: 'main',
			layouts: [LAYOUT_VIEW_COPY],
			vertexBuffers: [],
		});
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
			[TEMPLATE_SSR_REDUCE, 'ssr reduce', shaders.ssr_reduce, 'reduce', LAYOUT_SSR_REDUCE],
			[TEMPLATE_SSR_TRACE, 'ssr trace', shaders.ssr, 'trace', LAYOUT_SSR_TRACE],
			[
				TEMPLATE_EXPOSURE_LUMINANCE,
				'exposure cells',
				shaders.exposure,
				'downsample',
				LAYOUT_EFFECT,
			],
			[TEMPLATE_EXPOSURE_ADAPT, 'exposure adapt', shaders.exposure, 'adapt', LAYOUT_EFFECT],
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
			[
				TEMPLATE_SUBSURFACE_BLUR,
				'subsurface across',
				shaders.subsurface_blur,
				'across',
				LAYOUT_SUBSURFACE_BLUR,
			],
			[
				TEMPLATE_SUBSURFACE_COMPOSITE,
				'subsurface down',
				shaders.subsurface_blur,
				'down',
				LAYOUT_SUBSURFACE_COMPOSITE,
			],
			[
				TEMPLATE_SUBSURFACE_COMPOSITE_MS,
				'subsurface down ms',
				shaders.subsurface_blur_ms,
				'down',
				LAYOUT_SUBSURFACE_COMPOSITE_MS,
			],
			// The volumetric fog's block step and sum bind as steps of bloom, and its apply step as
			// depth of field's composite, with the summed grid in place of the blurred image.
			[TEMPLATE_FOG_BLOCK, 'fog block', shaders.fog_volume, 'block', LAYOUT_BLOOM],
			[TEMPLATE_FOG_SUM, 'fog sum', shaders.fog_volume, 'sum', LAYOUT_BLOOM],
			[TEMPLATE_FOG_APPLY, 'fog apply', shaders.fog_volume, 'apply', LAYOUT_DOF_COMPOSITE],
			[
				TEMPLATE_FOG_APPLY_MS,
				'fog apply ms',
				shaders.fog_volume_ms,
				'apply',
				LAYOUT_DOF_COMPOSITE_MS,
			],
		] as const) {
			this.defineTemplate(id, { label, shader, pipeline, layouts: [layout], vertexBuffers: [] });
		}
		// The volumetric fog's light step reads the camera's frame group, as the background does,
		// then its own settings, the last frame's grid and a sampler, as a step of bloom does.
		this.defineTemplate(TEMPLATE_FOG_LIGHT, {
			label: 'fog light',
			shader: shaders.fog_light,
			pipeline: 'light',
			layouts: [LAYOUT_FRAME, LAYOUT_BLOOM],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_VIEW_COPY, {
			label: 'view copy',
			shader: shaders.view_copy,
			pipeline: 'main',
			layouts: [LAYOUT_VIEW_COPY],
			vertexBuffers: [],
		});
		// Temporal anti-aliasing's resolve binds the scene's color, depth and motion and both
		// histories; its copy binds as the copy of a view's image does.
		this.defineTemplate(TEMPLATE_TAA_RESOLVE, {
			label: 'taa resolve',
			shader: shaders.taa,
			pipeline: 'resolve',
			layouts: [LAYOUT_TAA],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_TAA_RESOLVE_MS, {
			label: 'taa resolve ms',
			shader: shaders.taa_ms,
			pipeline: 'resolve',
			layouts: [LAYOUT_TAA_MS],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_TAA_COPY, {
			label: 'taa copy',
			shader: shaders.taa_copy,
			pipeline: 'main',
			layouts: [LAYOUT_VIEW_COPY],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_ACCUMULATE, {
			label: 'accumulate',
			shader: shaders.accumulate,
			pipeline: 'main',
			layouts: [LAYOUT_ACCUMULATE],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_TRANSMISSION_COPY, {
			label: 'transmission copy',
			shader: shaders.transmission_copy,
			pipeline: 'main',
			layouts: [LAYOUT_WEIGHTED_COMPOSITE],
			multisampledLayouts: [LAYOUT_TRANSMISSION_COPY_MS],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_WEIGHTED_COMPOSITE, {
			label: 'weighted composite',
			shader: shaders.weighted_composite,
			pipeline: 'main',
			layouts: [LAYOUT_WEIGHTED_COMPOSITE],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_WEIGHTED_DEPTH, {
			label: 'weighted depth',
			shader: shaders.weighted_depth,
			pipeline: 'main',
			layouts: [LAYOUT_WEIGHTED_DEPTH_MS],
			vertexBuffers: [],
			depthFragment: true,
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
		// The motion of moving objects: the last frame's matrices after each instance's copy, and the
		// last frame's place of each vertex in slot 2. Masked builds read the texture coordinates and
		// the base color map, whose group, or a blank one's, every build binds.
		this.defineTemplate(TEMPLATE_MOTION, {
			label: 'mesh motion',
			shader: shaders.motion,
			pipeline: 'main',
			layouts: [LAYOUT_MOTION_FRAME, LAYOUT_TEXTURES],
			meshLocations: [0],
			maskLocations: [2, 3],
			vertexBuffers: MOTION_INSTANCE_BUFFERS,
			lastVertices: true,
		});
		this.defineTemplate(TEMPLATE_SKY_TABLE, {
			label: 'sky tables',
			shader: shaders.sky_tables,
			pipeline: 'main',
			layouts: [LAYOUT_ATMOSPHERE],
			vertexBuffers: [],
		});
		this.defineTemplate(TEMPLATE_BACKGROUND_ATMOSPHERE, {
			label: 'background atmosphere',
			shader: shaders.sky_physical,
			pipeline: 'main',
			layouts: [LAYOUT_FRAME, LAYOUT_ATMOSPHERE],
			vertexBuffers: [],
		});
		if (DEV) {
			this.defineTemplate(TEMPLATE_MOTION_VIEW, {
				label: 'motion view',
				shader: MOTION_VIEW_SHADER,
				pipeline: 'main',
				layouts: [LAYOUT_EFFECT],
				multisampledLayouts: [LAYOUT_EFFECT_DEPTH_MS],
				vertexBuffers: [],
			});
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
		this.cullMotion = shaders.cull_motion;
		this.pyramid = shaders.pyramid;
		this.pyramidLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_DEPTH_PYRAMID)],
		});
		this.featureRows = shaders.feature_rows;
		this.cluster = (shaders as unknown as Record<string, ShaderVariants | undefined>).cluster_cull;
		this.clusterLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_CLUSTER_CULL)],
		});
		this.lightLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout(LAYOUT_LIGHT_CLUSTERS)],
		});
		this.lightClusters = variantFor(shaders.light_clusters, 0, 'wgsl')?.wgsl ?? undefined;
		this.skinLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout(LAYOUT_SKIN)] });
		this.skin = shaders.skin;
		this.exposureHistogram = shaders.exposure_histogram;
		// The histogram steps' group: their settings, the color they meter with a linear filter,
		// the histogram and the stored exposure, and the exposure's texel that they write. It is
		// made at its first use.
		this.defineLayout(
			LAYOUT_EXPOSURE,
			'exposure',
			[
				{ binding: 0, visibility: compute, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: compute, texture: {} },
				{ binding: 2, visibility: compute, sampler: {} },
				{ binding: 3, visibility: compute, buffer: { type: 'storage' } },
				{ binding: 4, visibility: compute, buffer: { type: 'storage' } },
				{
					binding: 5,
					visibility: compute,
					storageTexture: { access: 'write-only', format: 'rgba32float' },
				},
			],
			true,
		);
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
	 * maps' layout. A custom effect's draws one triangle with the effect's layout, and its own
	 * textures in a second group of the maps' layout, and a group of joined effects draws as an
	 * effect without textures does. A custom tone curve's binds as the final pass or its bloom build does,
	 * and the final pass with effects folded into it binds their buffer and the depth too.
	 */
	defineCustom(id: number, shader: CustomShader): void {
		const { kind } = shader;
		if (kind === 'compute') {
			this.computeTemplates.set(id, { shader: shader.variants });
			return;
		}
		// A sky layer's build of the sky map's shader draws no pipeline of the scene: the map's
		// generator builds its pipelines, so the template needs nothing here.
		if (kind === 'skyLayerMap') return;
		// A sky layer draws the template's box around the camera, with the frame's group and its
		// own values in the background layer's group.
		if (kind === 'skyLayer') {
			this.defineTemplate(id, {
				label: `sky layer ${id}`,
				shader: shader.variants,
				pipeline: 'main',
				layouts: [LAYOUT_FRAME, LAYOUT_BACKGROUND_LAYER],
				vertexBuffers: [],
			});
			return;
		}
		if (kind !== undefined) {
			const effect = kind === 'effect' || kind === 'effectGroup';
			const [layout, multisampled, label] = effect
				? shader.bloom
					? [LAYOUT_EFFECT_BLOOM, LAYOUT_EFFECT_BLOOM_DEPTH_MS, `custom effect ${id}`]
					: [LAYOUT_EFFECT, LAYOUT_EFFECT_DEPTH_MS, `custom effect ${id}`]
				: kind === 'effectFold'
					? [LAYOUT_FINAL_EFFECTS, LAYOUT_FINAL_EFFECTS_DEPTH_MS, `folded effects ${id}`]
					: [
							kind === 'final' ? LAYOUT_FINAL : LAYOUT_FINAL_BLOOM,
							undefined,
							`custom tone curve ${id}`,
						];
			// An effect's own textures bind in a second group of the maps' layout.
			const maps = shader.textures > 0 ? [LAYOUT_MATERIAL_MAPS] : [];
			this.defineTemplate(id, {
				label,
				shader: shader.variants,
				pipeline: 'main',
				layouts: [layout, ...maps],
				multisampledLayouts: multisampled === undefined ? undefined : [multisampled, ...maps],
				vertexBuffers: [],
			});
			return;
		}
		// A material that reads the scene's depth binds the copy after its maps, or after the
		// frame's group when it has none. Its maps' group leaves a slot free for the copy.
		const scene = shader.sceneDepth === true ? [LAYOUT_MATERIAL_SCENE] : [];
		const maps = shader.sceneDepth === true ? LAYOUT_MATERIAL_MAPS_SCENE : LAYOUT_MATERIAL_MAPS;
		// A draw shader makes every vertex itself, so its pipelines read no vertex buffer and have
		// no prepass: its object has no mesh and no depth to write before the shading.
		this.defineTemplate(id, {
			label: `custom material ${id}`,
			shader: shader.variants,
			pipeline: 'main',
			layouts: [...(shader.textures > 0 ? [LAYOUT_FRAME, maps] : [LAYOUT_FRAME]), ...scene],
			...(shader.meshless === true
				? { vertexBuffers: [] }
				: {
						meshLocations: shader.locations,
						vertexBuffers: INSTANCE_BUFFERS,
						ownPrepass: true,
					}),
		});
	}

	/**
	 * Gives a custom material's template the shader of a hot update, and forgets the shader modules
	 * of its old shader. The pipelines that `render` describes from then on use the new shader.
	 */
	replaceCustom(id: number, shader: CustomShader): void {
		if (shader.kind === 'compute') {
			this.computeTemplates.set(id, { shader: shader.variants });
			return;
		}
		const old = this.templates[id];
		for (const variant of Object.values(old?.shader ?? {}))
			if (variant.wgsl) this.modules.delete(variant.wgsl);
		this.templates[id] = undefined;
		this.defineCustom(id, shader);
	}

	/** True when a template has this id. */
	has(id: number): boolean {
		return this.templates[id] !== undefined || this.computeTemplates.has(id);
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

	/**
	 * The pipeline layout of an add-on compute pass whose code names its target's format: group 0
	 * binds the pass's block and its storage texture, and when the pass samples textures, group 1
	 * binds them as an effect's own textures bind.
	 */
	private computePipelineLayout(code: number): GPUPipelineLayout {
		const layout = layoutOfComputeFormat(code);
		let made = this.computeLayouts.get(code);
		if (!made) {
			const groups = [this.layout(layout)];
			if ((code & COMPUTE_MAPS_BIT) !== 0) groups.push(this.layout(LAYOUT_MATERIAL_MAPS));
			made = this.device.createPipelineLayout({ bindGroupLayouts: groups });
			this.computeLayouts.set(code, made);
		}
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
		// A displaced material's prepass moves its vertices as its shading does.
		const places = t.ownPrepass === true || (permutation & PERMUTATION_DISPLACEMENT) !== 0;
		const ownPrepass = places && (permutation & PERMUTATION_PREPASS) !== 0;
		const build = ownPrepass ? (permutation & ~PERMUTATION_PREPASS) >>> 0 : permutation;
		const shader = variantFor(t.shader, build, 'wgsl')?.wgsl;
		if (!shader)
			throw new Error(`render template ${template} has no variant for permutation ${permutation}`);
		const module = this.module(t.label, shader);
		const entryPoints = shader.pipelines[t.pipeline];
		const skins = (permutation & PERMUTATION_SKIN) !== 0;
		const byIndex = (permutation & PERMUTATION_INSTANCE_INDEX) !== 0;
		const multisampled =
			t.multisampledLayouts !== undefined && (permutation & PERMUTATION_DEPTH_MULTISAMPLED) !== 0;
		// A custom material's shadow caster draws in the shadow passes, whose views bind the depth
		// template's group in place of the frame group, and its motion build in the motion pass,
		// whose view binds the motion frame group there.
		const caster = (permutation & PERMUTATION_CASTER) !== 0;
		const motion = template !== TEMPLATE_MOTION && (permutation & PERMUTATION_MOTION) !== 0;
		// Parallax reads the displacement map in the fragment stage too, through a layout of its own.
		const parallax = (permutation & PERMUTATION_PARALLAX) !== 0;
		// Six flags fill the low bits: five of them need 32 values, and parallax, the sixth, needs
		// the next 32, so a template starts every 64 keys and never shares one with its neighbour.
		const key =
			template * 64 +
			(skins ? 1 : 0) +
			(byIndex ? 2 : 0) +
			(multisampled ? 4 : 0) +
			(caster ? 8 : 0) +
			(motion ? 16 : 0) +
			(parallax ? 32 : 0);
		let layout = this.pipelineLayouts.get(key);
		if (!layout) {
			const listed = multisampled ? (t.multisampledLayouts as readonly number[]) : t.layouts;
			const own = parallax
				? listed.map((id) =>
						id === LAYOUT_MATERIAL_MAPS
							? LAYOUT_MATERIAL_MAPS_PARALLAX
							: id === LAYOUT_FRAME
								? LAYOUT_FRAME_PARALLAX
								: id,
					)
				: listed;
			const first = caster ? LAYOUT_DEPTH : motion ? LAYOUT_MOTION_FRAME : undefined;
			// A caster, motion or pick build shades no surface, so its shader binds no scene
			// depth. Its layout leaves that group out, and its draws bind no group there.
			const pick = (permutation & PERMUTATION_PICK) !== 0;
			const shaded =
				caster || motion || pick ? own.filter((id) => id !== LAYOUT_MATERIAL_SCENE) : own;
			const groups = [
				...(first === undefined ? shaded : [first, ...shaded.slice(1)]),
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
						targets: colorTargets(colorFormat, template, permutation, stateFlags),
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
	computeVariants(template: number, permutation = 0): ShaderVariants | undefined {
		const custom = this.computeTemplates.get(template);
		if (custom) return custom.shader;
		if (template === TEMPLATE_SKIN) return this.skin;
		if (template === TEMPLATE_DEPTH_PYRAMID) return this.pyramid;
		if (template === TEMPLATE_FEATURE_ROWS) return this.featureRows;
		if (template === TEMPLATE_CLUSTER) return this.cluster;
		if (template === TEMPLATE_CULL && permutation & PERMUTATION_MOTION) return this.cullMotion;
		if (EXPOSURE_ENTRY_POINTS[template] !== undefined) return this.exposureHistogram;
		return OCCLUSION_ENTRY_POINTS[template] !== undefined ? this.occlusion : undefined;
	}

	/**
	 * How to build a compute pipeline of a template: culling or a phase of occlusion culling, the
	 * depth pyramid, skinning, or a step of light clustering. The skinning pass takes the build of
	 * its permutation bits (see `SKIN_BUILDS`).
	 */
	compute(template: number, permutation: number): GPUComputePipelineDescriptor {
		const custom = this.computeTemplates.get(template);
		if (custom) {
			const shader = variantFor(custom.shader, 0, 'wgsl')?.wgsl;
			if (!shader) throw new Error(`the compute pass's shader has not arrived`);
			return {
				label: `compute pass ${template}`,
				layout: this.computePipelineLayout(permutation),
				compute: {
					module: this.module('compute pass', shader),
					entryPoint: computeEntryPoint(shader.source),
				},
			};
		}
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
		if (template === TEMPLATE_CULL && permutation & PERMUTATION_MOTION) {
			const shader = variantFor(this.cullMotion, permutation, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no motion culling shader");
			return {
				label: 'cull motion',
				layout: this.cullLayout,
				compute: { module: this.module('cull motion', shader), entryPoint: CULL_ENTRY_POINT },
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
		if (template === TEMPLATE_CLUSTER) {
			const shader = this.cluster ? variantFor(this.cluster, 0, 'wgsl')?.wgsl : undefined;
			if (!shader) throw new Error("the device's shader modules have no cluster shader");
			return {
				label: 'cluster cull',
				layout: this.clusterLayout,
				compute: { module: this.module('cluster cull', shader), entryPoint: 'main' },
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
		if (template === TEMPLATE_FEATURE_ROWS) {
			const shader = variantFor(this.featureRows, 0, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no feature rows shader");
			this.featureRowsLayout ??= this.device.createPipelineLayout({
				bindGroupLayouts: [this.layout(LAYOUT_FEATURE_ROWS)],
			});
			return {
				label: 'feature rows',
				layout: this.featureRowsLayout,
				compute: { module: this.module('feature rows', shader), entryPoint: 'main' },
			};
		}
		const exposureEntry = EXPOSURE_ENTRY_POINTS[template];
		if (exposureEntry) {
			const shader = variantFor(this.exposureHistogram, 0, 'wgsl')?.wgsl;
			if (!shader) throw new Error("the device's shader modules have no exposure histogram shader");
			this.exposureLayout ??= this.device.createPipelineLayout({
				bindGroupLayouts: [this.layout(LAYOUT_EXPOSURE)],
			});
			return {
				label: `exposure ${exposureEntry}`,
				layout: this.exposureLayout,
				compute: { module: this.module('exposure histogram', shader), entryPoint: exposureEntry },
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
