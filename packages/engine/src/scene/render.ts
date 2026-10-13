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
import { type ColorInput, linearColor } from './color';
import {
	type CompiledEffect,
	effectTemplate,
	writeEffectBlocks,
	writeTextures,
	writeUniform,
} from './effects';
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
 * Options of `render.addPass`.
 *
 * @category api/render
 */
export type RenderPassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> =
	| ScenePassOptions
	| ReflectionPassOptions
	| FullscreenPassOptions<Wgsl>;

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
	/** @internal The textures that `textures.fromPass` made of it, which its removal destroys. */
	readonly textures: { readonly live: boolean; destroy(): void }[] = [];

	/** @internal */
	constructor(
		place: number,
		/** The kind of pass. */
		readonly kind: 'scene' | 'reflection' | 'fullscreen',
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
		/** @internal A full-screen pass's uniforms, values and textures. */
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
	) {}

	/**
	 * Adds a pass to the render graph, from the next frame on, and returns it. A scene pass draws
	 * the scene from a camera into a texture of its own, which `textures.fromPass` gives to
	 * materials. A reflection pass draws the camera's view mirrored across a plane, with the
	 * scene's background, and clips everything below the plane. A full-screen pass runs WGSL
	 * written as a custom effect's over its whole texture, which materials and effects read. A
	 * pass runs only while something shows or reads its texture.
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
		const { writes } = options;
		const name = options.name ?? writes;
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
		const pass =
			options.kind === 'fullscreen'
				? this.addFullscreen(options as unknown as FullscreenPassOptions, name, call)
				: this.addView(options, name, call);
		this.passes.push(pass);
		this.newPipelines = true;
		return pass;
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
	if (kind !== 'scene' && kind !== 'reflection' && kind !== 'fullscreen')
		throw invalid(
			call,
			`got the kind ${JSON.stringify(kind)}; it takes 'scene', 'reflection' or 'fullscreen'.`,
		);
	// The options of every pass, then those of its kind. Only development builds run the checks,
	// so release builds leave the lists out.
	const takes = new Set(['kind', 'writes', 'name', 'every']);
	const own =
		kind === 'scene'
			? ['camera', 'size', 'scale', 'layers', 'reads', 'clearColor', 'clearAlpha']
			: kind === 'reflection'
				? ['plane', 'scale', 'layers', 'reads', 'clearColor', 'clearAlpha']
				: ['wgsl', 'size', 'scale', 'input', 'textures', 'uniforms'];
	for (const key of own) takes.add(key);
	for (const key of Object.keys(options))
		if (!takes.has(key))
			throw invalid(
				call,
				`got the option "${key}", which a ${kind} pass does not take. It takes ${[...takes].join(', ')}.`,
			);
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
