// The sketch's own render passes, which `ctx.render` adds to the engine's render graph. A scene
// pass draws the scene from a camera of the sketch into a texture of its own size, which
// `textures.fromPass` gives to materials and sprites, as a minimap or a security camera's screen
// shows it. A reflection pass draws the camera's view mirrored across a plane, into a texture of
// the render size or a part of it, which a custom material reads where its surface shows on the
// screen, as water and polished floors do. A full-screen pass runs the sketch's WGSL, written as a
// custom effect's, over the whole of a texture of its own: a blur step, a mask's edges or a
// texture that the GPU makes, which materials and effects read. The engine core checks each
// change against the whole graph at once, so a pass that reads a missing target, makes one twice
// or closes a loop throws its error code from the call.

import { checkLayers, checkLive, DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { FORMAT_R32_FLOAT, FORMAT_RGBA8_UNORM, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { ShaderVariants } from '../generated/shaders';
import { type ColorInput, linearColor } from './color';
import {
	type CompiledEffect,
	effectTemplate,
	writeEffectBlocks,
	writeTextures,
	writeUniform,
} from './effects';
import type { FeatureInstanceBuffer } from './feature-instances';
import type { FeatureDescription } from './features';
import type { CoreMemory } from './memory';
import type { CompiledWgsl } from './resources';
import type { Camera, Scene, Vec3 } from './scene';
import type { ShaderPreloads } from './shader-preloads';
import type { ShaderTemplates } from './shader-templates';
import type { Texture } from './textures';
import type { TextureValues, UniformType, UniformValue, UniformValues } from './wgsl-uniforms';

/**
 * The size of a pass's texture in pixels, as `[width, height]`: whole numbers from 1 to the
 * device's largest texture.
 *
 * @category api/render
 */
export type RenderPassSize = readonly [width: number, height: number];

/**
 * A share of a size each way: the whole size, half or a quarter.
 *
 * @category api/render
 */
export type PassScale = 1 | 0.5 | 0.25;

/**
 * Options of `render.addPass` for a scene pass, which draws the scene from a camera into a texture
 * of its own size or a share of the render size. `textures.fromPass` gives the texture to materials
 * and sprites.
 *
 * @category api/render
 */
export interface ScenePassOptions {
	/** `'scene'`: the pass draws the scene's objects from `camera`. */
	readonly kind: 'scene';
	/**
	 * The camera that the pass draws from. Its lens takes the texture's shape, so an aspect ratio
	 * follows `size`. A camera that is destroyed leaves the texture with its last image.
	 */
	readonly camera: Camera;
	/**
	 * The name of the pass's texture in the render graph. Other passes name it in `reads`, and
	 * `render.dumpGraph()` and errors show it. Each pass writes a name of its own.
	 */
	readonly writes: string;
	/** The texture's size in pixels. A pass takes `size` or `scale`. */
	readonly size?: RenderPassSize;
	/**
	 * The texture's size as a share of the render size each way, which the pass fills at any render
	 * scale, so its aspect ratio follows the canvas. A pass takes `size` or `scale`.
	 */
	readonly scale?: PassScale;
	/** The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. */
	readonly name?: string;
	/**
	 * The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by
	 * default, and follows them when they change.
	 */
	readonly layers?: number;
	/**
	 * The pass draws in one frame of every `every`, from the first, and the texture keeps its last
	 * image in between. It is 1 by default: every frame.
	 */
	readonly every?: number;
	/**
	 * The textures of other passes that the objects this pass draws may show, by the names those
	 * passes write. The pass runs after them. An object whose material shows the texture of a pass
	 * that this pass does not read, or its own texture, does not draw in this pass.
	 */
	readonly reads?: readonly string[];
	/**
	 * The color that the texture clears to before the pass draws. It is the scene's background
	 * color by default.
	 */
	readonly clearColor?: ColorInput;
	/** The alpha that the texture clears to with `clearColor`, from 0 to 1. It is 1 by default. */
	readonly clearAlpha?: number;
}

/**
 * The plane that a reflection pass mirrors the camera's view across.
 *
 * @category api/render
 */
export interface ReflectionPlane {
	/** A point on the plane, in the world, such as a point on the water's surface. */
	readonly point: Vec3;
	/**
	 * The plane's normal, toward the side that the reflection shows. It need not have length 1.
	 * It is up, (0, 1, 0), by default, for water and floors.
	 */
	readonly normal?: Vec3;
}

/**
 * Options of `render.addPass` for a reflection pass, which draws the camera's view mirrored across
 * a plane into a texture of the render size or a part of it. A custom material reads it where its
 * surface shows on the screen, with `reflection_uv` from `null3d::reflection`, and lights it as
 * the surface's `reflection`. Nothing below the plane shows in it.
 *
 * @category api/render
 */
export interface ReflectionPassOptions {
	/** `'reflection'`: the pass draws the camera's view mirrored across `plane`. */
	readonly kind: 'reflection';
	/** The plane that the pass mirrors the view across. */
	readonly plane: ReflectionPlane;
	/**
	 * The name of the pass's texture in the render graph, as a scene pass's `writes`. Each pass
	 * writes a name of its own.
	 */
	readonly writes: string;
	/**
	 * The texture's size as a share of the render size each way, which the pass fills at any render
	 * scale. It follows the quality preset's `reflectionScale` by default.
	 */
	readonly scale?: PassScale;
	/**
	 * The pass draws in one frame of every `every`, from the first, and the texture keeps its last
	 * image in between. It is 1 by default: every frame. The reflection lags a moving camera in
	 * the frames between, so a larger value suits a camera that moves slowly.
	 */
	readonly every?: number;
	/** The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. */
	readonly name?: string;
	/**
	 * The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by
	 * default, and follows them when they change.
	 */
	readonly layers?: number;
	/** The textures of other passes that the objects this pass draws may show, as a scene pass's. */
	readonly reads?: readonly string[];
	/**
	 * The color that the texture clears to before the pass draws, behind the scene's background.
	 * It is the scene's background color by default.
	 */
	readonly clearColor?: ColorInput;
	/** The alpha that the texture clears to with `clearColor`, from 0 to 1. It is 1 by default. */
	readonly clearAlpha?: number;
}

/**
 * The image of the camera's view that a full-screen pass reads as its input: the scene color as
 * the camera's passes leave it, before custom effects and bloom, or the outline mask, which holds
 * the outlined objects' coverage in red and the parts that nothing hides in green.
 *
 * @category api/render
 */
export type PassInput = 'sceneColor' | 'outlineMask';

/**
 * Options of `render.addPass` for a full-screen pass, which runs WGSL written as a custom effect's
 * over the whole of a texture of its own. `Wgsl` is the type of the WGSL. It gives the names and
 * types of the uniforms and the names of the textures.
 *
 * @category api/render
 */
export interface FullscreenPassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** `'fullscreen'`: the pass runs `wgsl` for each pixel of its texture. */
	readonly kind: 'fullscreen';
	/**
	 * WGSL compiled by the null3D Vite plugin that declares `fn effect(input: EffectInput) ->
	 * vec4f`, as a custom effect's does. `input.uv` and `input.pixel` place the pixel on the pass's
	 * own texture, and `input.color` is the input image there.
	 */
	readonly wgsl: Wgsl;
	/** The name of the pass's texture in the render graph, as a scene pass's `writes`. */
	readonly writes: string;
	/** The texture's size in pixels. A pass takes `size` or `scale`. */
	readonly size?: RenderPassSize;
	/**
	 * The texture's size as a share of the render size each way, which the pass fills at any render
	 * scale. It is 1 by default, without `size`.
	 */
	readonly scale?: PassScale;
	/**
	 * The image that the pass reads as its input, through `input.color`, `effectColor` and
	 * `effectPixel`. Without one, they read transparent black. A pass with an input, or whose WGSL
	 * reads the scene's depth, runs after the camera's passes, so a material that shows its texture
	 * shows the frame before.
	 */
	readonly input?: PassInput;
	/**
	 * The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name, as an
	 * effect's `textures`. The pass runs after the passes whose textures it reads.
	 */
	readonly textures?: NoInfer<TextureValues<Wgsl>>;
	/** The first value of each uniform, by name. A uniform without one starts at 0. */
	readonly uniforms?: NoInfer<
		[keyof UniformValues<Wgsl>] extends [never]
			? { readonly [name: string]: never }
			: UniformValues<Wgsl>
	>;
	/** The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. */
	readonly name?: string;
	/**
	 * The pass draws in one frame of every `every`, from the first, and the texture keeps its last
	 * image in between. It is 1 by default: every frame.
	 */
	readonly every?: number;
}

/**
 * The format of a compute pass's storage texture. `'rgba16float'` holds HDR color, `'r32float'`
 * holds one 32-bit number per pixel, and `'rgba8unorm'` holds 8-bit color.
 *
 * @category api/render
 */
export type ComputeFormat = 'rgba16float' | 'r32float' | 'rgba8unorm';

/**
 * The invocations of a workgroup along each axis, from 1: x and y up to 128 and z up to 64.
 *
 * @category api/render
 */
export type ComputeWorkgroup = readonly [x: number, y: number, z: number];

/**
 * The workgroup counts of a compute pass's dispatch: `'writes'` divides the target's size by the
 * workgroup size and rounds up, so every pixel of the target is written, and three whole numbers
 * give the counts along each axis.
 *
 * @category api/render
 */
export type ComputeDispatch = 'writes' | ComputeWorkgroup;

/**
 * The fragment-pass form of a compute pass, which a WebGL2 page runs in its place: WGSL written as
 * a custom effect's, which declares `fn effect(input: EffectInput) -> vec4f`. It draws over the
 * whole target with the same values and textures as the compute pass.
 *
 * @category api/render
 */
export interface ComputeFallback<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** The compiled WGSL of the fragment form, as a custom effect's. */
	readonly wgsl: Wgsl;
}

/**
 * Options of `render.addPass` for a compute pass, which runs a compiled compute shader over a
 * storage texture of its own. The texture is the description's output, which `textures.fromPass`
 * gives to materials, effects and other passes: they sample it in the frame that the pass writes
 * it, and the render graph orders the pass before them. A compute pass runs on WebGPU. On WebGL2
 * it runs its fragment form when the options give one, and the call throws otherwise.
 *
 * The shader declares `@group(0) @binding(0) var<uniform>` for the pass's block and
 * `@group(0) @binding(1) var` for its storage texture, which it reads as an array of one layer,
 * and the textures of `textures` at group 1, as a custom material's maps bind. The block holds the
 * render size, the clock, the inverse of the camera's projection, eight vectors of `values`, and
 * the target's size.
 *
 * @category api/render
 */
export interface ComputePassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** `'compute'`: the pass runs `wgsl` once for each workgroup of its dispatch. */
	readonly kind: 'compute';
	/**
	 * The feature description that places the pass: its frame point, its order band and order, and
	 * its single output, which names the texture that the pass writes.
	 */
	readonly description: FeatureDescription;
	/** The compiled WGSL, whose `@compute` entry point fills the storage texture. */
	readonly wgsl: Wgsl;
	/** The storage texture's format. The default is `'rgba16float'`. */
	readonly format?: ComputeFormat;
	/**
	 * The invocations along each axis of a workgroup. The default is the shader's
	 * `@workgroup_size`. Another value throws, so a pass cannot dispatch another grid.
	 */
	readonly workgroupSize?: ComputeWorkgroup;
	/** The workgroup counts. The default is `'writes'`, the target's size divided by a workgroup. */
	readonly dispatch?: ComputeDispatch;
	/** The texture's size in pixels. A pass takes `size` or `scale`. */
	readonly size?: RenderPassSize;
	/** The texture's size as a share of the render size each way. It is 1 by default. */
	readonly scale?: PassScale;
	/**
	 * The textures that the shader samples, in the order of its map slots: textures from files or
	 * data, or other passes' textures from `textures.fromPass`. A missing slot samples as white.
	 * The pass runs after the passes that write the textures it gives.
	 */
	readonly textures?: readonly (Texture | undefined)[];
	/**
	 * The pass's values: up to 32 numbers, which the shader reads as eight vectors in its block.
	 * Change them with `render.setPassUniforms`.
	 */
	readonly values?: readonly number[];
	/**
	 * The two buffers of one instance draw that the pass writes, in binding order: the draw's count
	 * word, then its per-instance rows. A pass with buffers has no storage texture and publishes no
	 * output, gives its workgroup counts, and runs on WebGPU alone.
	 */
	readonly buffers?: readonly [FeatureInstanceBuffer, FeatureInstanceBuffer];
	/** The fragment form, which a WebGL2 page runs in place of the compute pass. */
	readonly fallback?: ComputeFallback;
	/** The pass's name in `render.dumpGraph()` and errors. It is the output's name by default. */
	readonly name?: string;
	/**
	 * The pass runs in one frame of every `every`, from the first, and its texture keeps its last
	 * image in between. It is 1 by default: every frame.
	 */
	readonly every?: number;
}

/**
 * Options of `render.addPass`.
 *
 * @category api/render
 */
export type RenderPassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> =
	| ScenePassOptions
	| ReflectionPassOptions
	| FullscreenPassOptions<Wgsl>
	| ComputePassOptions<Wgsl>;

/** A uniform of a full-screen pass: its type, and the float of the pass's values it starts at. */
interface PassUniform {
	readonly name: string;
	readonly type: UniformType;
	readonly offset: number;
}

/** What a full-screen pass keeps: its uniforms by name, and the values and textures it sends. */
interface FullscreenState {
	readonly uniforms: ReadonlyMap<string, PassUniform>;
	readonly values: Float32Array;
	readonly textures: Uint32Array;
}

/**
 * A pass that `render.addPass` added. `render.setPassEnabled` switches it, and
 * `render.removePass` removes it.
 *
 * @category api/render
 */
export class RenderPass {
	/** @internal Its view's place in the engine core, or 0 once it was removed. */
	place: number;
	/** @internal True while the pass draws. */
	on = true;
	/**
	 * @internal True for a compute pass of a WebGL2 page, which runs as a full-screen pass and
	 * takes its values through `setPassValues`.
	 */
	fallback = false;
	/** @internal The textures that `textures.fromPass` made of it, which its removal destroys. */
	readonly textures: { readonly live: boolean; destroy(): void }[] = [];

	/** @internal */
	constructor(
		place: number,
		/** The kind of pass. */
		readonly kind: 'scene' | 'reflection' | 'fullscreen' | 'compute',
		/** The pass's name in the render graph. */
		readonly name: string,
		/** The name of the texture it draws into. */
		readonly writes: string,
		/** The texture's width in pixels, or 0 for a texture that follows the render size. */
		readonly width: number,
		/** The texture's height in pixels, or 0 for a texture that follows the render size. */
		readonly height: number,
		/** @internal The camera it draws from, or none for a pass of another kind. */
		readonly camera: Camera | undefined,
		/** @internal Its own layers, or undefined to follow the camera's. */
		readonly layers: number | undefined,
		/** @internal A full-screen pass's uniforms, values and textures, or a compute pass's values. */
		readonly fullscreen?: FullscreenState,
	) {
		this.place = place;
	}

	/** True until `render.removePass` removes the pass. */
	get live(): boolean {
		return this.place > 0;
	}

	/** True while the pass draws in each frame. A pass switched off keeps its last image. */
	get enabled(): boolean {
		return this.on;
	}
}

/** E1220 for a call that got options or a pass that it cannot take. */
function invalid(call: string, detail: string): EngineError {
	return new EngineError('E1220', `${call}() ${detail}`);
}

/** E1223 for a feature description that an adapter cannot place. */
function refuse(call: string, detail: string): EngineError {
	return new EngineError('E1223', `${call}() ${detail}`);
}

/**
 * The sketch's own render passes. A sketch finds it as `ctx.render`.
 *
 * @category api/render
 */
export class Render {
	/** The live passes, which name their textures. */
	private readonly passes: RenderPass[] = [];
	/** True when a pass came since the last frame, with pipelines to build. */
	private newPipelines = false;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		private readonly scene: Scene,
		/** Asks for the passes' shader file when the first pass comes. */
		private readonly shaders: ShaderPreloads,
		/** The templates of compiled WGSL, which full-screen passes share with effects. */
		private readonly templates: ShaderTemplates,
		/** The widest and tallest texture of the device. */
		private readonly maxSize: number,
		/** True when the page draws on WebGL2, which has no compute shaders. */
		private readonly webgl2 = false,
	) {}

	/**
	 * Adds a pass to the render graph, from the next frame on, and returns it. A scene pass draws
	 * the scene from a camera into a texture of its own, which `textures.fromPass` gives to
	 * materials. A reflection pass draws the camera's view mirrored across a plane, with the
	 * scene's background, and clips everything below the plane. A full-screen pass runs WGSL
	 * written as a custom effect's over its whole texture, which materials and effects read. A
	 * compute pass runs a compute shader over a storage texture of its own on WebGPU, which
	 * materials, effects and other passes sample in the same frame. A WebGL2 page runs its
	 * fragment form, or the call throws when it gives none. A pass runs only while something shows
	 * or reads its texture.
	 *
	 * Scene and reflection passes draw the sun, its shadows where the main camera's cascades reach,
	 * the ambient light, the point and spot lights that the pass's view sees, the environment's
	 * light and fog. A point or spot light casts its shadow in a pass where the main camera's view
	 * gives it a shadow. A light that only the pass sees casts none there. Both draw the scene's
	 * background unless a scene pass has a `clearColor`. Neither kind draws ambient occlusion.
	 *
	 * Throws E1220 for options it does not take, a name that a live pass writes already, or the
	 * 32nd live pass. Throws E1215 for full-screen WGSL that the plugin did not compile as an
	 * effect, and E1216 for a wrong uniform or texture. Throws the render graph's code when the
	 * pass does not fit the graph: E1502 for a texture in `reads` that no pass writes, E1503 for a
	 * name that the engine's own passes write, E1504 for passes that read each other's textures,
	 * and E1505 for targets that one render pass cannot hold.
	 */
	addPass<const Wgsl extends string | CompiledWgsl>(options: RenderPassOptions<Wgsl>): RenderPass {
		const call = 'render.addPass';
		if (DEV) checkOptions(options as RenderPassOptions, call, this.maxSize);
		if (options.kind === 'compute') return this.addCompute(options, call);
		const { writes } = options;
		const name = options.name ?? writes;
		this.claim(writes, name, call);
		const pass =
			options.kind === 'fullscreen'
				? this.addFullscreen(options as unknown as FullscreenPassOptions, name, call)
				: this.addView(options, name, call);
		return this.keep(pass);
	}

	/** Throws E1220 for a texture name or a pass name that a live pass has, or the 32nd pass. */
	private claim(writes: string, name: string, call: string): void {
		for (const pass of this.passes) {
			if (pass.writes === writes)
				throw invalid(
					call,
					`got writes "${writes}", which the pass "${pass.name}" writes already. Give each pass a texture name of its own.`,
				);
			if (pass.name === name)
				throw invalid(
					call,
					`got the name "${name}", which another pass has already. Give each pass a name of its own.`,
				);
		}
		if (this.passes.length >= C.SCENE_PASS_MAX)
			throw invalid(
				call,
				`got pass ${this.passes.length + 1}, and at most ${C.SCENE_PASS_MAX} passes draw at once. Remove a pass first.`,
			);
	}

	/** Keeps a new pass, so the next frame draws it and builds its pipelines. */
	private keep(pass: RenderPass): RenderPass {
		this.passes.push(pass);
		this.newPipelines = true;
		return pass;
	}

	/**
	 * Adds a compute pass, which runs its WGSL over a storage texture that materials, effects and
	 * other passes sample in the same frame. A WebGL2 page runs the pass's fragment form instead,
	 * or the call throws when it gives none.
	 */
	private addCompute(options: ComputePassOptions, call: string): RenderPass {
		const { fallback, size, scale, every, name: given, buffers } = options;
		const draws = buffers !== undefined;
		const writes = draws ? '' : checkComputeTarget(options, call);
		if (draws) checkComputeBuffers(options, call);
		checkSize(draws ? undefined : size, draws ? undefined : scale, call, this.maxSize);
		const name = given ?? (draws ? options.description.name : writes);
		if (!draws) this.claim(writes, name, call);
		// A pass that fills buffers has no texture: its view keeps a 1 by 1 target that nothing
		// samples, so that the render graph places it like any other compute pass.
		const [width, height] = draws ? [1, 1] : (size ?? [0, 0]);
		const values = new Float32Array(C.EFFECT_FLOATS);
		const textures = new Uint32Array(C.EFFECT_TEXTURES);
		writeComputeValues(values, options.values, call);
		writeComputeTextures(textures, options.textures, call);
		writeEffectBlocks(this.core, values, textures);
		const state: FullscreenState = { uniforms: new Map(), values, textures };
		// A WebGL2 page runs the fragment form, so the compute shader's options matter only where
		// compute runs.
		const setup = this.webgl2 ? undefined : checkCompute(options, call);
		if (this.webgl2) {
			if (draws)
				throw invalid(
					call,
					`got the compute pass "${name}" filling an instance draw's buffers on WebGL2, which has no compute shaders. Fill the draw with draw.setInstances and draw.setCount there instead.`,
				);
			if (!fallback)
				throw invalid(
					call,
					`got the compute pass "${name}" on WebGL2, which has no compute shaders. Give the pass a fallback: WGSL written as a custom effect's that does the same work for each pixel.`,
				);
			const frame = effectTemplate(this.templates, compiledPass(fallback.wgsl, call));
			// A pass at the resolve or post point reads the scene color, so the fragment form runs
			// after the camera's passes there, as the compute pass does.
			const afterScene =
				options.description.frame === 'resolve' || options.description.frame === 'post';
			const place = this.core.check(
				this.core.glue.addFullscreenPass(
					name,
					writes,
					width,
					height,
					scale ?? 1,
					every ?? 1,
					frame,
					0,
					afterScene ? C.PASS_SOURCE_SCENE_COLOR : C.PASS_SOURCE_NONE,
				),
				call,
			);
			const pass = new RenderPass(
				place,
				'compute',
				name,
				writes,
				width,
				height,
				undefined,
				undefined,
				state,
			);
			pass.fallback = true;
			return this.keep(pass);
		}
		const compiled = computeShader(options.wgsl, call);
		const { workgroup, format } = setup as NonNullable<typeof setup>;
		const template = this.templates.of(compiled, () => [
			{
				kind: 'compute',
				variants: { compute: compiled.webgpu },
				locations: [],
				textures: 0,
			},
		]);
		const counts = options.dispatch ?? 'writes';
		const place = this.core.check(
			this.core.glue.addComputePass(
				name,
				draws ? `${name} target` : writes,
				width,
				height,
				scale ?? 1,
				every ?? 1,
				template,
				draws ? 0 : FORMAT_CODE[format],
				packWorkgroup(workgroup),
				counts === 'writes' ? 0 : packWorkgroup(counts),
				options.description.frame === 'resolve' || options.description.frame === 'post' ? 1 : 0,
				buffers?.[0].buffer ?? 0,
				buffers?.[1].buffer ?? 0,
				buffers?.[1].bytes ?? 0,
			),
			call,
		);
		return this.keep(
			new RenderPass(place, 'compute', name, writes, width, height, undefined, undefined, state),
		);
	}

	/** Adds a scene pass or a reflection pass. */
	private addView(
		options: ScenePassOptions | ReflectionPassOptions,
		name: string,
		call: string,
	): RenderPass {
		const { writes } = options;
		const scene = options.kind === 'scene' ? options : undefined;
		const [width, height] = scene?.size ?? [0, 0];
		const reads = options.reads ?? [];
		if (reads.includes(writes))
			throw new EngineError(
				'E1504',
				`${call}() got the pass "${name}", which reads "${writes}", the texture it writes. A pass cannot read its own texture.`,
			);
		const clear =
			options.clearColor === undefined ? undefined : linearColor(options.clearColor, call);
		const alpha = options.clearAlpha ?? 1;
		const layers = options.layers === undefined ? undefined : options.layers >>> 0;
		const [r, g, b] = clear ?? [0, 0, 0];
		const reflection = scene ? undefined : (options as ReflectionPassOptions);
		const [nx, ny, nz] = reflection?.plane.normal ?? [0, 1, 0];
		const [px, py, pz] = reflection?.plane.point ?? [0, 0, 0];
		// A pass's share of the render size, or 0 for a reflection that takes the preset's.
		const scale = options.scale ?? (scene ? 1 : 0);
		this.shaders.need('views');
		const place = this.core.check(
			this.core.glue.addPass(
				scene ? C.PASS_KIND_SCENE : C.PASS_KIND_REFLECTION,
				name,
				writes,
				reads.join('\n'),
				width,
				height,
				clear !== undefined,
				r,
				g,
				b,
				alpha,
				scale,
				options.every ?? 1,
				layers ?? -1,
				nx,
				ny,
				nz,
				px,
				py,
				pz,
			),
			call,
		);
		const pass = new RenderPass(
			place,
			options.kind,
			name,
			writes,
			width,
			height,
			scene?.camera,
			layers,
		);
		if (scene) this.scene.setPassCamera(place, scene.camera, layers);
		return pass;
	}

	/** Adds a full-screen pass of compiled effect WGSL. */
	private addFullscreen(options: FullscreenPassOptions, name: string, call: string): RenderPass {
		const compiled = compiledPass(options.wgsl, call);
		const state: FullscreenState = {
			uniforms: new Map(compiled.uniforms.map((u) => [u.name, u])),
			values: new Float32Array(C.EFFECT_FLOATS),
			textures: new Uint32Array(C.EFFECT_TEXTURES),
		};
		const first = options.uniforms ?? {};
		for (const name in first) {
			const value = (first as Record<string, UniformValue | undefined>)[name];
			if (value !== undefined)
				writeUniform(state.values, passUniform(state, name, call), value, call);
		}
		const given = options.textures as Readonly<Record<string, Texture | undefined>> | undefined;
		writeTextures(compiled, given, state.values, state.textures, call);
		const template = effectTemplate(this.templates, compiled);
		const [width, height] = options.size ?? [0, 0];
		const source =
			options.input === 'sceneColor'
				? C.PASS_SOURCE_SCENE_COLOR
				: options.input === 'outlineMask'
					? C.PASS_SOURCE_OUTLINE_MASK
					: C.PASS_SOURCE_NONE;
		writeEffectBlocks(this.core, state.values, state.textures);
		const place = this.core.check(
			this.core.glue.addFullscreenPass(
				name,
				options.writes,
				width,
				height,
				options.scale ?? 1,
				options.every ?? 1,
				template,
				compiled.depth ? C.EFFECT_DEPTH : 0,
				source,
			),
			call,
		);
		return new RenderPass(
			place,
			'fullscreen',
			name,
			options.writes,
			width,
			height,
			undefined,
			undefined,
			state,
		);
	}

	/**
	 * Changes one uniform of a full-screen pass, from the next frame on. It allocates nothing, so a
	 * sketch can change a uniform every frame. Keep a vector's values in one array that the sketch
	 * changes in place. Throws E1220 for a pass of another kind, E1216 for a uniform that the
	 * pass's WGSL does not declare or a value of the wrong kind, and E1101 for a pass that was
	 * removed.
	 */
	setPassUniform(pass: RenderPass, name: string, value: UniformValue): void {
		const call = 'render.setPassUniform';
		checkPass(pass, call);
		const state = pass.fullscreen;
		if (pass.kind === 'compute')
			throw invalid(
				call,
				`got the compute pass "${pass.name}", whose values have no names. Change them with render.setPassUniforms().`,
			);
		if (!state)
			throw invalid(
				call,
				`got the ${pass.kind} pass "${pass.name}"; only a full-screen pass has uniforms.`,
			);
		writeUniform(state.values, passUniform(state, name, call), value, call);
		writeEffectBlocks(this.core, state.values, state.textures);
		this.core.check(this.core.glue.setPassValues(pass.place), call, undefined, true);
	}

	/**
	 * Changes the values of a compute pass, from the next frame on: up to 32 numbers, which its
	 * shader reads as eight vectors in its block. The array's first number takes the block's first
	 * value, and a number left out stays as it was. It allocates nothing, so a sketch can change
	 * the values every frame. Throws E1101 for a removed pass, E1220 for a pass of another kind,
	 * and E1220 for a value that is not a number or more than 32 of them.
	 */
	setPassUniforms(pass: RenderPass, values: readonly number[]): void {
		const call = 'render.setPassUniforms';
		checkPass(pass, call);
		const state = pass.fullscreen;
		if (pass.kind !== 'compute' || !state)
			throw invalid(
				call,
				`got the ${pass.kind} pass "${pass.name}"; only a compute pass takes values this way.`,
			);
		writeComputeValues(state.values, values, call);
		writeEffectBlocks(this.core, state.values, state.textures);
		this.core.check(
			pass.fallback
				? this.core.glue.setPassValues(pass.place)
				: this.core.glue.setComputeValues(pass.place),
			call,
			undefined,
			true,
		);
	}

	/**
	 * Switches a pass on or off, from the next frame on. A pass switched off keeps the last image
	 * it drew, so a sketch can draw a costly pass every few frames. Throws E1101 for a pass that was
	 * removed. It allocates nothing.
	 */
	setPassEnabled(pass: RenderPass, enabled: boolean): void {
		const call = 'render.setPassEnabled';
		checkPass(pass, call);
		if (pass.on === enabled) return;
		pass.on = enabled;
		this.core.check(this.core.glue.setScenePassEnabled(pass.place, enabled), call, undefined, true);
	}

	/**
	 * Removes a pass from the next frame on, and destroys the textures that `textures.fromPass`
	 * made of it. Throws E1101 for a pass that was removed, and E1502 while another pass reads its
	 * texture: remove that pass first.
	 */
	removePass(pass: RenderPass): void {
		const call = 'render.removePass';
		checkPass(pass, call);
		this.core.check(this.core.glue.removeScenePass(pass.place), call, undefined, true);
		this.scene.setPassCamera(pass.place, undefined, undefined);
		this.passes.splice(this.passes.indexOf(pass), 1);
		pass.place = 0;
		for (const texture of pass.textures.splice(0)) if (texture.live) texture.destroy();
	}

	/**
	 * The render graph as it stands, as Graphviz DOT text: every pass of the frame, the engine's
	 * and the sketch's, in the order they run, grouped into the GPU's render passes, with each
	 * texture's format, size and memory. Passes that are switched off, or that nothing reads, show
	 * dashed. Paste the text into a Graphviz viewer to see it as a picture.
	 */
	dumpGraph(): string {
		return this.core.glue.renderGraphDot();
	}

	/** @internal True once after a pass came, so the next frame waits for its pipelines. */
	takeNewPipelines(): boolean {
		const taken = this.newPipelines;
		this.newPipelines = false;
		return taken;
	}
}

/** Throws E1220 for a value that is not a pass, and E1101 for a pass that was removed. */
export function checkPass(pass: RenderPass, call: string): void {
	if (!(pass instanceof RenderPass))
		throw invalid(call, `got ${String(pass)}, which is not a render pass.`);
	if (!pass.live)
		throw new EngineError(
			'E1101',
			`${call}() got the pass "${pass.name}", which render.removePass() removed.`,
		);
}

/** Throws E1220 for options of `render.addPass` that it does not take. */
function checkOptions(options: RenderPassOptions, call: string, maxSize: number): void {
	if (typeof options !== 'object' || options === null)
		throw invalid(call, `got ${String(options)}, which is not an object of options.`);
	const { kind } = options;
	if (kind !== 'scene' && kind !== 'reflection' && kind !== 'fullscreen' && kind !== 'compute')
		throw invalid(
			call,
			`got the kind ${JSON.stringify(kind)}; it takes 'scene', 'reflection', 'fullscreen' or 'compute'.`,
		);
	// The options of every pass, then those of its kind. Only development builds run the checks,
	// so release builds leave the lists out.
	const takes = new Set(['kind', 'writes', 'name', 'every']);
	const own =
		kind === 'scene'
			? ['camera', 'size', 'scale', 'layers', 'reads', 'clearColor', 'clearAlpha']
			: kind === 'reflection'
				? ['plane', 'scale', 'layers', 'reads', 'clearColor', 'clearAlpha']
				: kind === 'compute'
					? [
							'description',
							'wgsl',
							'format',
							'workgroupSize',
							'dispatch',
							'size',
							'scale',
							'textures',
							'values',
							'fallback',
							'buffers',
						]
					: ['wgsl', 'size', 'scale', 'input', 'textures', 'uniforms'];
	for (const key of own) takes.add(key);
	for (const key of Object.keys(options))
		if (!takes.has(key))
			throw invalid(
				call,
				`got the option "${key}", which a ${kind} pass does not take. It takes ${[...takes].join(', ')}.`,
			);
	if (kind === 'compute') {
		if (options.buffers === undefined) checkComputeTarget(options, call);
		checkCompute(options, call);
		checkSize(options.size, options.scale, call, maxSize);
		const { name, every } = options;
		if (name !== undefined && !(typeof name === 'string' && name.length > 0))
			throw invalid(
				call,
				`got the name ${JSON.stringify(name)}; it takes a string with at least one character.`,
			);
		if (every !== undefined && !(Number.isInteger(every) && every >= 1))
			throw invalid(call, `got every ${String(every)}; it takes a whole number from 1.`);
		return;
	}
	const { writes, name, every } = options;
	const named = (text: unknown) => typeof text === 'string' && text.length > 0;
	if (!named(writes))
		throw invalid(
			call,
			`got writes ${JSON.stringify(writes)}; it takes the name of the pass's texture.`,
		);
	if (name !== undefined && !named(name))
		throw invalid(
			call,
			`got the name ${JSON.stringify(name)}; it takes a string with at least one character.`,
		);
	if (every !== undefined && !(Number.isInteger(every) && every >= 1))
		throw invalid(call, `got every ${String(every)}; it takes a whole number from 1.`);
	if (kind === 'fullscreen') {
		checkFullscreen(options, call, maxSize);
		return;
	}
	if (kind === 'scene') checkScene(options, call, maxSize);
	else checkReflection(options, call);
	const { layers, reads, clearAlpha } = options;
	if (layers !== undefined) checkLayers(call, layers);
	if (
		reads !== undefined &&
		!(Array.isArray(reads) && reads.every((read) => named(read) && !read.includes('\n')))
	)
		throw invalid(call, `got reads ${JSON.stringify(reads)}; they take an array of texture names.`);
	if (
		clearAlpha !== undefined &&
		!(Number.isFinite(clearAlpha) && clearAlpha >= 0 && clearAlpha <= 1)
	)
		throw invalid(
			call,
			`got the clear alpha ${String(clearAlpha)}; it takes a number from 0 to 1.`,
		);
}

/**
 * Throws E1220 for a size or a scale that `render.addPass` does not take: a size of whole pixels
 * from 1 to `maxSize`, or a share of 1, 0.5 or 0.25, not both.
 */
function checkSize(size: unknown, scale: unknown, call: string, maxSize: number): void {
	if (size !== undefined && scale !== undefined)
		throw invalid(call, 'got both a size and a scale; give the pass one of them.');
	checkScale(scale, call);
	if (size === undefined) return;
	const side = (value: unknown) =>
		typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maxSize;
	if (!Array.isArray(size) || size.length !== 2 || !side(size[0]) || !side(size[1]))
		throw invalid(
			call,
			`got the size ${JSON.stringify(size)}; it takes [width, height] in whole pixels from 1 to ${maxSize}.`,
		);
}

/** Throws E1220 for a scene pass's camera, size or scale that `render.addPass` does not take. */
function checkScene(options: ScenePassOptions, call: string, maxSize: number): void {
	const { camera, size, scale } = options;
	if (typeof camera?.sendLens !== 'function')
		throw invalid(call, 'got no camera. Give the camera that the pass draws from.');
	checkLive(call, camera, true);
	if (size === undefined && scale === undefined)
		throw invalid(
			call,
			'got neither a size nor a scale. Give the size of the texture in pixels, or its share of the render size.',
		);
	checkSize(size, scale, call, maxSize);
}

/** Throws E1220 for a full-screen pass's size, scale or input that `render.addPass` does not take. */
function checkFullscreen(options: FullscreenPassOptions, call: string, maxSize: number): void {
	const { size, scale, input } = options;
	checkSize(size, scale, call, maxSize);
	if (input !== undefined && input !== 'sceneColor' && input !== 'outlineMask')
		throw invalid(
			call,
			`got the input ${JSON.stringify(input)}; it takes 'sceneColor' or 'outlineMask'.`,
		);
}

/** Throws E1220 for a reflection's plane, scale or pace that `render.addPass` does not take. */
function checkReflection(options: ReflectionPassOptions, call: string): void {
	const { plane, scale } = options;
	const vector = (value: unknown) =>
		Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
	if (typeof plane !== 'object' || plane === null || !vector(plane.point))
		throw invalid(
			call,
			`got the plane ${JSON.stringify(plane)}; it takes { point: [x, y, z] }, with a normal too when the plane does not face up.`,
		);
	const { normal } = plane;
	if (normal !== undefined && !(vector(normal) && normal.some((v) => v !== 0)))
		throw invalid(
			call,
			`got the plane's normal ${JSON.stringify(normal)}; it takes [x, y, z] with a length above 0, toward the side that the reflection shows.`,
		);
	checkScale(scale, call);
}

/** Throws E1220 for a share of the render size other than 1, 0.5 or 0.25. */
function checkScale(scale: unknown, call: string): void {
	if (scale !== undefined && scale !== 1 && scale !== 0.5 && scale !== 0.25)
		throw invalid(call, `got the scale ${String(scale)}; it takes 1, 0.5 or 0.25.`);
}

/** The uniform `name` of a full-screen pass, or throws E1216. */
function passUniform(state: FullscreenState, name: string, call: string): PassUniform {
	const uniform = state.uniforms.get(name);
	if (uniform) return uniform;
	const names = [...state.uniforms.keys()].join(', ') || 'none';
	throw new EngineError(
		'E1216',
		`${call}() got ${name}, which is not a uniform of the pass's WGSL. Its uniforms: ${names}.`,
	);
}

/**
 * A full-screen pass's compiled WGSL, or throws E1215 for WGSL that the plugin did not compile as
 * an effect.
 */
function compiledPass(wgsl: unknown, call: string): CompiledEffect {
	if (typeof wgsl === 'object' && wgsl !== null && (wgsl as CompiledWgsl).kind === 'effect')
		return wgsl as CompiledEffect;
	throw new EngineError(
		'E1215',
		typeof wgsl === 'string'
			? `${call}() got WGSL as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.`
			: `${call}() got WGSL that is not an effect's. A full-screen pass's WGSL declares fn effect(input: EffectInput) -> vec4f.`,
	);
}

/** The draw list's format code of each format that a compute pass writes. */
const FORMAT_CODE: Readonly<Record<ComputeFormat, number>> = {
	rgba16float: FORMAT_RGBA16_FLOAT,
	r32float: FORMAT_R32_FLOAT,
	rgba8unorm: FORMAT_RGBA8_UNORM,
};

/** The most invocations in a workgroup, and the most along each axis. Every device allows them. */
const INVOCATIONS = 128;
const XY = 128;
const Z = 64;
/** The most workgroups along one axis of a dispatch. */
const WORKGROUPS = 65_535;

/** The whole shader that a compiled compute pass holds. */
interface CompiledCompute extends CompiledWgsl {
	readonly kind: 'shader';
	readonly webgpu: ShaderVariants[string];
	readonly webgl2: ShaderVariants[string] | null;
	readonly hot?: string;
}

/**
 * The name of the texture that a compute pass writes: the one output of its feature description.
 * Throws E1223 for a description of another kind, with no frame point, with another view, with
 * scene resource reads, or with anything but one output whose default a fresh texture can hold.
 */
function checkComputeTarget(options: ComputePassOptions, call: string): string {
	const { description } = options;
	if (description.kind !== 'compute')
		throw refuse(
			call,
			`got the feature "${description.name}" with the kind ${JSON.stringify(description.kind)}; a compute pass takes a description with the kind 'compute'.`,
		);
	if (description.frame === undefined)
		throw refuse(
			call,
			`got the feature "${description.name}" with no frame; a compute pass records at a frame point.`,
		);
	const views = description.views ?? ['main'];
	if (views.length !== 1 || views[0] !== 'main')
		throw refuse(
			call,
			`got the feature "${description.name}" with the views ${JSON.stringify(views)}; a compute pass records in the main view alone, because the adapter places no other view yet.`,
		);
	if (description.reads !== undefined && description.reads.length > 0)
		throw refuse(
			call,
			`got the feature "${description.name}" reading ${JSON.stringify(description.reads)}; a compute pass reads the textures of its textures option. A scene resource needs a binding that this adapter does not add yet.`,
		);
	const outputs = Object.keys(description.outputs ?? {});
	if (outputs.length !== 1)
		throw refuse(
			call,
			`got the feature "${description.name}" with ${outputs.length} outputs; a compute pass publishes one output, which names its texture.`,
		);
	const writes = outputs[0] as string;
	// Every texture starts at zero, so a pass that never ran reads zeros: black or transparent, as
	// those defaults say. A white output would need its texture filled first.
	const neutral = description.outputs?.[writes]?.default ?? 'black';
	if (neutral === 'white')
		throw refuse(
			call,
			`got the feature "${description.name}" with the output "${writes}" of the default "white"; a compute pass publishes "black" or "transparent", whose zeros a texture holds before the pass first runs.`,
		);
	return writes;
}

/**
 * Checks a compute pass that fills the two buffers of one instance draw: its description publishes
 * no texture and records at a frame point in the main view, its handles are the draw's, and it
 * gives its workgroup counts. Throws E1223 for a description that it cannot place and E1220 for an
 * option that it cannot take.
 */
function checkComputeBuffers(options: ComputePassOptions, call: string): void {
	const { description, buffers } = options;
	if (description.kind !== 'compute')
		throw refuse(
			call,
			`got the feature "${description.name}" with the kind ${JSON.stringify(description.kind)}; a compute pass takes a description with the kind 'compute'.`,
		);
	if (description.frame === undefined)
		throw refuse(
			call,
			`got the feature "${description.name}" with no frame; a compute pass records at a frame point.`,
		);
	const views = description.views ?? ['main'];
	if (views.length !== 1 || views[0] !== 'main')
		throw refuse(
			call,
			`got the feature "${description.name}" with the views ${JSON.stringify(views)}; a compute pass records in the main view alone.`,
		);
	if (description.reads !== undefined && description.reads.length > 0)
		throw refuse(
			call,
			`got the feature "${description.name}" reading ${JSON.stringify(description.reads)}; a compute pass that fills buffers reads no scene resource yet.`,
		);
	if (Object.keys(description.outputs ?? {}).length !== 0)
		throw refuse(
			call,
			`got the feature "${description.name}" publishing an output; a compute pass that fills an instance draw has no texture to publish.`,
		);
	const handles = buffers as readonly (FeatureInstanceBuffer | undefined)[] | undefined;
	if (!Array.isArray(handles) || handles.length !== 2)
		throw invalid(call, 'got buffers that are not the two of one instance draw.');
	for (const handle of handles)
		if (
			typeof handle?.buffer !== 'number' ||
			!Number.isInteger(handle.buffer) ||
			handle.buffer < 1 ||
			typeof handle.bytes !== 'number' ||
			!Number.isInteger(handle.bytes) ||
			handle.bytes < 1
		)
			throw invalid(
				call,
				'got a buffer that the engine did not make; give the count and instance handles of an instance draw.',
			);
	if (handles[0]?.buffer === handles[1]?.buffer)
		throw invalid(
			call,
			'got the same buffer twice; give the count word and the per-instance buffer.',
		);
	for (const [name, value] of [
		['format', options.format],
		['size', options.size],
		['scale', options.scale],
	] as const)
		if (value !== undefined)
			throw invalid(
				call,
				`got a ${name} with buffers; a pass that fills an instance draw has no texture, and the draw fixes their sizes and formats.`,
			);
	if (options.fallback !== undefined)
		throw invalid(
			call,
			'got a fallback with buffers; a pass that fills an instance draw cannot run as a fragment pass.',
		);
	if (options.dispatch === undefined || options.dispatch === 'writes')
		throw invalid(
			call,
			`got the dispatch ${JSON.stringify(options.dispatch ?? 'writes')}; a pass that fills buffers gives its workgroup counts.`,
		);
}

/** The compiled WGSL of a compute pass, or throws E1215 for WGSL that is not a compute shader. */
function computeShader(wgsl: unknown, call: string): CompiledCompute {
	const compiled = wgsl as CompiledCompute | undefined;
	const source = compiled?.webgpu?.wgsl?.source;
	if (compiled?.kind === 'shader' && typeof source === 'string' && /@\s*compute\b/u.test(source))
		return compiled;
	throw new EngineError(
		'E1215',
		typeof wgsl === 'string'
			? `${call}() got WGSL as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.`
			: `${call}() got WGSL that is not a compute shader. Its WGSL declares a @compute entry point.`,
	);
}

/** The `@workgroup_size` that a shader declares, or undefined when it declares none. */
function declaredWorkgroup(source: string): ComputeWorkgroup | undefined {
	const match = /@\s*workgroup_size\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?(?:,\s*(\d+)\s*)?\)/u.exec(
		source,
	);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2] ?? 1), Number(match[3] ?? 1)];
}

/** E1220 for a workgroup size that a device the engine supports cannot run. */
function checkWorkgroup(size: readonly number[], call: string): void {
	const values = (size[0] as number) * (size[1] as number) * (size[2] as number);
	const whole = size.every((n) => Number.isInteger(n) && n >= 1);
	if (!whole || (size[0] as number) > XY || (size[1] as number) > XY || (size[2] as number) > Z)
		throw invalid(
			call,
			`got the workgroup size [${size.join(', ')}]; x and y take a whole number from 1 to ${XY} and z one from 1 to ${Z}.`,
		);
	if (values > INVOCATIONS)
		throw invalid(
			call,
			`got the workgroup size [${size.join(', ')}], which holds ${values} invocations; a workgroup holds at most ${INVOCATIONS}.`,
		);
}

/**
 * Checks a compute pass's options and returns the workgroup size and the target's format that the
 * renderer uses. Throws E1220 for an option that a compute pass cannot take, and E1215 for WGSL
 * that is not a compiled compute shader.
 */
function checkCompute(
	options: ComputePassOptions,
	call: string,
): { readonly workgroup: ComputeWorkgroup; readonly format: ComputeFormat } {
	const { dispatch, format = 'rgba16float' } = options;
	if (!(format in FORMAT_CODE))
		throw invalid(
			call,
			`got the format ${JSON.stringify(format)}; a compute pass writes ${Object.keys(FORMAT_CODE).join(', ')}.`,
		);
	const source = computeShader(options.wgsl, call).webgpu?.wgsl?.source as string;
	const declared = declaredWorkgroup(source);
	const workgroup = options.workgroupSize ?? declared;
	if (!workgroup)
		throw invalid(
			call,
			'got WGSL with no @workgroup_size and no workgroupSize option; give one of them.',
		);
	checkWorkgroup(workgroup, call);
	if (declared?.some((n, axis) => n !== workgroup[axis]))
		throw invalid(
			call,
			`got the workgroup size [${workgroup.join(', ')}], and the shader declares [${declared.join(', ')}]. Give the size that the shader declares.`,
		);
	if (dispatch !== undefined && dispatch !== 'writes')
		for (const count of dispatch)
			if (!Number.isInteger(count) || count < 1 || count > WORKGROUPS)
				throw invalid(
					call,
					`got the dispatch [${dispatch.join(', ')}]; each axis takes a whole number from 1 to ${WORKGROUPS}.`,
				);
	return { workgroup, format };
}

/** Packs three workgroup numbers, one to a byte, for the core's dispatch call. */
function packWorkgroup([x, y, z]: readonly number[]): number {
	return (x as number) | ((y as number) << 8) | ((z as number) << 16);
}

/** Writes a compute pass's values into its block, or throws E1220 for a value it cannot take. */
function writeComputeValues(
	values: Float32Array,
	given: readonly number[] | undefined,
	call: string,
): void {
	if (given === undefined) return;
	if (!Array.isArray(given) || given.length > C.EFFECT_FLOATS)
		throw invalid(
			call,
			`got ${String((given as readonly unknown[]).length)} values; a compute pass holds at most ${C.EFFECT_FLOATS}.`,
		);
	for (let k = 0; k < given.length; k++) {
		const value = given[k] as number;
		if (typeof value !== 'number' || !Number.isFinite(value))
			throw invalid(call, `got the value ${String(value)} at ${k}; values are finite numbers.`);
		values[k] = value;
	}
}

/**
 * Writes the handles of a compute pass's textures into its slots, in the order the array gives
 * them, or throws E1220 for an entry that is not a texture or for more textures than the engine
 * binds.
 */
function writeComputeTextures(
	handles: Uint32Array,
	given: readonly (Texture | undefined)[] | undefined,
	call: string,
): void {
	if (given === undefined) return;
	if (!Array.isArray(given) || given.length > C.EFFECT_TEXTURES)
		throw invalid(
			call,
			`got ${String((given as readonly unknown[]).length)} textures; a compute pass samples at most ${C.EFFECT_TEXTURES}.`,
		);
	for (let slot = 0; slot < given.length; slot++) {
		const texture = given[slot];
		if (texture === undefined) continue;
		if (typeof texture !== 'object' || texture === null || typeof texture.handle !== 'number')
			throw invalid(call, `got ${String(texture)} at ${slot}; a texture goes there.`);
		handles[slot] = texture.handle;
	}
}
