// A mesh builder for the generator's parts: positions, normals, texture coordinates, the packed wind
// data in the vertex colors, and indices. It grows its arrays as vertices arrive and trims them once
// the part is done, so a part holds no spare room in the asset.

/**
 * One part's arrays, ready for the engine's `geometry.fromArrays`.
 *
 * @category api/vegetation
 */
export interface PartArrays {
	/** The vertices' positions, three numbers each. */
	readonly positions: Float32Array;
	/** The vertices' normals, three numbers each. */
	readonly normals: Float32Array;
	/** The vertices' texture coordinates, two numbers each. */
	readonly uvs: Float32Array;
	/** The wind data, four bytes per vertex. */
	readonly colors: Uint8Array;
	/**
	 * The next coarser level's place for each leaf vertex, four numbers each: the position that the
	 * vertex takes there, then that level's error. It is present on leaf parts, so a leaf material's
	 * vertex offset can morph the level before the switch, and absent on a trunk or a flower.
	 */
	readonly targets?: Float32Array;
	/** The triangles' vertices, three each. */
	readonly indices: Uint16Array | Uint32Array;
}

/**
 * The four bytes that a vertex carries for wind and crown shading.
 *
 * @category api/vegetation
 */
export interface VertexWind {
	/** The branch's index in the plant's wind table. */
	branch: number;
	/** The flutter phase, from 0 to 255. */
	flutter: number;
	/** How freely the branch follows the wind, from 0 to 255. */
	stiffness: number;
	/** How enclosed the vertex is in the crown, from 0 to 255. */
	occlusion: number;
}

/** A growing set of vertices and triangles. */
export class MeshBuilder {
	private positions = new Float32Array(3 * 256);
	private normals = new Float32Array(3 * 256);
	private uvs = new Float32Array(2 * 256);
	private colors = new Uint8Array(4 * 256);
	private indices = new Uint32Array(3 * 256);
	private vertices = 0;
	private triangles = 0;

	/** How many vertices the part holds. */
	get vertexCount(): number {
		return this.vertices;
	}

	/** How many triangles the part holds. */
	get triangleCount(): number {
		return this.triangles;
	}

	/**
	 * Makes room for at least `vertices` vertices and `triangles` triangles, so that a part that
	 * knows its size copies no array while it grows.
	 *
	 * @param vertices The vertices to hold.
	 * @param triangles The triangles to hold.
	 */
	reserve(vertices: number, triangles: number): void {
		while (this.positions.length < vertices * 3) this.growVertices();
		while (this.indices.length < triangles * 3) this.growIndices();
	}

	/**
	 * Adds one vertex and returns its index.
	 *
	 * @param x The vertex's x.
	 * @param y The vertex's y.
	 * @param z The vertex's z.
	 * @param nx The normal's x.
	 * @param ny The normal's y.
	 * @param nz The normal's z.
	 * @param u The texture coordinate's u.
	 * @param v The texture coordinate's v.
	 * @param wind The vertex's wind data.
	 * @returns The vertex's index.
	 */
	vertex(
		x: number,
		y: number,
		z: number,
		nx: number,
		ny: number,
		nz: number,
		u: number,
		v: number,
		wind: VertexWind,
	): number {
		const index = this.vertices;
		if (index * 3 + 3 > this.positions.length) this.growVertices();
		this.positions[index * 3] = x;
		this.positions[index * 3 + 1] = y;
		this.positions[index * 3 + 2] = z;
		this.normals[index * 3] = nx;
		this.normals[index * 3 + 1] = ny;
		this.normals[index * 3 + 2] = nz;
		this.uvs[index * 2] = u;
		this.uvs[index * 2 + 1] = v;
		this.colors[index * 4] = wind.branch;
		this.colors[index * 4 + 1] = wind.flutter;
		this.colors[index * 4 + 2] = wind.stiffness;
		this.colors[index * 4 + 3] = wind.occlusion;
		this.vertices++;
		return index;
	}

	/**
	 * Adds one triangle.
	 *
	 * @param a The first vertex.
	 * @param b The second vertex.
	 * @param c The third vertex.
	 */
	triangle(a: number, b: number, c: number): void {
		const at = this.triangles * 3;
		if (at + 3 > this.indices.length) this.growIndices();
		this.indices[at] = a;
		this.indices[at + 1] = b;
		this.indices[at + 2] = c;
		this.triangles++;
	}

	/** The part's arrays, trimmed to what it holds. */
	finish(): PartArrays {
		const wide = this.vertices > 65535;
		return {
			positions: this.positions.slice(0, this.vertices * 3),
			normals: this.normals.slice(0, this.vertices * 3),
			uvs: this.uvs.slice(0, this.vertices * 2),
			colors: this.colors.slice(0, this.vertices * 4),
			indices: wide
				? this.indices.slice(0, this.triangles * 3)
				: Uint16Array.from(this.indices.subarray(0, this.triangles * 3)),
		};
	}

	private growVertices(): void {
		const size = this.positions.length * 2;
		const positions = new Float32Array(size);
		positions.set(this.positions);
		this.positions = positions;
		const normals = new Float32Array(size);
		normals.set(this.normals);
		this.normals = normals;
		const uvs = new Float32Array((size / 3) * 2);
		uvs.set(this.uvs);
		this.uvs = uvs;
		const colors = new Uint8Array((size / 3) * 4);
		colors.set(this.colors);
		this.colors = colors;
	}

	private growIndices(): void {
		const indices = new Uint32Array(this.indices.length * 2);
		indices.set(this.indices);
		this.indices = indices;
	}
}

/**
 * The bytes that a part's arrays take, for the asset's stats.
 *
 * @param part The part's arrays.
 * @returns The bytes.
 * @category api/vegetation
 */
export function partBytes(part: PartArrays): number {
	return (
		part.positions.byteLength +
		part.normals.byteLength +
		part.uvs.byteLength +
		part.colors.byteLength +
		(part.targets?.byteLength ?? 0) +
		part.indices.byteLength
	);
}
