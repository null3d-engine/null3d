// The draw adapter of the public feature description: one add-on draw that the engine places in a
// frame from the description alone. An add-on gives the draw's WGSL, the vertex data of one shape,
// the uniforms that change its look, and the description's frame point, band and order. The adapter
// makes the mesh and the material from those, creates the scene object that draws them, and maps the
// description's sort place onto the object. The engine records and replays the object like any other
// object of the scene, on both GPU paths and in every thread mode.
//
// A draw of many copies takes the same declaration with a row count: the engine repeats the one
// shape once for each row of an instance batch, and each row brings its own place, color and four
// values. The transparent pass culls and sorts those rows back to front on the job workers, so a
// draw of many blended copies needs no order of its own from the add-on.
//
// The add-on owns the vertices, so it changes them with the mesh's own update calls. A surface
// function reads the vertex colors and the uniforms, and a full shader reads the attributes at
// their engine locations. A draw records in the main view alone for now: the adapter refuses another
// view rather than drawing silently in the wrong views.

import type { FeatureDescription } from './features';
import type {
	CompiledWgsl,
	Geometry,
	Material,
	Materials,
	MeshArrays,
	MeshGeometry,
	ShaderOptions,
	ShaderValues,
} from './resources';
import type { InstanceBatch, Mesh, Quat, Vec3 } from './scene';

/**
 * The vertex data of one shape that a draw shows: the arrays that `geometry.fromArrays` takes. The
 * arrays fix the draw's vertex format and its bounds.
 *
 * @category api/feature-draws
 */
export type FeatureDrawVertices = MeshArrays;

/**
 * Options of `scene.addFeatureDraw` besides the feature description. The shader and its uniforms
 * take the options of `materials.shader`, so a draw takes every value and texture that a custom
 * material takes. Where the draw sits, and where it sorts, come from the description.
 *
 * @category api/feature-draws
 */
export interface FeatureDrawOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends Omit<ShaderOptions<Wgsl>, 'wgsl'> {
	/** The draw's WGSL, compiled by the null3D Vite plugin. */
	readonly shader: Wgsl;
	/** The vertex data of one shape, which fixes the draw's vertex format. */
	readonly vertices: FeatureDrawVertices;
	/** The position of the draw in the world. The default is (0, 0, 0). */
	readonly position?: Vec3;
	/** The rotation of the draw, as a quaternion (x, y, z, w). The default is none. */
	readonly rotation?: Quat;
	/** The scale of the draw on each axis. The default is (1, 1, 1). */
	readonly scale?: Vec3;
	/** The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/**
 * The row arrays of a draw of many copies, as `scene.createInstances` takes them: a color for each
 * row, four values of the add-on's for each row, and whether every row updates in every frame.
 *
 * @category api/feature-draws
 */
export interface FeatureRowOptions {
	/** Adds a linear RGBA color for each row, which multiplies the material's color and opacity. */
	readonly colors?: boolean;
	/** Adds four numbers of the add-on's for each row, which its WGSL reads as `object.values`. */
	readonly values?: boolean;
	/** True when every row updates and uploads in every frame. */
	readonly dynamic?: boolean;
}

/**
 * Options of `scene.addFeatureInstances`: the options of a draw, and the number of copies that the
 * engine draws of its one shape. Each copy is a row of an instance batch, with its own place,
 * color and values, which the add-on writes in the batch's arrays.
 *
 * @category api/feature-draws
 */
export interface FeatureInstancesOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends FeatureDrawOptions<Wgsl> {
	/** The number of copies of the shape, from 1 up. */
	readonly instances: number;
	/** The row arrays that the copies bring beside their places. */
	readonly rows?: FeatureRowOptions;
	/**
	 * The point that every row's position is relative to, as `scene.createInstances` takes it. Use
	 * it for a draw far from the world's origin, which keeps its rows precise.
	 */
	readonly origin?: Vec3;
}

/**
 * One add-on draw that a feature description declared. It draws its vertices with its own WGSL, in
 * the frame point that the description names. Change its vertices, its uniforms and its place with
 * the calls that this class and its `object` and `material` give, and free it with `destroy`.
 *
 * @category api/feature-draws
 */
export class FeatureDraw<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** @internal */
	constructor(
		/** The feature's name, from the description. */
		readonly name: string,
		/** The scene object that draws the mesh with the material. */
		readonly object: Mesh,
		/** The draw's custom material, whose uniforms the WGSL reads. */
		readonly material: Material<ShaderValues<Wgsl>>,
		/** @internal The mesh that holds the draw's vertices. */
		readonly mesh: MeshGeometry,
	) {}

	/**
	 * Writes new values into one attribute of the draw's vertices, as `mesh.updateVertices` does.
	 * The draw's vertex format stays the same, and the defaults update every vertex.
	 */
	updateVertices(
		name: Parameters<MeshGeometry['updateVertices']>[0],
		values: Parameters<MeshGeometry['updateVertices']>[1],
		start = 0,
		count?: number,
	): void {
		this.mesh.updateVertices(name, values, start, count);
	}

	/** Changes one uniform of the draw, or one of its material values, by name. */
	setUniform<Name extends keyof ShaderValues<Wgsl> & string>(
		name: Name,
		value: NonNullable<ShaderValues<Wgsl>[Name]>,
	): void {
		this.material.setUniform(name, value);
	}

	/** Changes several uniforms and material values at once, as `material.set` does. */
	set(values: ShaderValues<Wgsl>): void {
		this.material.set(values);
	}

	/** Draws the draw, or hides it, from the next frame on. */
	setVisible(visible: boolean): void {
		this.object.setVisible(visible);
	}

	/**
	 * Sets where the draw sorts among the blended objects of its pass, as `mesh.setRenderOrder`
	 * does. It is the description's order inside its band by default, so a lower number draws first.
	 * The engine orders opaque and masked draws itself.
	 */
	setRenderOrder(order: number): void {
		this.object.setRenderOrder(order);
	}

	/** Frees the draw's object, material and vertices. Later calls on it throw E1101. */
	destroy(): void {
		this.object.destroy();
		this.material.destroy();
		this.mesh.destroy();
	}
}

/**
 * A draw of many copies: one shape that the engine repeats once for each row of an instance batch.
 * The add-on writes the rows in the batch's arrays, and the engine culls and sorts them like any
 * other batch's rows. Its material and its vertices work as a one-shape draw's do.
 *
 * @category api/feature-draws
 */
export class FeatureInstances<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** @internal */
	constructor(
		/** The feature's name, from the description. */
		readonly name: string,
		/** The batch whose rows place the copies, and whose arrays the add-on writes. */
		readonly batch: InstanceBatch,
		/** The draw's custom material, whose uniforms the WGSL reads. */
		readonly material: Material<ShaderValues<Wgsl>>,
		/** @internal The mesh that holds the one shape. */
		readonly mesh: MeshGeometry,
	) {}

	/** The number of copies that the batch holds. */
	get count(): number {
		return this.batch.count;
	}

	/**
	 * Draws the first `count` rows, and hides the rest, from the next frame on. The rows keep the
	 * order that the batch holds them in; the transparent pass sorts the rows that draw.
	 */
	setCount(count: number): void {
		this.batch.setActiveCount(count);
	}

	/** Writes new values into one attribute of the shape, as `mesh.updateVertices` does. */
	updateVertices(
		name: Parameters<MeshGeometry['updateVertices']>[0],
		values: Parameters<MeshGeometry['updateVertices']>[1],
		start = 0,
		count?: number,
	): void {
		this.mesh.updateVertices(name, values, start, count);
	}

	/** Changes one uniform of the draw, or one of its material values, by name. */
	setUniform<Name extends keyof ShaderValues<Wgsl> & string>(
		name: Name,
		value: NonNullable<ShaderValues<Wgsl>[Name]>,
	): void {
		this.material.setUniform(name, value);
	}

	/** Changes several uniforms and material values at once, as `material.set` does. */
	set(values: ShaderValues<Wgsl>): void {
		this.material.set(values);
	}

	/** Frees the draw's rows, material and shape. Later calls on it throw E1101. */
	destroy(): void {
		this.batch.destroy();
		this.material.destroy();
		this.mesh.destroy();
	}
}

/** What the adapter asks the scene for: the makers of a mesh and a material, the objects, and errors. */
export interface FeatureDrawHost {
	readonly geometry: Geometry;
	readonly materials: Materials;
	createMesh(
		mesh: MeshGeometry,
		material: Material,
		place: {
			readonly name: string;
			readonly position?: Vec3;
			readonly rotation?: Quat;
			readonly scale?: Vec3;
			readonly layers?: number;
		},
	): Mesh;
	/** Makes the instance batch that repeats the shape once for each row. */
	createInstances(
		mesh: MeshGeometry,
		count: number,
		options: {
			readonly material: Material;
			readonly dynamic?: boolean;
			readonly colors?: boolean;
			readonly values?: boolean;
			readonly origin?: Vec3;
			readonly layers?: number;
		},
	): InstanceBatch;
	/**
	 * The error that a description the adapter cannot place throws, which the scene makes so this
	 * module shares no engine module with the start's files.
	 */
	fail(detail: string): Error;
}

/** The frames where a draw records, and the alpha mode that each one draws with by default. */
const FRAME_ALPHA: Readonly<Record<string, 'opaque' | 'blend'>> = {
	opaque: 'opaque',
	transparent: 'blend',
};

/** The render order of a description's band and order, as blended objects sort. */
function renderOrder(description: FeatureDescription): number {
	// A band's orders count from its own first place, so shifting the later bands keeps them after
	// the earlier ones.
	const order = description.order ?? 0;
	if (description.band === 'before') return order - 2_097_152;
	if (description.band === 'after') return order + 2_097_152;
	return order;
}

/**
 * Checks that a description is a draw this adapter can place, and returns the alpha mode that its
 * material draws with. Throws E1223 for a description that is not a `'draw'`, for a frame point or
 * view that the adapter does not place, and for an alpha mode that draws in another pass than the
 * frame names.
 */
function checkDraw(
	description: FeatureDescription,
	alphaModeOption: ShaderOptions['alphaMode'] | undefined,
	host: FeatureDrawHost,
	call: string,
): NonNullable<ShaderOptions['alphaMode']> {
	const invalid = (detail: string) => host.fail(`${call}() ${detail}`);
	if (description.kind !== 'draw')
		throw invalid(
			`got the feature '${description.name}' with the kind ${JSON.stringify(description.kind)}; a draw takes a description with the kind 'draw'.`,
		);
	const frame = description.frame;
	const alpha = frame === undefined ? undefined : FRAME_ALPHA[frame];
	if (frame === undefined || alpha === undefined)
		throw invalid(
			`got the feature '${description.name}' with the frame ${JSON.stringify(frame)}; a draw records at 'opaque' or 'transparent'.`,
		);
	const views = description.views ?? ['main'];
	if (views.length !== 1 || views[0] !== 'main')
		throw invalid(
			`got the feature '${description.name}' with the views ${JSON.stringify(views)}; a draw records in the main view alone, because the adapter places no other view yet.`,
		);
	const alphaMode = alphaModeOption ?? alpha;
	// A material that blends draws in the transparent pass, and one that does not draws in the
	// opaque pass. A description that names the other pass would draw somewhere it never said.
	const blended = alphaMode === 'blend';
	if (blended !== (alpha === 'blend'))
		throw invalid(
			`got the feature '${description.name}' at the frame '${frame}' with the alpha mode '${alphaMode}'. That mode draws in the ${blended ? 'transparent' : 'opaque'} pass, so give the frame that names it, or leave the alpha mode out.`,
		);
	return alphaMode;
}

/**
 * Makes the draw that `description` declares: checks that the description is a draw this adapter
 * can place, builds the mesh and the material from the options, and creates the object that draws
 * them. Throws E1223 for a description that is not a `'draw'`, for a frame point or view that the
 * adapter does not place, and for an alpha mode that draws in another pass than the frame names.
 */
export function createFeatureDraw<const Wgsl extends string | CompiledWgsl>(
	description: FeatureDescription,
	options: FeatureDrawOptions<Wgsl>,
	host: FeatureDrawHost,
	call = 'addFeatureDraw',
): FeatureDraw<Wgsl> {
	const alphaMode = checkDraw(description, options.alphaMode, host, call);
	const { geometry, materials } = host;
	// The draw's own fields stay here: the material takes the rest, with the shader under the name
	// that it reads.
	const { shader, vertices, position, rotation, scale, layers, ...materialOptions } = options;
	const vertexColors = vertices.colors !== undefined;
	const material = materials.shader({
		...materialOptions,
		wgsl: shader,
		alphaMode,
		vertexColors: options.vertexColors ?? vertexColors,
	} as ShaderOptions<Wgsl>);
	const mesh = geometry.fromArrays(vertices);
	let object: Mesh;
	try {
		object = host.createMesh(mesh, material as unknown as Material, {
			name: description.name,
			position,
			rotation,
			scale,
			layers,
		});
	} catch (error) {
		material.destroy();
		mesh.destroy();
		throw error;
	}
	object.setRenderOrder(renderOrder(description));
	return new FeatureDraw(description.name, object, material, mesh);
}

/**
 * Makes the draw of many copies that `description` declares: the same checks as a one-shape draw,
 * then the material, the one shape and the instance batch that repeats it. Each row of the batch
 * places one copy, and the add-on writes the rows in `draw.batch`. Throws E1223 for a description
 * that the adapter cannot place, and for a copy count that is not a whole number from 1 up.
 */
export function createFeatureInstances<const Wgsl extends string | CompiledWgsl>(
	description: FeatureDescription,
	options: FeatureInstancesOptions<Wgsl>,
	host: FeatureDrawHost,
	call = 'addFeatureInstances',
): FeatureInstances<Wgsl> {
	const alphaMode = checkDraw(description, options.alphaMode, host, call);
	// The draw's own fields stay with it: the material takes the rest, with the shader under the
	// name that it reads.
	const {
		shader,
		vertices,
		instances,
		rows,
		origin,
		position,
		rotation,
		scale,
		layers,
		...materialOptions
	} = options;
	if (position !== undefined || rotation !== undefined || scale !== undefined)
		throw host.fail(
			`${call}() got a place for one object, but a draw of many copies places each copy by its row. Write the rows' places in the batch's arrays, or give the batch the 'origin' that their positions are relative to.`,
		);
	if (!Number.isInteger(instances) || instances < 1)
		throw host.fail(
			`${call}() got ${instances} copies. A draw of many copies repeats its shape from 1 to 16,777,216 times, in whole numbers.`,
		);
	const { geometry, materials } = host;
	const material = materials.shader({
		...materialOptions,
		wgsl: shader,
		alphaMode,
		vertexColors: options.vertexColors ?? vertices.colors !== undefined,
	} as ShaderOptions<Wgsl>);
	const mesh = geometry.fromArrays(vertices);
	let batch: InstanceBatch;
	try {
		batch = host.createInstances(mesh, instances, {
			material: material as unknown as Material,
			dynamic: rows?.dynamic,
			colors: rows?.colors,
			values: rows?.values,
			origin,
			layers,
		});
	} catch (error) {
		material.destroy();
		mesh.destroy();
		throw error;
	}
	return new FeatureInstances(description.name, batch, material, mesh);
}
