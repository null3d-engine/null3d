// The draw adapter of the public feature description: one add-on draw that the engine places in a
// frame from the description alone. An add-on gives the draw's WGSL, the vertex data of one shape,
// the uniforms that change its look, and the description's frame point, band and order. The adapter
// makes the mesh and the material from those, creates the scene object that draws them, and maps the
// description's sort place onto the object. The engine records and replays the object like any other
// object of the scene, on both GPU paths and in every thread mode.
//
// The add-on owns the vertices, so it changes them with the mesh's own update calls. A surface
// function reads the vertex colours and the uniforms, and a full shader reads the attributes at
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
import type { Mesh, Quat, Vec3 } from './scene';

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

/** What the adapter asks the scene for: the makers of a mesh and a material, the object, and errors. */
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
	const alphaMode = options.alphaMode ?? alpha;
	// A material that blends draws in the transparent pass, and one that does not draws in the
	// opaque pass. A description that names the other pass would draw somewhere it never said.
	const blended = alphaMode === 'blend';
	if (blended !== (alpha === 'blend'))
		throw invalid(
			`got the feature '${description.name}' at the frame '${frame}' with the alpha mode '${alphaMode}'. That mode draws in the ${blended ? 'transparent' : 'opaque'} pass, so give the frame that names it, or leave the alpha mode out.`,
		);
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
