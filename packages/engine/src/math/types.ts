// The array types that the math helpers read and write. Each is a bare index signature, so a tuple,
// a plain array and a typed array all fit, and a helper that writes into an array returns the
// caller's own type.

/**
 * A vector (x, y, z) in an array: a tuple such as `[0, 1, 0]`, a plain array or a typed array. The
 * math helpers read and write its first three elements.
 *
 * @category api/math
 */
export type Vec3Like = { [index: number]: number };

/**
 * A rotation as a quaternion (x, y, z, w) in an array: a tuple, a plain array or a typed array. The
 * math helpers read and write its first four elements.
 *
 * @category api/math
 */
export type QuatLike = { [index: number]: number };

/**
 * A 4 by 4 matrix in an array of 16 numbers, stored column by column, as three.js and WebGPU store
 * matrices. Elements 12, 13 and 14 hold the translation.
 *
 * @category api/math
 */
export type Mat4Like = { [index: number]: number };

/**
 * The axis order of Euler angles, with three.js's names. `'XYZ'` turns an object about its own X
 * axis, then its Y axis, then its Z axis.
 *
 * @category api/math
 */
export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
