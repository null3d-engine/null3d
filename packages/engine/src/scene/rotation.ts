// The rotation that an object's lookAt gives it, from the public quaternion helper.

import { lookAt } from '../math/quat';
import type { QuatLike, Vec3Like } from '../math/types';

/**
 * The rotation that turns an object at `eye` toward `target`, with +Y up, as three.js's `lookAt`:
 * cameras and lights point their -Z axis at the target, other objects their +Z axis.
 */
export function quaternionLookAt(
	out: QuatLike,
	eye: Vec3Like,
	target: Vec3Like,
	minusZForward: boolean,
): void {
	if (minusZForward) lookAt(out, target, eye);
	else lookAt(out, eye, target);
}
