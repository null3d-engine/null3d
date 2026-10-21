// The geometry of one gizmo drag: where the pointer's ray meets a plane through the object, and
// how that point moves, turns or scales the object. The controls keep one drag and begin it at each
// press, so move() carries the whole of a drag's arithmetic and allocates nothing.
//
// The plane of a drag follows three.js's TransformControls. A single axis drags in the plane that
// holds the axis and faces the camera as squarely as it can. A plane handle drags in its own plane.
// The center handle, a turn and the outer ring drag in the plane of the screen. A turn takes the
// angle that the pointer sweeps around the axis, which is exact, where three.js scales a linear
// approximation of that angle.
import { type Mat4Like, mat4, type QuatLike, quat, type Vec3Like, vec3 } from '@null3d/engine';

/**
 * What a drag does to the object: move it, turn it or scale it.
 *
 * @category api/controls
 */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/**
 * The axes that a drag works along: the three axes of the world, or the object's own axes.
 *
 * @category api/controls
 */
export type GizmoSpace = 'world' | 'local';

/**
 * The handle that the user grabs, with three.js's names: one axis, two axes of a plane handle,
 * all three for the center handle, and `E` for the outer ring that turns about the view.
 *
 * @category api/controls
 */
export type GizmoAxis = 'X' | 'Y' | 'Z' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'E';

/** The state that a drag starts from. */
export interface DragStart {
	/** What the drag does, which handle it holds, and the axes that it works along. */
	mode: GizmoMode;
	axis: GizmoAxis;
	space: GizmoSpace;
	/** The object's transform relative to its parent. */
	position: Vec3Like;
	rotation: QuatLike;
	scale: Vec3Like;
	/** The object's position and rotation in the world. */
	worldPosition: Vec3Like;
	worldRotation: QuatLike;
	/**
	 * The inverse of the parent's world matrix, which carries a world point into the parent's
	 * space, and the parent's world rotation. A root object has the identity for both.
	 */
	parentInverse: Mat4Like;
	parentRotation: QuatLike;
	/** The unit direction from the object toward the camera. */
	eye: Vec3Like;
	/**
	 * The unit direction from the scene toward the camera: the camera's own backward axis, which
	 * gives the plane that faces the screen.
	 */
	view: Vec3Like;
	/** The pointer's ray, from the press. */
	rayOrigin: Vec3Like;
	rayDirection: Vec3Like;
}

/** The unit axes in the order X, Y, Z. */
const UNITS: readonly Vec3Like[] = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1],
];
/** The index of each single axis, and -1 for a handle that holds more than one. */
const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;
/** The axis at right angles to each plane handle: XY turns about Z, YZ about X, XZ about Y. */
const PLANE_NORMAL = { XY: 2, YZ: 0, XZ: 1 } as const;
/** A bit for each axis that a handle's name names: X, Y and Z. */
const X_BIT = 1;
const Y_BIT = 2;
const Z_BIT = 4;
/** Below these, a value counts as zero: a squared length, a dot product and a plane's cosine. */
const ZERO_LENGTH = 1e-12;
const ZERO_DOT = 1e-9;

/** The bits of the axes that a handle's name names. */
function axesOf(axis: GizmoAxis): number {
	switch (axis) {
		case 'X':
			return X_BIT;
		case 'Y':
			return Y_BIT;
		case 'Z':
			return Z_BIT;
		case 'XY':
			return X_BIT | Y_BIT;
		case 'YZ':
			return Y_BIT | Z_BIT;
		case 'XZ':
			return X_BIT | Z_BIT;
		default:
			return X_BIT | Y_BIT | Z_BIT;
	}
}

/** The index of a handle's single axis, or -1 for a handle that holds more than one. */
function axisIndex(axis: GizmoAxis): number {
	return axis in AXIS_INDEX ? AXIS_INDEX[axis as keyof typeof AXIS_INDEX] : -1;
}

/** `value` moved to the nearest whole multiple of `step`. */
function snap(value: number, step: number): number {
	return Math.round(value / step) * step;
}

/**
 * One drag of a gizmo handle. The controls begin it at the press and call `move` for each frame
 * that the pointer moves, then read `position`, `rotation` and `scale`.
 *
 * @category api/controls
 */
export class GizmoDrag {
	/** What the drag does, which handle it holds, and the axes that it works along. */
	mode: GizmoMode = 'translate';
	axis: GizmoAxis = 'X';
	space: GizmoSpace = 'world';
	/** The steps that a drag snaps to, or null for a free drag. */
	translationSnap: number | null = null;
	rotationSnap: number | null = null;
	scaleSnap: number | null = null;

	/** The object's transform as the drag began, relative to its parent. */
	readonly startPosition = vec3.create();
	readonly startRotation = quat.create();
	readonly startScale = vec3.create();
	/** The transform that the drag gives the object, relative to its parent. */
	readonly position = vec3.create();
	readonly rotation = quat.create();
	readonly scale = vec3.create();

	/** The object's world position and rotation after the drag, which place the handles. */
	readonly worldPosition = vec3.create();
	readonly worldRotation = quat.create();
	/** The object's world position and rotation as the drag began, which the math holds to. */
	private readonly startWorld = vec3.create();
	private readonly startWorldRotation = quat.create();
	private readonly parentInverse = mat4.create();
	private readonly parentRotation = quat.create();
	private readonly parentRotationInverse = quat.create();
	private readonly eye = vec3.create();
	/** The camera's own backward axis, which gives the plane that faces the screen. */
	private readonly view = vec3.create();
	/** The handle's axis in the world, for a handle that holds a single axis or the outer ring. */
	private readonly axisWorld = vec3.create();
	private readonly planeNormal = vec3.create();
	/** Where the ray met the plane at the press, and at the last frame. */
	private readonly startPoint = vec3.create();
	private readonly endPoint = vec3.create();
	/** Scratch vectors, made once: move() allocates nothing. */
	private readonly a = vec3.create();
	private readonly b = vec3.create();
	private readonly c = vec3.create();
	private readonly worldPoint = vec3.create();
	private readonly cross = vec3.create();
	private readonly turn = quat.create();
	/** The single axis of the handle, -1 for a handle that holds more than one. */
	private index = -1;
	private bits = 0;
	private held = false;

	/** True while a drag holds the pointer. */
	get dragging(): boolean {
		return this.held;
	}

	/**
	 * Begins a drag from the object's state and the pointer's ray. Returns false, and holds no
	 * drag, when the ray misses the drag's plane.
	 */
	begin(start: DragStart): boolean {
		this.mode = start.mode;
		this.axis = start.axis;
		// A scale drag works along the object's own axes, and a drag that holds every axis or the
		// outer ring works in the world, as in three.js.
		this.space =
			start.mode === 'scale' || start.axis === 'XYZ' || start.axis === 'E'
				? start.mode === 'scale'
					? 'local'
					: 'world'
				: start.space;
		vec3.copy(this.startPosition, start.position);
		quat.copy(this.startRotation, start.rotation);
		vec3.copy(this.startScale, start.scale);
		vec3.copy(this.position, start.position);
		quat.copy(this.rotation, start.rotation);
		vec3.copy(this.scale, start.scale);
		vec3.copy(this.startWorld, start.worldPosition);
		quat.copy(this.startWorldRotation, start.worldRotation);
		vec3.copy(this.worldPosition, start.worldPosition);
		quat.copy(this.worldRotation, start.worldRotation);
		mat4.copy(this.parentInverse, start.parentInverse);
		quat.copy(this.parentRotation, start.parentRotation);
		quat.invert(this.parentRotationInverse, this.parentRotation);
		vec3.normalize(this.eye, start.eye);
		vec3.normalize(this.view, start.view);
		this.index = axisIndex(start.axis);
		this.bits = axesOf(start.axis);

		// The plane that the drag follows.
		if (this.mode === 'rotate' || this.index < 0) {
			// A turn, the center handle and the outer ring follow the screen.
			vec3.copy(this.planeNormal, this.view);
			if (this.index >= 0) this.worldAxis(this.axisWorld, this.index);
		} else {
			this.worldAxis(this.axisWorld, this.index);
			// The plane that holds the axis and faces the camera as squarely as it can.
			const along = vec3.dot(this.eye, this.axisWorld);
			vec3.scaleAndAdd(this.planeNormal, this.eye, this.axisWorld, -along);
			if (vec3.squaredLength(this.planeNormal) < ZERO_LENGTH) {
				// The axis points at the camera, so the screen's plane is the one that measures it.
				vec3.copy(this.planeNormal, this.view);
			} else vec3.normalize(this.planeNormal, this.planeNormal);
		}
		if (this.mode === 'rotate' && this.axis === 'E') vec3.copy(this.axisWorld, this.eye);
		if (this.index < 0 && this.mode !== 'rotate') {
			// A plane handle follows its own plane. The center handle keeps the screen's.
			const normal = PLANE_NORMAL[this.axis as keyof typeof PLANE_NORMAL];
			if (normal !== undefined) this.worldAxis(this.planeNormal, normal);
		}
		this.held = this.hit(this.startPoint, start.rayOrigin, start.rayDirection);
		return this.held;
	}

	/**
	 * Moves the drag to the pointer's ray. Returns true when the drag has a transform to apply,
	 * which `position`, `rotation` and `scale` hold.
	 */
	move(origin: Vec3Like, direction: Vec3Like): boolean {
		if (!this.held) return false;
		if (!this.hit(this.endPoint, origin, direction)) return false;
		if (this.mode === 'translate') this.translate();
		else if (this.mode === 'scale') this.scaleBy();
		else this.rotate();
		return true;
	}

	/** Ends the drag, so that a later frame applies nothing. */
	end(): void {
		this.held = false;
	}

	/** Writes the world direction of one axis, in the drag's space. */
	private worldAxis(out: Vec3Like, index: number): void {
		const unit = UNITS[index] as Vec3Like;
		if (this.space === 'local') vec3.transformQuat(out, unit, this.startWorldRotation);
		else vec3.copy(out, unit);
	}

	/** True when the ray meets the drag's plane in front of its origin, which it writes to `out`. */
	private hit(out: Vec3Like, origin: Vec3Like, direction: Vec3Like): boolean {
		const denominator = vec3.dot(direction, this.planeNormal);
		if (Math.abs(denominator) < ZERO_DOT) return false;
		const distance =
			vec3.dot(vec3.sub(this.c, this.startWorld, origin), this.planeNormal) / denominator;
		if (!(distance > 0) || !Number.isFinite(distance)) return false;
		vec3.scaleAndAdd(out, origin, direction, distance);
		return true;
	}

	/** Moves the object along the handle's axes, by the distance that the pointer swept. */
	private translate(): void {
		if (this.index >= 0) {
			vec3.sub(this.a, this.endPoint, this.startPoint);
			const along = vec3.dot(this.a, this.axisWorld);
			vec3.scaleAndAdd(this.worldPoint, this.startWorld, this.axisWorld, along);
		} else
			vec3.add(this.worldPoint, this.startWorld, vec3.sub(this.a, this.endPoint, this.startPoint));
		const step = this.translationSnap;
		if (step !== null && this.space === 'world') {
			if (this.bits & X_BIT) this.worldPoint[0] = snap(this.worldPoint[0] as number, step);
			if (this.bits & Y_BIT) this.worldPoint[1] = snap(this.worldPoint[1] as number, step);
			if (this.bits & Z_BIT) this.worldPoint[2] = snap(this.worldPoint[2] as number, step);
		}
		vec3.transformMat4(this.position, this.worldPoint, this.parentInverse);
		vec3.copy(this.worldPosition, this.worldPoint);
		if (step !== null && this.space === 'local') {
			if (this.bits & X_BIT) this.position[0] = snap(this.position[0] as number, step);
			if (this.bits & Y_BIT) this.position[1] = snap(this.position[1] as number, step);
			if (this.bits & Z_BIT) this.position[2] = snap(this.position[2] as number, step);
		}
	}

	/** Scales the object on the handle's axes, by the ratio of the pointer's distances. */
	private scaleBy(): void {
		let factor = 1;
		if (this.index >= 0) {
			const from = vec3.dot(vec3.sub(this.a, this.startPoint, this.startWorld), this.axisWorld);
			const to = vec3.dot(vec3.sub(this.b, this.endPoint, this.startWorld), this.axisWorld);
			if (Math.abs(from) > ZERO_DOT) factor = to / from;
		} else {
			// The center handle: the ratio of the distances from the object, and its sign.
			const from = vec3.sub(this.a, this.startPoint, this.startWorld);
			const to = vec3.sub(this.b, this.endPoint, this.startWorld);
			const length = vec3.length(from);
			if (length > ZERO_DOT) factor = vec3.length(to) / length;
			if (vec3.dot(from, to) < 0) factor = -factor;
		}
		const step = this.scaleSnap;
		for (let k = 0; k < 3; k++) {
			const scaled = (this.startScale[k] as number) * (this.bits & (1 << k) ? factor : 1);
			this.scale[k] =
				step === null || !(this.bits & (1 << k)) ? scaled : snap(scaled, step) || step;
		}
	}

	/** Turns the object about the handle's axis, by the angle that the pointer swept around it. */
	private rotate(): void {
		vec3.sub(this.a, this.startPoint, this.startWorld);
		vec3.sub(this.b, this.endPoint, this.startWorld);
		// The part of each point that stands at right angles to the axis: the arm that turns.
		const alongStart = vec3.dot(this.a, this.axisWorld);
		vec3.scaleAndAdd(this.a, this.a, this.axisWorld, -alongStart);
		const alongEnd = vec3.dot(this.b, this.axisWorld);
		vec3.scaleAndAdd(this.b, this.b, this.axisWorld, -alongEnd);
		let angle = 0;
		if (vec3.squaredLength(this.a) > ZERO_LENGTH) {
			vec3.cross(this.cross, this.a, this.b);
			angle = Math.atan2(vec3.dot(this.cross, this.axisWorld), vec3.dot(this.a, this.b));
		}
		if (this.rotationSnap !== null) angle = snap(angle, this.rotationSnap);
		if (this.space === 'local' && this.index >= 0) {
			// About the object's own axis, after its own turn.
			quat.setAxisAngle(this.turn, UNITS[this.index] as Vec3Like, angle);
			quat.multiply(this.rotation, this.startRotation, this.turn);
		} else {
			// About the axis carried into the parent's space, before the object's own turn.
			vec3.transformQuat(this.a, this.axisWorld, this.parentRotationInverse);
			quat.setAxisAngle(this.turn, this.a, angle);
			quat.multiply(this.rotation, this.turn, this.startRotation);
		}
		quat.multiply(this.worldRotation, this.parentRotation, this.rotation);
	}
}
