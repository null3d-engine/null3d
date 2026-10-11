// The types that the generators and the curve classes share.

/**
 * A 2D vector (x, y) in an array: a tuple such as `[0, 1]`, a plain array or a typed array. Where
 * three.js takes a `Vector2`, this package takes one of these and reads its first two elements.
 *
 * @category api/geometry
 */
export type Vec2Like = { [index: number]: number };

/**
 * The arrays that a generator returns, ready for `geometry.fromArrays`. Each array holds the values
 * of vertex 0, then vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes.
 *
 * @category api/geometry
 */
export interface GeneratedArrays {
	/** Three numbers per vertex: x, y and z. Like three.js's `position` attribute. */
	positions: Float32Array;
	/** Three numbers per vertex: the unit normal. Like three.js's `normal` attribute. */
	normals: Float32Array;
	/** Two numbers per vertex: u and v. Like three.js's `uv` attribute. */
	uvs: Float32Array;
	/**
	 * Three vertex indices per triangle. The array holds 32-bit indices when an index reaches
	 * 65535, as three.js's `setIndex` chooses, and 16-bit indices otherwise. Absent when each three
	 * vertices in a row make a triangle.
	 */
	indices?: Uint16Array | Uint32Array;
}
