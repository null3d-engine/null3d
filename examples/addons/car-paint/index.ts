// Car paint: a metallic base under the engine's clear coat, with metal flakes, panel seams and an
// optional carbon weave. The paint is a custom material whose surface function changes the base
// normal and roughness, so the engine's own lighting, clear coat and stretched lobe give the look.
// The flakes never shimmer: a cell that shrinks below a pixel fades to the smooth normal, and the
// roughness widens to the flakes' spread, so a distant car draws as smooth metal.
import type { ColorInput, Material, SketchContext } from '@null3d/engine';
import paintShader from './paint.wgsl';

/** The metal flakes of the paint. */
export interface PaintFlakes {
	/**
	 * How many flakes cross each texture coordinate. The paint's first coordinate runs along the
	 * surface and the second around or up it, so a long panel needs more cells along the first.
	 * The default is `[120, 210]`.
	 */
	cells?: readonly [number, number];
	/**
	 * How far a flake tilts the base normal, from 0 for none to about 0.5 for a rough glitter. The
	 * default is 0.25.
	 */
	tilt?: number;
	/**
	 * How much the flakes' spread widens the roughness once a cell shrinks below a pixel. It keeps
	 * a distant surface as bright as a near one. The default is 0.18.
	 */
	spread?: number;
}

/** The panel seams: grooves in the paint whose coat catches an edge of light. */
export interface PaintSeams {
	/**
	 * The distance between the seams along each texture coordinate, in that coordinate. A value of
	 * 0 draws no seam along that coordinate. The default is `[0.34, 0]`.
	 */
	spacing?: readonly [number, number];
	/**
	 * The groove's half width in the texture coordinates, such as 0.0022 for a fine gap. The
	 * default is 0.0022.
	 */
	width?: number;
	/** How dark the groove draws, from 0 for none to 1 for black. The default is 0.85. */
	shade?: number;
}

/** The optional carbon weave over the paint. */
export interface PaintWeave {
	/**
	 * How many weave cells cross each texture coordinate. Fewer cells draw a coarser weave. The
	 * default is `[90, 150]`.
	 */
	cells?: readonly [number, number];
	/**
	 * How strongly a tow's rounded cross-section shapes its highlight, from 0 for a flat tow to 1.
	 * The highlight then runs along the tow, so the two directions of the twill shine their own
	 * way. The default is 0.85.
	 */
	shine?: number;
}

/** The look of one car paint. A part that a call leaves out keeps its default. */
export interface CarPaintLook {
	/** The paint's base color, in sRGB. The default is a candy red. */
	color?: ColorInput;
	/** How metallic the base is, from 0 to 1. The default is 0.72. */
	metalness?: number;
	/** The base's perceptual roughness, from 0 to 1. The default is 0.34. */
	roughness?: number;
	/** How much clear coat covers the paint, from 0 to 1. The default is 1. */
	clearcoat?: number;
	/** The coat's perceptual roughness, from 0 to 1. The default is 0.02, a mirror. */
	clearcoatRoughness?: number;
	/** The metal flakes, or `false` for a plain metallic paint. The default has flakes. */
	flakes?: PaintFlakes | false;
	/** The panel seams, or `false` for a smooth panel. The default has seams. */
	seams?: PaintSeams | false;
	/** The carbon weave, or `false` for none. The default is `false`. */
	weave?: PaintWeave | false;
}

/** The flakes that a paint starts with. */
const DEFAULT_FLAKES: Required<PaintFlakes> = { cells: [120, 210], tilt: 0.25, spread: 0.18 };
/** The seams that a paint starts with. */
const DEFAULT_SEAMS: Required<PaintSeams> = { spacing: [0.34, 0], width: 0.0022, shade: 0.85 };
/** The weave that a paint starts with. */
const DEFAULT_WEAVE: Required<PaintWeave> = { cells: [90, 150], shine: 0.85 };

/**
 * Makes a car paint for a scene. The paint is one custom material: give it to every body panel of
 * one car, and make another for another look. The paint draws its look through the engine's clear
 * coat, and its parts run only where the look asks for them.
 *
 * The mesh needs texture coordinates. The first runs along the surface and the second around or up
 * it, which places the flakes, the seams and the weave.
 */
export function createCarPaint(ctx: SketchContext, look: CarPaintLook = {}): Material {
	const flakes = look.flakes === false ? false : { ...DEFAULT_FLAKES, ...look.flakes };
	const seams = look.seams === false ? false : { ...DEFAULT_SEAMS, ...look.seams };
	const weave =
		look.weave === false || look.weave === undefined ? false : { ...DEFAULT_WEAVE, ...look.weave };
	return ctx.materials.shader({
		wgsl: paintShader,
		uniforms: {
			// Without one of the parts, its value is 0 and its branch in the shader never runs.
			seamSpacing: seams ? seams.spacing : ([0, 0] as const),
			flakeCells: flakes ? flakes.cells : ([0, 0] as const),
			weaveCells: weave ? weave.cells : ([0, 0] as const),
			flakeTilt: flakes ? flakes.tilt : 0,
			flakeSpread: flakes ? flakes.spread : 0,
			seamWidth: seams ? seams.width : 0,
			seamShade: seams ? seams.shade : 0,
			weaveShine: weave ? weave.shine : 0,
		},
		color: look.color ?? '#9e0b16',
		metalness: look.metalness ?? 0.72,
		roughness: look.roughness ?? 0.34,
		clearcoat: look.clearcoat ?? 1,
		clearcoatRoughness: look.clearcoatRoughness ?? 0.02,
	});
}
