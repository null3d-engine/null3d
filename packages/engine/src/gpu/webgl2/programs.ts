// Programs of the WebGL2 backend. Each render pipeline draws with a GLSL program that the shader
// build translated from WGSL. A program compiles when the first pipeline of its template and
// permutation is created, and pipelines for other vertex formats share it, because WebGL2 keeps a
// mesh's vertex layout in its vertex array, not in the program. Its link result is read only when
// it is first drawn with, so the driver can compile a frame's programs in parallel. Only
// development builds define the templates of the debug lines and the debug views, so release
// builds hold none of them.
//
// A mesh template draws the depth prepass with the vertex shader of the build that shades, and a
// fragment shader that writes nothing. The prepass then computes each position with the shader
// that the opaque pass computes it with, so its test for equal depth passes on the nearest
// surface. A separate depth-only program gave other depths in Chrome on a Mac, although both
// programs mark the position invariant.

import {
	PERMUTATION_PREPASS,
	TEMPLATE_AO,
	TEMPLATE_AO_DENOISE,
	TEMPLATE_AO_DEPTH,
	TEMPLATE_BACKGROUND,
	TEMPLATE_BACKGROUND_CUBE,
	TEMPLATE_BACKGROUND_SKY,
	TEMPLATE_BLOOM,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_DEBUG_VIEW,
	TEMPLATE_FINAL,
	TEMPLATE_FINAL_BLOOM,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_STANDARD_MAPS,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
	TEMPLATE_INSTANCED_UNLIT_MAP,
	TEMPLATE_LINE,
	TEMPLATE_LINE_LIT,
	TEMPLATE_OUTLINE_MASK,
	TEMPLATE_SHADOW_CUTOUT,
	TEMPLATE_SHADOW_CUTOUT_MAP,
	TEMPLATE_SHADOW_DEPTH,
	TEMPLATE_SPRITE,
	TEMPLATE_SPRITE_MAP,
} from '../../generated/gpu';
import {
	DEBUG_LINES_SHADER,
	DEBUG_VIEW_SHADER,
	DEPTH_MAPPING_UNIFORM,
	type DeviceShaders,
	type GlslProgram,
	type GlslStage,
	type ShaderVariants,
} from '../../generated/shaders';
import { DEV } from '../../shared/dev';
import { LINE_VERTICES } from '../line-vertices';
import { variantFor } from '../variants';
import type { DepthSetup } from './depth';

/**
 * The first slot of each bind group. A slot is a uniform block binding point, a sampler's place and
 * the place where a bind group leaves a texture, and each binding of a group takes its group's
 * first slot plus its binding number. The per-frame group, which holds the most bindings, comes
 * first, with fourteen. Group 1 has three slots, group 2 eight (the instance textures, then the two
 * textures that skinned meshes read and the two that morphed meshes read) and group 3 the last
 * sixteen: the eight map textures, then their samplers, of which the standard material's shared
 * map units take the first six of each. Slots are no texture units: each program
 * numbers the textures it reads from unit 0, so the groups' bindings never run out of units. The
 * groups' uniform blocks stay below the fewest binding points that WebGL2 allows.
 */
const GROUP_BASES = Uint8Array.of(0, 14, 17, 25);

/** The fewest uniform block binding points that a WebGL2 context has. */
export const MIN_UNIFORM_BLOCK_SLOTS = 24;

/**
 * The texture unit that texture uploads and copies use, apart from the units that programs read:
 * the last of the 32 that every WebGL2 context has.
 */
export const UPLOAD_UNIT = 31;

/**
 * The fewest texture units that a WebGL2 context gives each shader stage. A program whose stage
 * reads more would fail to link on some devices.
 */
export const MIN_STAGE_TEXTURE_UNITS = 16;

/** The slot of a binding of a bind group: its texture unit, uniform block binding point or sampler's place. */
export function slotOf(group: number, binding: number): number {
	return (GROUP_BASES[group] as number) + binding;
}
/** The sampler slot of a texture that a shader reads with `texelFetch`, which needs no sampler. */
export const NO_SAMPLER = -1;

/**
 * How the backend builds the programs of one render pipeline template: the shader's variants, of
 * which a pipeline's permutation word picks one, and the render pipeline that the template draws
 * with.
 */
export interface GlslTemplate {
	readonly shader: ShaderVariants;
	readonly pipeline: string;
	/**
	 * For a template that draws from a vertex buffer of its own, not from a mesh: the layout of the
	 * buffer in slot 0, as WebGPU describes it.
	 */
	readonly vertices?: GPUVertexBufferLayout;
	/**
	 * True for a template that draws meshes, whose pipelines with the `PREPASS` bit draw the depth
	 * prepass: with the vertex shader of the template's build without that bit, and a fragment
	 * shader that writes nothing.
	 */
	readonly meshPrepass?: boolean;
}

/** The fragment shader of the depth prepass, which writes no color. */
const PREPASS_FRAGMENT: GlslStage = {
	source: '#version 300 es\nvoid main() {}\n',
	uniformBlocks: [],
	textures: [],
};

/**
 * The permutation of the build that a pipeline of a template draws with: a mesh template's prepass
 * takes the vertex shader of its build without the `PREPASS` bit.
 */
export function buildPermutation(template: GlslTemplate, permutation: number): number {
	return template.meshPrepass ? permutation & ~PERMUTATION_PREPASS : permutation;
}

/** A linked, or linking, program, which every pipeline of its template and permutation shares. */
export interface Program {
	/** The GL program, which a second link at the first use may replace (see `prepareProgram`). */
	program: WebGLProgram;
	readonly source: GlslProgram;
	shaders: readonly WebGLShader[];
	/** The location of naga's first-instance uniform, when the vertex shader has one. */
	firstInstance: WebGLUniformLocation | null;
	firstInstanceValue: number;
	/**
	 * Triples of a texture unit that the program reads, the slot where bind groups leave the
	 * unit's texture, and the slot of the sampler it reads the unit with, or `NO_SAMPLER`. Units
	 * count from 0, one for each texture the program reads. GLSL joins each texture with its
	 * sampler, so the backend binds each triple's texture and sampler to its unit.
	 */
	textureUnits: readonly number[];
	/** True once the link result was checked and the blocks and textures were bound. */
	ready: boolean;
	/**
	 * True when the program compiles in the background: until it has, the draws that use it draw
	 * nothing. Otherwise its first draw waits for the compile.
	 */
	background: boolean;
}

/** A render pipeline: its program, and the fixed-function state and vertex format it asks for. */
export interface Pipeline {
	readonly program: Program;
	/** The faces it culls: GL's `BACK` or `FRONT`, or 0 for none. */
	readonly cull: number;
	/** True when it draws with a depth target, whose test it then runs. */
	readonly depth: boolean;
	/** True when it writes depth. */
	readonly depthWrite: boolean;
	/** GL's depth function for its depth test, in the backend's depth mode. */
	readonly depthFunc: number;
	/** True when it writes color. */
	readonly colorWrite: boolean;
	/** The blend mode: a `STATE_BLEND_*` flag, or 0 for none. */
	readonly blend: number;
	/** True when the fragment's alpha decides which of the pixel's samples it covers. */
	readonly alphaToCoverage: boolean;
	/** GL's polygon offset for the backend's depth mode: its factor and its units. */
	readonly offsetFactor: number;
	readonly offsetUnits: number;
	/** The vertex format of the meshes it draws, which places their attributes in vertex arrays. */
	readonly vertexFormat: number;
	/** The primitive that its draws make: GL's `TRIANGLES`, or `LINES`. */
	readonly mode: number;
	/** The layout of its template's own vertex buffer, for a template that draws no mesh. */
	readonly vertices: GPUVertexBufferLayout | undefined;
}

/** The engine's render pipeline templates, by template id, from the shaders the device loaded. */
export function engineTemplates(shaders: DeviceShaders): (GlslTemplate | undefined)[] {
	const templates: (GlslTemplate | undefined)[] = [];
	const mesh = (shader: ShaderVariants): GlslTemplate => ({
		shader,
		pipeline: 'main',
		meshPrepass: true,
	});
	templates[TEMPLATE_INSTANCED_LIT] = mesh(shaders.lit);
	templates[TEMPLATE_INSTANCED_UNLIT] = mesh(shaders.unlit);
	templates[TEMPLATE_INSTANCED_TEXCOORDS] = mesh(shaders.texcoords);
	templates[TEMPLATE_INSTANCED_UNLIT_MAP] = mesh(shaders.unlit_map);
	templates[TEMPLATE_INSTANCED_STANDARD_MAPS] = mesh(shaders.standard_maps);
	templates[TEMPLATE_FINAL] = { shader: shaders.final, pipeline: 'main' };
	templates[TEMPLATE_FINAL_BLOOM] = { shader: shaders.final, pipeline: 'main' };
	templates[TEMPLATE_BLOOM] = { shader: shaders.bloom, pipeline: 'main' };
	templates[TEMPLATE_SHADOW_DEPTH] = { shader: shaders.shadow_depth, pipeline: 'main' };
	templates[TEMPLATE_SHADOW_CUTOUT] = { shader: shaders.shadow_cutout, pipeline: 'main' };
	templates[TEMPLATE_SHADOW_CUTOUT_MAP] = { shader: shaders.shadow_cutout_map, pipeline: 'main' };
	templates[TEMPLATE_OUTLINE_MASK] = { shader: shaders.outline_mask, pipeline: 'main' };
	// Sprites turn their quads to face the camera, so their prepass draws with their own vertex
	// shader too.
	templates[TEMPLATE_SPRITE] = mesh(shaders.sprite);
	templates[TEMPLATE_SPRITE_MAP] = mesh(shaders.sprite_map);
	templates[TEMPLATE_LINE] = { shader: shaders.line, pipeline: 'main' };
	templates[TEMPLATE_LINE_LIT] = { shader: shaders.line_lit, pipeline: 'main' };
	templates[TEMPLATE_BACKGROUND] = { shader: shaders.background, pipeline: 'main' };
	templates[TEMPLATE_BACKGROUND_CUBE] = { shader: shaders.background_cube, pipeline: 'main' };
	templates[TEMPLATE_BACKGROUND_SKY] = { shader: shaders.sky, pipeline: 'main' };
	// WebGL2's depth step always reads one sample: the backend keeps a copy of one sample of a
	// multisampled depth target that a shader reads.
	templates[TEMPLATE_AO_DEPTH] = { shader: shaders.ao, pipeline: 'depth' };
	templates[TEMPLATE_AO] = { shader: shaders.ao, pipeline: 'horizon' };
	templates[TEMPLATE_AO_DENOISE] = { shader: shaders.ao, pipeline: 'denoise' };
	if (DEV) {
		templates[TEMPLATE_DEBUG_LINES] = {
			shader: DEBUG_LINES_SHADER,
			pipeline: 'main',
			vertices: LINE_VERTICES,
		};
		// The debug views draw meshes in place of every material, so they draw the prepass too.
		templates[TEMPLATE_DEBUG_VIEW] = mesh(DEBUG_VIEW_SHADER);
	}
	return templates;
}

/**
 * A program of the mip shader, from the shaders the device loaded: `main` draws a mip level of a
 * texture array's layer from the level before it, and `copy` copies a level of a layer.
 */
export function mipmapTemplate(shaders: DeviceShaders, pipeline: 'main' | 'copy'): GlslTemplate {
	return { shader: shaders.mipmap, pipeline };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('WebGL2 could not create a shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return shader;
}

/**
 * Starts compiling a program's two shaders, each source with `tail` added, and linking them into a
 * new GL program.
 */
function link(
	gl: WebGL2RenderingContext,
	source: GlslProgram,
	tail: string,
): { program: WebGLProgram; shaders: WebGLShader[] } {
	const program = gl.createProgram();
	if (!program) throw new Error('WebGL2 could not create a program');
	const shaders = [
		compile(gl, gl.VERTEX_SHADER, source.vertex.source + tail),
		compile(gl, gl.FRAGMENT_SHADER, source.fragment.source + tail),
	];
	for (const shader of shaders) gl.attachShader(program, shader);
	gl.linkProgram(program);
	return { program, shaders };
}

/**
 * Starts compiling and linking a template's program, in the shader variant that the permutation
 * bits pick, without waiting for the result. A mesh template's prepass program pairs the vertex
 * shader of its build with the prepass's fragment shader.
 */
export function createProgram(
	gl: WebGL2RenderingContext,
	template: GlslTemplate,
	permutation: number,
): Program {
	const build = buildPermutation(template, permutation);
	const shading = variantFor(template.shader, build, 'glsl')?.glsl?.[template.pipeline];
	const source =
		shading && build !== permutation ? { ...shading, fragment: PREPASS_FRAGMENT } : shading;
	if (!source)
		throw new Error(`this render pipeline template has no variant for permutation ${permutation}`);
	const { program, shaders } = link(gl, source, '');
	return {
		program,
		source,
		shaders,
		firstInstance: null,
		firstInstanceValue: 0,
		textureUnits: [],
		ready: false,
		background: false,
	};
}

/**
 * Whether a GLSL stage declares a uniform or a uniform block of this name. A driver may remove a
 * declared uniform that the program never reads, as GLSL allows, so a linked program can lack a
 * name that its source declares.
 */
export function declaresUniform(source: string, name: string): boolean {
	return new RegExp(`^\\s*(?:layout\\([^)]*\\)\\s*)?uniform\\b[^;{]*\\b${name}\\b`, 'm').test(
		source,
	);
}

/**
 * The part of a link log that tells of Safari's random Metal fault: its translator now and then
 * writes Metal that does not compile from GLSL that links at the next try (see "Browser faults" in
 * the maintainer notes).
 */
export const METAL_FAULT = 'MSL compilation error';

/**
 * The comment that the second link adds to the end of each source. A browser that keeps translated
 * shaders by their source then translates them afresh.
 */
export const RELINK_TAIL = '\n// null3d: second link\n';

/** The error of a program whose link failed, with the logs of its program and shaders. */
function linkError(gl: WebGL2RenderingContext, p: Program, attempt: string): Error {
	const logs = p.shaders
		.map((shader) => gl.getShaderInfoLog(shader))
		.filter((log) => log)
		.join('\n');
	return new Error(
		`a WebGL2 program failed to link${attempt}: ${gl.getProgramInfoLog(p.program)}\n${logs}`,
	);
}

/**
 * Checks the program's link result, binds its uniform blocks to the slots of their WGSL groups and
 * bindings, gives each texture it reads a unit, counting from 0, and sets its vertex shader's
 * depth mapping for the backend's depth mode, once, at its first use. A texture that both stages
 * read takes one unit. A block or texture that the driver removed, because the program never reads
 * it, needs no binding and is skipped. The program is in use afterwards. A link that failed with
 * Safari's random Metal fault is done once more, into a new program, and waited for.
 */
export function prepareProgram(gl: WebGL2RenderingContext, p: Program, depth: DepthSetup): void {
	if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) {
		if (!gl.getProgramInfoLog(p.program)?.includes(METAL_FAULT)) throw linkError(gl, p, '');
		for (const shader of p.shaders) gl.deleteShader(shader);
		gl.deleteProgram(p.program);
		const relinked = link(gl, p.source, RELINK_TAIL);
		p.program = relinked.program;
		p.shaders = relinked.shaders;
		if (!gl.getProgramParameter(p.program, gl.LINK_STATUS))
			throw linkError(gl, p, ' twice, the second time after a fault in its Metal');
	}
	for (const shader of p.shaders) {
		gl.detachShader(p.program, shader);
		gl.deleteShader(shader);
	}
	gl.useProgram(p.program);
	const textureUnits: number[] = [];
	for (const stage of [p.source.vertex, p.source.fragment]) {
		for (const block of stage.uniformBlocks) {
			const index = gl.getUniformBlockIndex(p.program, block.name);
			if (index !== gl.INVALID_INDEX)
				gl.uniformBlockBinding(p.program, index, slotOf(block.group, block.binding));
		}
		for (const texture of stage.textures) {
			const location = gl.getUniformLocation(p.program, texture.name);
			if (!location) continue;
			const slot = slotOf(texture.group, texture.binding);
			const sampler = texture.sampler;
			const samplerSlot = sampler ? slotOf(sampler.group, sampler.binding) : NO_SAMPLER;
			let known = -1;
			for (let k = 0; k < textureUnits.length; k += 3) if (textureUnits[k + 1] === slot) known = k;
			if (known < 0) {
				known = textureUnits.length;
				textureUnits.push(known / 3, slot, samplerSlot);
			} else if (textureUnits[known + 2] !== samplerSlot) {
				throw new Error('a WebGL2 program samples one texture with two samplers');
			}
			gl.uniform1i(location, textureUnits[known] as number);
		}
	}
	if (textureUnits.length / 3 > UPLOAD_UNIT)
		throw new Error(`a WebGL2 program reads ${textureUnits.length / 3} textures, past its units`);
	p.textureUnits = textureUnits;
	p.firstInstance = gl.getUniformLocation(p.program, 'naga_vs_first_instance');
	const mapping = gl.getUniformLocation(p.program, DEPTH_MAPPING_UNIFORM);
	if (mapping) gl.uniform2f(mapping, depth.scale, depth.offset);
	p.ready = true;
}

/**
 * What code that loads on first use, such as the texture generators, needs to draw with programs of
 * its own: the context, and a program for a template of one build, linked, with its blocks and
 * textures given units and its depth mapping set. `program` leaves the program in use.
 * `programLater` compiles in the background where the context can, and leaves the program in use
 * that was. `slot` gives the uniform block binding point of each binding, and `unit` the texture
 * unit from which a program of the host reads a binding's texture. The code then imports nothing
 * from the files that the start loads.
 */
export interface ProgramHost {
	readonly gl: WebGL2RenderingContext;
	program(template: GlslTemplate): WebGLProgram;
	programLater(template: GlslTemplate): Promise<WebGLProgram>;
	slot(group: number, binding: number): number;
	unit(program: WebGLProgram, group: number, binding: number): number;
}

/** How often `programLater` asks whether a program that compiles in the background is done. */
const COMPILE_POLL_MS = 4;

/**
 * The program host of a context that draws in a depth mode, with `KHR_parallel_shader_compile`
 * where the context has it and the device uses it.
 */
export function programHost(
	gl: WebGL2RenderingContext,
	depth: DepthSetup,
	parallel: KHR_parallel_shader_compile | null = null,
): ProgramHost {
	const linked = new WeakMap<WebGLProgram, Program>();
	return {
		gl,
		program(template) {
			const p = createProgram(gl, template, 0);
			prepareProgram(gl, p, depth);
			linked.set(p.program, p);
			return p.program;
		},
		async programLater(template) {
			const p = createProgram(gl, template, 0);
			while (parallel && !gl.getProgramParameter(p.program, parallel.COMPLETION_STATUS_KHR))
				await new Promise((resolve) => setTimeout(resolve, COMPILE_POLL_MS));
			const inUse = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
			prepareProgram(gl, p, depth);
			gl.useProgram(inUse);
			linked.set(p.program, p);
			return p.program;
		},
		slot: slotOf,
		unit(program, group, binding) {
			const units = linked.get(program)?.textureUnits ?? [];
			const slot = slotOf(group, binding);
			for (let k = 0; k < units.length; k += 3)
				if (units[k + 1] === slot) return units[k] as number;
			throw new Error(`a WebGL2 program reads no texture at group ${group}, binding ${binding}`);
		},
	};
}
