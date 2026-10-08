// The sketch's own render passes, which `ctx.render` adds to the engine's render graph. A scene
// pass draws the scene from a camera of the sketch into a texture of its own size, which
// `textures.fromPass` gives to materials and sprites, as a minimap or a security camera's screen
// shows it. The engine core checks each change against the whole graph at once, so a pass that
// reads a missing target, makes one twice or closes a loop throws its error code from the call.

import { checkLayers, checkLive, DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import type { Camera, Scene } from './scene';
import type { ShaderPreloads } from './shader-preloads';

/**
 * The size of a pass's texture in pixels, as `[width, height]`: whole numbers from 1 to the
 * device's largest texture.
 *
 * @category api/render
 */
export type RenderPassSize = readonly [width: number, height: number];

/**
 * Options of `render.addPass` for a scene pass, which draws the scene from a camera into a texture
 * of its own size. `textures.fromPass` gives the texture to materials and sprites.
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
	/** The texture's size in pixels. */
	readonly size: RenderPassSize;
	/** The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. */
	readonly name?: string;
	/**
	 * The layers of the objects the pass draws, as a 32-bit mask. It is the camera's layers by
	 * default, and follows them when they change.
	 */
	readonly layers?: number;
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
 * Options of `render.addPass`.
 *
 * @category api/render
 */
export type RenderPassOptions = ScenePassOptions;

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
		readonly kind: 'scene',
		/** The pass's name in the render graph. */
		readonly name: string,
		/** The name of the texture it draws into. */
		readonly writes: string,
		/** The texture's width in pixels. */
		readonly width: number,
		/** The texture's height in pixels. */
		readonly height: number,
		/** @internal The camera it draws from. */
		readonly camera: Camera,
		/** @internal Its own layers, or undefined to follow the camera's. */
		readonly layers: number | undefined,
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

/** The options that a scene pass takes, for the error that lists them. */
const SCENE_OPTIONS = new Set([
	'kind',
	'camera',
	'writes',
	'size',
	'name',
	'layers',
	'reads',
	'clearColor',
	'clearAlpha',
]);

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
		/** The widest and tallest texture of the device. */
		private readonly maxSize: number,
	) {}

	/**
	 * Adds a pass to the render graph, from the next frame on, and returns it. A scene pass draws
	 * the scene from a camera into a texture of its own, which `textures.fromPass` gives to
	 * materials. It runs only while something shows its texture.
	 *
	 * A scene pass draws the sun, its shadows where the main camera's cascades reach, the ambient
	 * light, the point and spot lights that its camera sees, the environment's light and fog. A
	 * point or spot light casts its shadow in the pass where the main camera's view gives it a
	 * shadow. A light that only the pass sees casts none there. A pass does not draw ambient
	 * occlusion or the sky background yet.
	 *
	 * Throws E1220 for options it does not take, a name that a live pass writes already, or the
	 * 32nd live pass. Throws the render graph's code when the pass does not fit the graph: E1502
	 * for a texture in `reads` that no pass writes, E1503 for a name that the engine's own passes
	 * write, and E1505 for targets that one render pass cannot hold.
	 */
	addPass(options: RenderPassOptions): RenderPass {
		const call = 'render.addPass';
		if (DEV) checkOptions(options, call, this.maxSize);
		const { camera, writes } = options;
		const [width, height] = options.size;
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
				`got pass ${this.passes.length + 1}, and at most ${C.SCENE_PASS_MAX} scene passes draw at once. Remove a pass first.`,
			);
		const reads = options.reads ?? [];
		if (reads.includes(writes))
			throw new EngineError(
				'E1504',
				`${call}() got the pass "${name}", which reads "${writes}", the texture it writes. A pass cannot read its own texture.`,
			);
		const clear =
			options.clearColor === undefined ? undefined : linearColor(options.clearColor, call);
		const alpha = options.clearAlpha ?? 1;
		this.shaders.need('views');
		const place = this.core.check(
			this.core.glue.addScenePass(
				name,
				writes,
				reads.join('\n'),
				width,
				height,
				clear !== undefined,
				clear?.[0] ?? 0,
				clear?.[1] ?? 0,
				clear?.[2] ?? 0,
				alpha,
			),
			call,
		);
		const pass = new RenderPass(
			place,
			'scene',
			name,
			writes,
			width,
			height,
			camera,
			options.layers === undefined ? undefined : options.layers >>> 0,
		);
		this.passes.push(pass);
		this.scene.setPassCamera(place, camera, pass.layers);
		this.newPipelines = true;
		return pass;
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
	if (options.kind !== 'scene')
		throw invalid(call, `got the kind ${JSON.stringify(options.kind)}; it takes 'scene'.`);
	for (const key of Object.keys(options))
		if (!SCENE_OPTIONS.has(key))
			throw invalid(
				call,
				`got the option "${key}", which a scene pass does not take. It takes ${[...SCENE_OPTIONS].join(', ')}.`,
			);
	const { camera, writes, size, name, layers, reads, clearAlpha } = options;
	if (typeof camera?.sendLens !== 'function')
		throw invalid(call, 'got no camera. Give the camera that the pass draws from.');
	checkLive(call, camera, true);
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
	const side = (value: unknown) =>
		typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maxSize;
	if (!Array.isArray(size) || size.length !== 2 || !side(size[0]) || !side(size[1]))
		throw invalid(
			call,
			`got the size ${JSON.stringify(size)}; it takes [width, height] in whole pixels from 1 to ${maxSize}.`,
		);
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
