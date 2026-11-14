// The geometry of a gizmo drag against three.js's TransformControls. Each test puts the same
// camera, the same object under the same parent and the same pointer rays through both: three.js
// takes the rays as a page's pointer would give them, and null3D's drag takes the ray that they
// give. A move and a scale must match three.js's result, because both follow the same plane and
// the same ratios. A turn is exact here and a scaled approximation in three.js, so its tests work
// the angle out from the plane that the two engines share.
import { describe, expect, it } from 'bun:test';
import {
	Group,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Plane,
	Quaternion,
	Raycaster,
	SphereGeometry,
	Vector2,
	Vector3,
} from 'three';
import { TransformControls as ThreeTransformControls } from 'three/addons/controls/TransformControls.js';
import {
	type DragStart,
	type GizmoAxis,
	GizmoDrag,
	type GizmoMode,
	type GizmoSpace,
} from './gizmo-drag';

/** The canvas's size in CSS pixels, and its field of view in degrees. */
const WIDTH = 640;
const HEIGHT = 360;
const FOV = 50;
/** How far a value may stray: some of the values arrive as 32-bit floats. */
const TOLERANCE = 1e-6;

/** A place that a test starts its object from: any part of its transform. */
interface Place {
	position?: number[];
	rotation?: number[];
	scale?: number[];
}

/** The transform that a drag gives its object. */
interface Pose {
	position: number[];
	rotation: number[];
	scale: number[];
}

/** A camera and an object under a parent, which both sides share. */
class Scene {
	readonly camera = new PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 100);
	readonly parent = new Group();
	readonly mesh = new Mesh(new SphereGeometry(0.5), new MeshBasicMaterial());
	readonly controls = new ThreeTransformControls(this.camera, null);
	private readonly raycaster = new Raycaster();
	/** The poses that the two sides start each drag from. */
	private readonly parentPose: Place;
	private readonly objectPose: Place;

	constructor(parentPose: Place = {}, objectPose: Place = {}) {
		this.parentPose = { position: [0, 0, 0], scale: [1, 1, 1], ...parentPose };
		this.objectPose = { position: [1.5, 0.5, -0.75], scale: [1, 1, 1], ...objectPose };
		this.parent.add(this.mesh);
		this.camera.position.set(3, 4, 7);
		this.camera.lookAt(1, 0.5, 0);
		this.camera.updateMatrixWorld(true);
		this.controls.attach(this.mesh);
		this.reset();
	}

	/** Puts the object and its parent back where every drag starts. */
	reset(): void {
		this.apply(this.parent, this.parentPose);
		this.apply(this.mesh, this.objectPose);
		this.camera.updateMatrixWorld(true);
		this.parent.updateMatrixWorld(true);
	}

	private apply(object: object, pose: Place): void {
		const target = object as {
			position: Vector3;
			quaternion: Quaternion;
			scale: Vector3;
		};
		if (pose.position) target.position.fromArray(pose.position);
		if (pose.rotation) target.quaternion.fromArray(pose.rotation);
		if (pose.scale) target.scale.fromArray(pose.scale);
	}

	/** The world direction from the object toward the camera. */
	eye(): number[] {
		const at = this.mesh.getWorldPosition(new Vector3());
		return this.camera.position.clone().sub(at).normalize().toArray();
	}

	/** The state that a drag begins from, as the controls read it. */
	start(mode: GizmoMode, axis: GizmoAxis, space: GizmoSpace): DragStart {
		const parent = this.parent;
		parent.updateMatrixWorld(true);
		const world = this.mesh.getWorldPosition(new Vector3());
		const worldRotation = this.mesh.getWorldQuaternion(new Quaternion());
		const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(this.mesh.matrixWorld);
		const scale = new Vector3();
		local.decompose(new Vector3(), new Quaternion(), scale);
		const parentRotation = parent.getWorldQuaternion(new Quaternion());
		return {
			mode,
			axis,
			space,
			position: this.mesh.position.toArray(),
			rotation: this.mesh.quaternion.toArray(),
			scale: scale.toArray(),
			worldPosition: world.toArray(),
			worldRotation: worldRotation.toArray(),
			parentInverse: new Float64Array(new Matrix4().copy(parent.matrixWorld).invert().elements),
			parentRotation: parentRotation.toArray(),
			eye: this.eye(),
			view: new Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).toArray(),
			rayOrigin: [0, 0, 0],
			rayDirection: [0, 0, 1],
		};
	}

	/** Points the raycaster through a canvas point, in CSS pixels. */
	private aim(x: number, y: number): void {
		const ndc = new Vector2((x / WIDTH) * 2 - 1, -(y / HEIGHT) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
	}

	/** The pointer's ray through a canvas point, in CSS pixels. */
	ray(x: number, y: number): { origin: number[]; direction: number[] } {
		this.aim(x, y);
		return {
			origin: this.raycaster.ray.origin.toArray(),
			direction: this.raycaster.ray.direction.toArray(),
		};
	}

	/** Where the pointer's ray meets a plane, as three.js computes it. */
	planeHit(x: number, y: number, normal: number[], at: number[]): number[] {
		this.aim(x, y);
		const plane = new Plane().setFromNormalAndCoplanarPoint(
			new Vector3().fromArray(normal),
			new Vector3().fromArray(at),
		);
		const hit = new Vector3();
		if (!this.raycaster.ray.intersectPlane(plane, hit))
			throw new Error('the ray is parallel to the plane');
		return hit.toArray();
	}

	/** Drags three.js's controls from one canvas point to another, and gives its pose. */
	threeDrag(
		mode: GizmoMode,
		axis: GizmoAxis,
		space: GizmoSpace,
		from: [number, number],
		to: [number, number],
	): Pose {
		this.reset();
		const { controls, mesh } = this;
		controls.setMode(mode);
		controls.setSpace(space);
		controls.axis = axis;
		// The plane and the handles take their place from the object, as the app's frame does.
		controls.getHelper().updateMatrixWorld(true);
		const start = this.ndc(from);
		const end = this.ndc(to);
		// three.js reads a place and a button from a pointer event; these tests give the two fields
		// that its controls take from one.
		const at = (point: [number, number], button: number) =>
			({ x: point[0], y: point[1], button }) as unknown as PointerEvent;
		controls.pointerDown(at(start, 0));
		controls.pointerMove(at(end, -1));
		controls.pointerUp(at(end, 0));
		return {
			position: mesh.position.toArray(),
			rotation: mesh.quaternion.toArray(),
			scale: mesh.scale.toArray(),
		};
	}

	/** Drags null3D's drag the same way, and gives the transform that it computes. */
	nullDrag(
		mode: GizmoMode,
		axis: GizmoAxis,
		space: GizmoSpace,
		from: [number, number],
		to: [number, number],
		options: { translationSnap?: number; rotationSnap?: number; scaleSnap?: number } = {},
	): { drag: GizmoDrag; pose: Pose } {
		this.reset();
		const start = this.start(mode, axis, space);
		const ray = this.ray(...from);
		start.rayOrigin = ray.origin;
		start.rayDirection = ray.direction;
		const drag = new GizmoDrag();
		drag.translationSnap = options.translationSnap ?? null;
		drag.rotationSnap = options.rotationSnap ?? null;
		drag.scaleSnap = options.scaleSnap ?? null;
		expect(drag.begin(start)).toBe(true);
		const moved = this.ray(...to);
		expect(drag.move(moved.origin, moved.direction)).toBe(true);
		return {
			drag,
			pose: {
				position: [...drag.position],
				rotation: [...drag.rotation],
				scale: [...drag.scale],
			},
		};
	}

	private ndc([x, y]: [number, number]): [number, number] {
		return [(x / WIDTH) * 2 - 1, -(y / HEIGHT) * 2 + 1];
	}
}

/** The largest difference between two vectors or quaternions, component by component. */
function apart(a: number[] | undefined, b: number[] | undefined): number {
	if (!a || !b) return Number.POSITIVE_INFINITY;
	let largest = 0;
	for (let k = 0; k < a.length; k++)
		largest = Math.max(largest, Math.abs((a[k] as number) - (b[k] as number)));
	return largest;
}

/** How far two quaternions that turn the same way are apart, whichever sign each takes. */
function sameTurn(a: number[], b: number[]): number {
	const flipped = b.map((value) => -value);
	return Math.min(apart(a, b), apart(a, flipped));
}

describe('a move', () => {
	it('follows the plane of one axis, as three.js does', () => {
		const scene = new Scene();
		const theirs = scene.threeDrag('translate', 'X', 'world', [320, 180], [420, 210]);
		const ours = scene.nullDrag('translate', 'X', 'world', [320, 180], [420, 210]).pose;
		expect(apart(ours.position, theirs.position)).toBeLessThan(TOLERANCE);
	});

	it('follows a plane handle, as three.js does', () => {
		const scene = new Scene({}, { rotation: [0, 0.6, 0, 0.8] });
		const theirs = scene.threeDrag('translate', 'XY', 'world', [320, 180], [380, 240]);
		const ours = scene.nullDrag('translate', 'XY', 'world', [320, 180], [380, 240]).pose;
		expect(apart(ours.position, theirs.position)).toBeLessThan(TOLERANCE);
	});

	it('follows the screen for the center handle, as three.js does', () => {
		const scene = new Scene({}, { rotation: [0, 0.6, 0, 0.8] });
		const theirs = scene.threeDrag('translate', 'XYZ', 'world', [320, 180], [400, 130]);
		const ours = scene.nullDrag('translate', 'XYZ', 'world', [320, 180], [400, 130]).pose;
		expect(apart(ours.position, theirs.position)).toBeLessThan(TOLERANCE);
	});

	it('moves along the object’s own axis in local space, as three.js does', () => {
		const scene = new Scene({ rotation: [0, 0.3, 0, 0.953939] }, { rotation: [0, 0.8, 0, 0.6] });
		const theirs = scene.threeDrag('translate', 'X', 'local', [320, 180], [420, 210]);
		const ours = scene.nullDrag('translate', 'X', 'local', [320, 180], [420, 210]).pose;
		expect(apart(ours.position, theirs.position)).toBeLessThan(TOLERANCE);
	});

	it('carries a world move through a turned and scaled parent, as three.js does', () => {
		const scene = new Scene(
			{ position: [0, 2, -1], rotation: [0, 0.5, 0, 0.866025], scale: [2, 2, 2] },
			{ position: [1, 0.5, -1] },
		);
		const theirs = scene.threeDrag('translate', 'Z', 'world', [320, 180], [360, 260]);
		const ours = scene.nullDrag('translate', 'Z', 'world', [320, 180], [360, 260]).pose;
		expect(apart(ours.position, theirs.position)).toBeLessThan(TOLERANCE);
	});

	it('snaps the world position to the steps', () => {
		const scene = new Scene();
		const theirs = scene.threeDrag('translate', 'X', 'world', [320, 180], [430, 200]);
		const snapped = (theirs.position ?? []).map((value) => Math.round(value / 0.25) * 0.25);
		const ours = scene.nullDrag('translate', 'X', 'world', [320, 180], [430, 200], {
			translationSnap: 0.25,
		}).pose;
		expect(apart(ours.position, snapped)).toBeLessThan(TOLERANCE);
	});
});

describe('a scale', () => {
	it('takes the ratio of the pointer’s distances along an axis, as three.js does', () => {
		const scene = new Scene({}, { scale: [1, 1, 1] });
		const theirs = scene.threeDrag('scale', 'X', 'local', [320, 180], [420, 210]);
		const ours = scene.nullDrag('scale', 'X', 'local', [320, 180], [420, 210]).pose;
		expect(apart(ours.scale, theirs.scale)).toBeLessThan(TOLERANCE);
	});

	it('scales every axis for the center handle, as three.js does', () => {
		const scene = new Scene({}, { scale: [1, 1, 1], rotation: [0, 0.6, 0, 0.8] });
		const theirs = scene.threeDrag('scale', 'XYZ', 'local', [320, 180], [380, 220]);
		const ours = scene.nullDrag('scale', 'XYZ', 'local', [320, 180], [380, 220]).pose;
		expect(apart(ours.scale, theirs.scale)).toBeLessThan(TOLERANCE);
	});

	it('keeps the axes that the handle does not name', () => {
		const scene = new Scene({}, { scale: [1, 2, 3] });
		const theirs = scene.threeDrag('scale', 'Y', 'local', [320, 180], [340, 240]);
		const ours = scene.nullDrag('scale', 'Y', 'local', [320, 180], [340, 240]).pose;
		expect(apart(ours.scale, theirs.scale)).toBeLessThan(TOLERANCE);
		expect(ours.scale[0]).toBeCloseTo(1, 6);
		expect(ours.scale[2]).toBeCloseTo(3, 6);
	});

	it('snaps the scale to the steps', () => {
		const scene = new Scene({}, { scale: [1, 1, 1] });
		const { pose } = scene.nullDrag('scale', 'X', 'local', [320, 180], [410, 200], {
			scaleSnap: 0.5,
		});
		const value = pose.scale?.[0] as number;
		expect(Math.abs(value / 0.5 - Math.round(value / 0.5))).toBeLessThan(1e-9);
	});
});

describe('a turn', () => {
	/** The angle that the pointer sweeps about `axis`, from the plane that both engines share. */
	function swept(scene: Scene, axis: number[], from: [number, number], to: [number, number]) {
		const at = scene.mesh.getWorldPosition(new Vector3());
		// The plane that faces the screen: the camera's own backward axis through the object.
		const normal = new Vector3(0, 0, 1).applyQuaternion(scene.camera.quaternion).toArray();
		const a = new Vector3().fromArray(scene.planeHit(...from, normal, at.toArray())).sub(at);
		const b = new Vector3().fromArray(scene.planeHit(...to, normal, at.toArray())).sub(at);
		const around = new Vector3().fromArray(axis);
		const armA = a.clone().addScaledVector(around, -a.dot(around));
		const armB = b.clone().addScaledVector(around, -b.dot(around));
		return Math.atan2(new Vector3().crossVectors(armA, armB).dot(around), armA.dot(armB));
	}

	it('turns the object by the angle that the pointer sweeps about the world axis', () => {
		const scene = new Scene();
		const from: [number, number] = [320, 180];
		const to: [number, number] = [420, 140];
		const angle = swept(scene, [0, 1, 0], from, to);
		const { pose } = scene.nullDrag('rotate', 'Y', 'world', from, to);
		const expected = new Quaternion()
			.setFromAxisAngle(new Vector3(0, 1, 0), angle)
			.multiply(scene.mesh.quaternion)
			.normalize();
		expect(sameTurn(pose.rotation as number[], expected.toArray())).toBeLessThan(TOLERANCE);
	});

	it('turns the object about its own axis in local space', () => {
		const scene = new Scene({}, { rotation: [0, 0.6, 0, 0.8] });
		const from: [number, number] = [320, 180];
		const to: [number, number] = [400, 250];
		const own = new Vector3(0, 1, 0).applyQuaternion(scene.mesh.quaternion);
		const angle = swept(scene, own.toArray(), from, to);
		const { pose } = scene.nullDrag('rotate', 'Y', 'local', from, to);
		const expected = scene.mesh.quaternion
			.clone()
			.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle))
			.normalize();
		expect(sameTurn(pose.rotation as number[], expected.toArray())).toBeLessThan(TOLERANCE);
	});

	it('turns about an axis in the parent’s space, under a turned parent', () => {
		const parent = new Quaternion(0, 0.4, 0, 0.916515);
		const scene = new Scene({ rotation: parent.toArray() });
		const from: [number, number] = [340, 180];
		const to: [number, number] = [380, 230];
		const angle = swept(scene, [1, 0, 0], from, to);
		const { pose } = scene.nullDrag('rotate', 'X', 'world', from, to);
		// The parent carries the world's axis into its own frame, and the object's turn follows it.
		const axisInParent = new Vector3(1, 0, 0).applyQuaternion(parent.clone().invert());
		const expected = new Quaternion()
			.setFromAxisAngle(axisInParent, angle)
			.multiply(scene.mesh.quaternion)
			.normalize();
		expect(sameTurn(pose.rotation as number[], expected.toArray())).toBeLessThan(TOLERANCE);
	});

	it('snaps the angle to the steps', () => {
		const scene = new Scene();
		const from: [number, number] = [320, 180];
		const to: [number, number] = [420, 140];
		const angle = swept(scene, [0, 1, 0], from, to);
		const { pose } = scene.nullDrag('rotate', 'Y', 'world', from, to, {
			rotationSnap: Math.PI / 12,
		});
		const snapped = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
		const expected = new Quaternion()
			.setFromAxisAngle(new Vector3(0, 1, 0), snapped)
			.multiply(scene.mesh.quaternion);
		expect(sameTurn(pose.rotation as number[], expected.toArray())).toBeLessThan(TOLERANCE);
	});

	it('turns the outer ring about the view, and keeps the object in its place', () => {
		const scene = new Scene();
		const at = scene.mesh.getWorldPosition(new Vector3()).toArray();
		const { pose, drag } = scene.nullDrag('rotate', 'E', 'world', [320, 100], [420, 180]);
		expect(apart([...drag.worldPosition], at)).toBeLessThan(TOLERANCE);
		// The turn goes about the direction toward the camera, so an axis across it moves and that
		// direction stays.
		const turned = new Quaternion().fromArray(pose.rotation as number[]);
		const start = scene.mesh.quaternion.clone();
		const across = new Vector3(1, 0, 0);
		expect(
			across.clone().applyQuaternion(start).angleTo(across.clone().applyQuaternion(turned)),
		).toBeGreaterThan(0.05);
		const toward = new Vector3().fromArray(scene.eye());
		expect(
			toward.clone().applyQuaternion(start).angleTo(toward.clone().applyQuaternion(turned)),
		).toBeLessThan(1e-6);
	});
});

describe('a drag that cannot start', () => {
	it('holds nothing when the ray runs along the plane', () => {
		const scene = new Scene();
		const start = scene.start('translate', 'X', 'world');
		// The plane of an X drag holds the X axis, so a ray along X never meets it.
		start.eye = [0, 1, 0];
		start.rayOrigin = [0, 5, 0];
		start.rayDirection = [1, 0, 0];
		const drag = new GizmoDrag();
		expect(drag.begin(start)).toBe(false);
		expect(drag.dragging).toBe(false);
		expect(drag.move([0, 5, 0], [1, 0, 0])).toBe(false);
	});

	it('applies nothing after it ends', () => {
		const scene = new Scene();
		const { drag, pose } = scene.nullDrag('translate', 'X', 'world', [320, 180], [380, 200]);
		drag.end();
		expect(drag.dragging).toBe(false);
		const moved = scene.ray(420, 240);
		expect(drag.move(moved.origin, moved.direction)).toBe(false);
		expect([...drag.position]).toEqual(pose.position);
	});
});
