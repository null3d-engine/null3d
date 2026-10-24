// The outline of three.js's OutlinePass for null3D sketches, built from the core's outline mask
// and the engine's full-screen passes and custom effects. A pass finds the mask's edge at half the
// render size, two gaussian blurs soften it at the radius that the caller gives, two wider ones at
// a quarter of the render size make the glow, and an effect adds both to the scene's color.
//
// The core draws the mask for the meshes that `setOutlined(true)` marks, and this module sets the
// outline's width to 0, so no crisp line draws over the soft edge. The mask's red channel holds
// each outlined object's coverage, and its green channel holds the parts that nothing hides.
import type { ColorInput, Effect, RenderPass, SketchContext } from '@null3d/engine';
import blurShader from './outline-blur.wgsl';
import compositeShader from './outline-composite.wgsl';
import edgeShader from './outline-edge.wgsl';

/**
 * The settings of an outline, with three.js's `OutlinePass` names and defaults. A setting that a
 * call leaves out keeps its value.
 *
 * @category api/three-compat
 */
export interface OutlinePassOptions {
	/**
	 * The color of the edge around the parts that nothing hides, as `visibleEdgeColor` is. A hex
	 * string is sRGB; an array of three numbers is linear. It is white by default.
	 */
	color?: ColorInput;
	/**
	 * The color of the edge around the parts that other objects hide, as `hiddenEdgeColor` is. It
	 * is `[0.1, 0.04, 0.02]` in linear color by default, which is three.js's dark brown.
	 */
	hiddenColor?: ColorInput;
	/**
	 * The edge's brightness, as `edgeStrength` is: 0 or more, and 3 by default.
	 */
	strength?: number;
	/**
	 * The gaussian blur's radius at half the render size, as `edgeThickness` is: above 0, and 1 by
	 * default. A wider radius softens the edge over more pixels.
	 */
	thickness?: number;
	/**
	 * How much of the wider, quarter-size blur joins the edge, as `edgeGlow` is: 0 or more, and 0 by
	 * default. A glow is a soft halo that spreads past the edge.
	 */
	glow?: number;
	/**
	 * The seconds that the pulse takes to rise and fall, as `pulsePeriod` is, or 0 for none, which
	 * is the default. The pulse fades the edge to a quarter of its strength and back.
	 */
	pulsePeriod?: number;
}

/**
 * An outline that `createOutlinePass` made. A call to `set` changes its settings from the next
 * frame on.
 *
 * @category api/three-compat
 */
export interface OutlinePass {
	/**
	 * Changes the settings from the next frame on. It throws for a number outside its range, and
	 * throws for a color that the engine does not take.
	 */
	set(options: OutlinePassOptions): void;
}

/** The settings that an outline keeps: each option with its value. */
interface Settings {
	color: ColorInput;
	hiddenColor: ColorInput;
	strength: number;
	thickness: number;
	glow: number;
	pulsePeriod: number;
}

/** Three.js's `OutlinePass` defaults, which three.js's own constructor gives. */
const DEFAULTS: Settings = {
	color: [1, 1, 1],
	hiddenColor: [0.1, 0.04, 0.02],
	strength: 3,
	thickness: 1,
	glow: 0,
	pulsePeriod: 0,
};

/** The radius of the wider blur, in texels of the quarter-size pass, as three.js's `MAX_EDGE_GLOW`. */
const MAX_EDGE_GLOW = 4;

/** How many outlines the page made, which names each pass's texture apart. */
let made = 0;

/** Throws for a number that is not finite, or is below `least`, with the call and the range. */
function checkAtLeast(call: string, name: string, value: number, least: number): void {
	if (!Number.isFinite(value) || value < least)
		throw new Error(
			`${call}() got ${value} for ${name}, which takes a number of at least ${least}.`,
		);
}

/** Throws for a number that is not finite, or is not above `least`, with the call and the range. */
function checkAbove(call: string, name: string, value: number, least: number): void {
	if (!Number.isFinite(value) || value <= least)
		throw new Error(`${call}() got ${value} for ${name}, which takes a number above ${least}.`);
}

/**
 * Checks each option, and gives the settings that `base` and the options that `call` gave make. A
 * setting that the call leaves out keeps the value in `base`.
 */
function merge(base: Settings, options: OutlinePassOptions, call: string): Settings {
	const next: Settings = { ...base };
	if (options.color !== undefined) next.color = options.color;
	if (options.hiddenColor !== undefined) next.hiddenColor = options.hiddenColor;
	if (options.strength !== undefined) next.strength = options.strength;
	if (options.thickness !== undefined) next.thickness = options.thickness;
	if (options.glow !== undefined) next.glow = options.glow;
	if (options.pulsePeriod !== undefined) next.pulsePeriod = options.pulsePeriod;
	checkAtLeast(call, 'strength', next.strength, 0);
	checkAbove(call, 'thickness', next.thickness, 0);
	checkAtLeast(call, 'glow', next.glow, 0);
	checkAtLeast(call, 'pulsePeriod', next.pulsePeriod, 0);
	return next;
}

/** Writes the settings that the passes and the effect read, from `settings`. */
function apply(
	ctx: SketchContext,
	parts: { edge: RenderPass; blurX: RenderPass; blurY: RenderPass; effect: Effect },
	settings: Settings,
	previous: Settings,
): void {
	if (settings.color !== previous.color)
		ctx.render.setPassUniform(parts.edge, 'visibleColor', settings.color);
	if (settings.hiddenColor !== previous.hiddenColor)
		ctx.render.setPassUniform(parts.edge, 'hiddenColor', settings.hiddenColor);
	if (settings.thickness !== previous.thickness) {
		ctx.render.setPassUniform(parts.blurX, 'kernelRadius', settings.thickness);
		ctx.render.setPassUniform(parts.blurY, 'kernelRadius', settings.thickness);
	}
	if (
		settings.strength !== previous.strength ||
		settings.glow !== previous.glow ||
		settings.pulsePeriod !== previous.pulsePeriod
	) {
		ctx.post.setEffectUniform(parts.effect, 'settings', [
			settings.strength,
			settings.glow,
			settings.pulsePeriod,
			0,
		]);
	}
}

/**
 * Draws an outline with three.js's `OutlinePass` look: a soft edge around the meshes that
 * `mesh.setOutlined(true)` marks, its glow, and its pulse. Settings turn it on, and the core draws
 * the mask that it reads.
 *
 * The edge is soft, and the core's crisp line is off. A scene that also wants the crisp line sets
 * `post.set({ outline: { width } })` after this call.
 *
 * @category api/three-compat
 */
export function createOutlinePass(
	ctx: SketchContext,
	options: OutlinePassOptions = {},
): OutlinePass {
	const settings = merge(DEFAULTS, options, 'createOutlinePass');
	const name = `three-compat-outline-${++made}`;
	const { render, post, textures } = ctx;
	// The mask draws while the core's outline is on, and a width of 0 keeps its crisp line off.
	post.set({ outline: { width: 0 } });
	const edge = render.addPass({
		kind: 'fullscreen',
		wgsl: edgeShader,
		writes: `${name}-edge`,
		scale: 0.5,
		input: 'outlineMask',
		uniforms: { visibleColor: settings.color, hiddenColor: settings.hiddenColor },
	});
	// The graph runs a full-screen pass that names no input image before the scene, and the edge
	// and the mask draw after it. So each blur names the scene's color as its input, which places
	// it after the camera's passes, and reads its own texture through the textures option.
	const blurX = render.addPass({
		kind: 'fullscreen',
		wgsl: blurShader,
		writes: `${name}-edge-x`,
		scale: 0.5,
		input: 'sceneColor',
		uniforms: { direction: [1, 0], kernelRadius: settings.thickness },
		textures: { source: textures.fromPass(edge) },
	});
	const blurY = render.addPass({
		kind: 'fullscreen',
		wgsl: blurShader,
		writes: `${name}-edge-y`,
		scale: 0.5,
		input: 'sceneColor',
		uniforms: { direction: [0, 1], kernelRadius: settings.thickness },
		textures: { source: textures.fromPass(blurX) },
	});
	const glowX = render.addPass({
		kind: 'fullscreen',
		wgsl: blurShader,
		writes: `${name}-glow-x`,
		scale: 0.25,
		input: 'sceneColor',
		uniforms: { direction: [1, 0], kernelRadius: MAX_EDGE_GLOW },
		textures: { source: textures.fromPass(blurY) },
	});
	const glowY = render.addPass({
		kind: 'fullscreen',
		wgsl: blurShader,
		writes: `${name}-glow-y`,
		scale: 0.25,
		input: 'sceneColor',
		uniforms: { direction: [0, 1], kernelRadius: MAX_EDGE_GLOW },
		textures: { source: textures.fromPass(glowX) },
	});
	const effect = post.addEffect({
		wgsl: compositeShader,
		uniforms: {
			settings: [settings.strength, settings.glow, settings.pulsePeriod, 0],
		},
		textures: {
			edges: textures.fromPass(blurY),
			halo: textures.fromPass(glowY),
		},
	});
	const parts = { edge, blurX, blurY, effect };
	return {
		set(changed: OutlinePassOptions): void {
			const next = merge(settings, changed, 'OutlinePass.set');
			apply(ctx, parts, next, settings);
			Object.assign(settings, next);
		},
	};
}
