// Lines: line segments of any width, drawn in batches. A line batch is an instance batch in the
// engine core that owns points and draws one row per segment between two of them. The core packs
// each segment into its row's world matrix, so segments cull, sort and draw as other rows do, and
// the line shaders turn each one into a quad with round ends, as three.js's Line2 draws it.
//
// `scene.createLines` imports this module the first time, so a page without lines downloads none
// of it. Like the sprite code, it imports no engine module but constants and types. The bundler
// would move a module that it shares with its thread's first file into a file of its own, which
// every page would then download at its start. So the scene checks the options, and hands this
// module the engine's geometry and materials, and the checks of later calls.

import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import type {
	Geometry,
	Material,
	MaterialFeatures,
	MaterialOptions,
	Materials,
	MeshGeometry,
	StandardValues,
} from './resources';
import type { Vec3 } from './scene';

/**
 * Which points each segment joins. With `segments`, each pair of points makes a segment, like
 * three.js's `LineSegments`. With `strip`, every point joins the next, like `Line` and `Line2`. With
 * `loop`, the last point also joins the first, like `LineLoop`.
 *
 * @category api/lines
 */
export type LineMode = 'segments' | 'strip' | 'loop';

/**
 * The values of a line batch's material, which `lines.material.set` changes at any time. The dash
 * values act on dashed lines, as three.js's `LineMaterial` takes them. The metalness, roughness and
 * emissive values act on lit lines, as a standard material takes them.
 *
 * @category api/lines
 */
export interface LineValues
	extends Omit<MaterialOptions, 'alphaCutoff'>,
		Pick<StandardValues, 'metalness' | 'roughness' | 'emissive' | 'emissiveIntensity'> {
	/** The length of each dash, along the line. The default is 1. */
	dashSize?: number;
	/** The length of each gap between dashes. The default is 1. */
	gapSize?: number;
	/** A factor of the line's length, which the dash and gap sizes measure. The default is 1. */
	dashScale?: number;
	/** How far along the line the dashes start, which moves them when it changes. The default is 0. */
	dashOffset?: number;
}

/**
 * Options of `scene.createLines`. The look of the lines takes the options of an unlit material.
 *
 * @category api/lines
 */
export interface LineOptions
	extends LineValues,
		Pick<MaterialFeatures, 'fog' | 'blending' | 'depthWrite' | 'depthTest' | 'depthBias'> {
	/**
	 * The points: 3 numbers each. Their number is the batch's capacity, which never changes, and
	 * `lines.positions` holds them after the call.
	 */
	positions: ArrayLike<number>;
	/**
	 * Linear RGB colors, 3 numbers per point, which multiply `color`. A segment takes the color of
	 * each end and blends from one to the other. The default is white.
	 */
	colors?: ArrayLike<number>;
	/** Which points each segment joins. The default is `strip`. */
	mode?: LineMode;
	/**
	 * The width of the lines: CSS pixels, or world units with `worldUnits`. The default is 1, as
	 * three.js's `linewidth`.
	 */
	width?: number;
	/**
	 * True gives the width in world units, so far lines look thinner, as three.js's `worldUnits`
	 * does. False gives it in CSS pixels. The default is false.
	 */
	worldUnits?: boolean;
	/** Draws the lines as dashes, which `dashSize`, `gapSize` and the other dash values shape. */
	dashed?: boolean;
	/**
	 * Lights the lines as a standard material lights a surface that faces the camera: the sun, the
	 * point and spot lights and the ambient light shade them. False draws the color as it is, as
	 * three.js's line materials do. The default is false.
	 */
	lit?: boolean;
	/** Every point updates and uploads every frame; a static batch updates points marked dirty only. */
	dynamic?: boolean;
	/** The layers every segment is on, as a 32-bit mask. The default, 1, is layer 0. */
	layers?: number;
	/**
	 * The point that every point's position is relative to, as an instance batch's `origin`. The
	 * default is (0, 0, 0). Lines near it keep the precision of 32-bit floats at any distance from
	 * the world's origin.
	 */
	origin?: Vec3;
	/** How the lines use their opacity. The default is `opaque`, as three.js's lines are. */
	alphaMode?: 'opaque' | 'blend';
}

/** What a line batch's segment mesh and material are made with: the engine's objects. */
export interface LineMakers {
	geometry: Geometry;
	materials: Materials;
}

/** The checks of a line batch's later calls, which the scene gives, as this module has no errors. */
export interface LineChecks {
	/** Throws for a width that is not a positive finite number. */
	width(width: number, call: string): void;
	/** Throws for a value of `values` that the material does not take. */
	values(values: LineValues, call: string): void;
}

/**
 * The segment mesh: three.js's segment geometry, two corners at each end and two more at each end's
 * cap, with each corner coded as a point within one unit of the origin. x gives the side of the
 * line, and y the end, with the caps at -0.8 and 0.8.
 */
function segmentMesh(geometry: Geometry): MeshGeometry {
	const ends = [0.8, 0.2, -0.2, -0.8];
	const positions = new Float32Array(ends.flatMap((y) => [-0.6, y, 0, 0.6, y, 0]));
	return geometry.fromArrays({
		positions,
		// Every mesh has normals. The line shaders read none, so the mesh faces +z.
		normals: new Float32Array(ends.flatMap(() => [0, 0, 1, 0, 0, 1])),
		indices: [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5],
	});
}

/** The core's code of each mode. */
const MODES: Readonly<Record<LineMode, number>> = {
	segments: C.LINE_MODE_SEGMENTS,
	strip: C.LINE_MODE_STRIP,
	loop: C.LINE_MODE_LOOP,
};

/** The core's code of a mode that the scene has checked. */
export function modeCode(mode: LineMode | undefined): number {
	return MODES[mode ?? 'strip'];
}

/** True when `values` sets any of `keys`. A loop, so that a call every frame allocates nothing. */
function hasAny(values: LineValues, keys: readonly (keyof LineValues)[]): boolean {
	for (let k = 0; k < keys.length; k++)
		if (values[keys[k] as keyof LineValues] !== undefined) return true;
	return false;
}

/** The dash values with their defaults, as three.js's `LineMaterial` has them. */
const DASH_DEFAULTS = [1, 1, 1, 0] as const;
/** The dash values in the order that the material's custom values hold them. */
const DASH_VALUES = ['dashSize', 'gapSize', 'dashScale', 'dashOffset'] as const;
/**
 * The values that the material's row holds, which a change of the dashes alone leaves alone, so a
 * sketch can move the dashes every frame without converting anything.
 */
const BASE_VALUES = [
	'color',
	'opacity',
	'metalness',
	'roughness',
	'emissive',
	'emissiveIntensity',
] as const;

/**
 * A line batch's material: its color and opacity, as a material's `set` takes them, and its dash
 * values.
 *
 * @category api/lines
 */
export class LineMaterial {
	/** The dash size, gap size, dash scale and dash offset that the core has. */
	private readonly dash = Float64Array.from(DASH_DEFAULTS);

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal */ readonly base: Material<LineValues>,
		private readonly checks: LineChecks,
	) {}

	/** @internal */
	get id(): number {
		return this.base.id;
	}

	/**
	 * Changes the values that it gets and keeps the others. Every segment of the batch changes with
	 * them. Converting a new color allocates.
	 */
	set(values: LineValues): void {
		const call = 'lines.material.set';
		this.checks.values(values, call);
		if (hasAny(values, BASE_VALUES)) this.base.set(values);
		if (this.take(values)) this.write(call);
	}

	/** @internal Keeps the dash values of `values` that are set, and says whether any is. */
	take(values: LineValues): boolean {
		const { dash } = this;
		let given = false;
		for (let k = 0; k < DASH_VALUES.length; k++) {
			const value = values[DASH_VALUES[k] as (typeof DASH_VALUES)[number]];
			if (value === undefined) continue;
			dash[k] = value;
			given = true;
		}
		return given;
	}

	/** @internal Writes the dash values into the material's custom values, where the line shaders read them. */
	write(call: string): void {
		const { core, dash } = this;
		const status = core.glue.setMaterialValues(
			this.id,
			0,
			4,
			dash[0] as number,
			dash[1] as number,
			dash[2] as number,
			dash[3] as number,
		);
		core.check(status, call, undefined, true);
	}
}

/** The parts of a line batch that the scene makes for it. */
export interface LineParts {
	/** The segment mesh, which every line batch shares. */
	mesh: MeshGeometry;
	material: LineMaterial;
}

/**
 * Makes a batch's material from the options of `scene.createLines`, which the scene has checked,
 * and returns it with the segment mesh, which `mesh` holds once it is made.
 */
export function lineParts(
	{ geometry, materials }: LineMakers,
	core: CoreMemory,
	mesh: MeshGeometry | undefined,
	options: LineOptions,
	checks: LineChecks,
	call: string,
): LineParts {
	const base = materials.create<LineValues>(
		options.lit ? C.SHADING_LINE_LIT : C.SHADING_LINE,
		{
			...options,
			alphaMode: options.alphaMode ?? 'opaque',
			doubleSided: true,
			vertexColors: false,
		},
		`${call}.material`,
	);
	const material = new LineMaterial(core, base, checks);
	material.take(options);
	material.write(call);
	return { mesh: mesh ?? segmentMesh(geometry), material };
}

/** The point arrays of a line batch, as views of engine memory. */
interface LinePoints {
	positions: Float32Array;
	colors: Float32Array;
}

/** What a line batch's calls that change points reach in the core: the instance batch's calls. */
export interface LineBatchRows {
	setActiveCount(count: number): void;
	setLayers(mask: number): void;
	markDirty(start: number, count: number): void;
	destroy(): void;
}

/**
 * Lines of any width: segments between points, each drawn as a quad with round ends that faces the
 * camera, like three.js's `Line2`. Write points straight into the typed arrays, as for an instance
 * batch. A dynamic batch updates every segment every frame, and a static batch updates the segments
 * of the points you mark dirty.
 *
 * @category api/lines
 */
export class LineBatch {
	private generation = -1;
	private points!: LinePoints;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal */ readonly id: number,
		/** The number of points: the batch's capacity. */
		readonly count: number,
		/** The lines' material: `set` changes the color, opacity and dashes of every segment. */
		readonly material: LineMaterial,
		private readonly batch: LineBatchRows,
		private readonly checks: LineChecks,
	) {}

	/**
	 * The point arrays, made again after the engine's memory grew. Sketches read points every
	 * frame, so this check creates no closure.
	 */
	private views(): LinePoints {
		if (this.generation !== this.core.generation) this.makeViews();
		return this.points;
	}

	private makeViews(): void {
		const { core, count } = this;
		const address = (field: number) =>
			core.check(core.glue.batchArrays(this.id, field), 'line arrays', 'a line batch');
		this.points = {
			positions: core.f32(address(C.BATCH_FIELD_POSITIONS), count * 3),
			colors: core.f32(address(C.BATCH_FIELD_COLORS), count * 3),
		};
		this.generation = core.generation;
	}

	/** Positions in the world, 3 floats per point. */
	get positions(): Float32Array {
		return this.views().positions;
	}

	/** Linear RGB colors, 3 floats per point, which multiply the material's color. */
	get colors(): Float32Array {
		return this.views().colors;
	}

	/**
	 * Sets the width: CSS pixels, or world units for lines made with `worldUnits`. Every segment
	 * updates and uploads once.
	 */
	setWidth(width: number): void {
		const call = 'lines.setWidth';
		this.checks.width(width, call);
		const { core } = this;
		core.check(core.glue.setLineWidth(this.id, width), call, undefined, true);
	}

	/** Draws only the segments between the first `count` points. */
	setActiveCount(count: number): void {
		this.batch.setActiveCount(count);
	}

	/** Puts every segment on the layers of a 32-bit mask. A new mask needs no rebuild. */
	setLayers(mask: number): void {
		this.batch.setLayers(mask);
	}

	/**
	 * Marks points of a static batch to update and upload, with the segments that use them. On a
	 * dashed line, the segments after them update too, as their distances along the line change.
	 */
	markDirty(start = 0, count = this.count - start): void {
		this.batch.markDirty(start, count);
	}

	/**
	 * Removes the batch and frees its points. Its typed arrays are not valid after this: another
	 * batch can take their memory.
	 */
	destroy(): void {
		this.batch.destroy();
		this.generation = -1;
	}
}
