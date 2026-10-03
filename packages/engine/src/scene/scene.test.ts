import { beforeEach, describe, expect, test } from 'bun:test';
import {
	Matrix4,
	Quaternion,
	Raycaster,
	Object3D as ThreeObject,
	OrthographicCamera as ThreeOrthographicCamera,
	PerspectiveCamera as ThreePerspectiveCamera,
	Vector2,
	Vector3,
} from 'three';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { FrameCameras } from './frame-cameras';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';
import { type Object3D, Scene } from './scene';
import { Texture, type Textures } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Object slots in the fake core; its arrays have one more row, as the engine core's do. */
const CAPACITY = 7;
/** Records in the fake core's command ring. */
const RING = 16;
/** Where the fake core keeps each array in its memory, in bytes. */
const AT = {
	positions: 0,
	rotations: 128,
	scales: 256,
	radii: 384,
	centers: 448,
	dirty: 576,
	records: 1024,
	write: 1536,
	read: 1540,
	matrix: 1544,
};
const SLOT_MASK = (1 << C.HANDLE_SLOT_BITS) - 1;
/** The frame that the fake scene says it runs. */
const FRAME = 5;
/** The handle of a texture that the fake core says was destroyed. */
const DESTROYED_TEXTURE = 13;

/**
 * A core with the scene's arrays and command ring in a memory of its own. Its world matrices are
 * the ones that a test sets for each handle.
 */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const matrices = new Map<number, readonly number[]>();
	let next = 1;
	let failure = { code: 0, details: [0, 0] };
	const fields: Record<number, number> = {
		[C.SCENE_FIELD_POSITIONS]: AT.positions,
		[C.SCENE_FIELD_ROTATIONS]: AT.rotations,
		[C.SCENE_FIELD_SCALES]: AT.scales,
		[C.SCENE_FIELD_LOCAL_RADII]: AT.radii,
		[C.SCENE_FIELD_LOCAL_CENTERS]: AT.centers,
		[C.SCENE_FIELD_DIRTY_WORDS]: AT.dirty,
	};
	const ring: Record<number, number> = {
		[C.RING_FIELD_RECORDS]: AT.records,
		[C.RING_FIELD_CAPACITY]: RING,
		[C.RING_FIELD_WRITE_INDEX]: AT.write,
		[C.RING_FIELD_READ_INDEX]: AT.read,
	};
	const backgrounds: (number | number[])[] = [];
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => fields[field],
		commandRing: (field: number) => ring[field],
		worldMatrixAddress: () => AT.matrix,
		reserveObject: () => next++,
		worldMatrix: (handle: number) => {
			const matrix = matrices.get(handle);
			if (matrix) {
				new Float64Array(memory.buffer, AT.matrix, C.CORE_MATRIX_FLOATS).set(matrix);
				return 0;
			}
			failure = { code: 1101, details: [handle & SLOT_MASK, FRAME] };
			return failure.code;
		},
		setPerspectiveCamera: () => 0,
		setOrthographicCamera: () => 0,
		setBackground: (r: number, g: number, b: number) => backgrounds.push([r, g, b]) && 0,
		setBackgroundTexture: (texture: number) => {
			if (texture !== DESTROYED_TEXTURE) return backgrounds.push(texture) && 0;
			failure = { code: 1101, details: [texture & SLOT_MASK, FRAME] };
			return failure.code;
		},
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const control = controlViews(createControlBuffer(false));
	/** The frame that the input event at each point names, by "x,y". */
	const eventFrames = new Map<string, number>();
	const frameAt = (x: number, y: number) => eventFrames.get(`${x},${y}`) ?? -1;
	const cameras = new FrameCameras(core, control, { frameAt });
	const scene = new Scene(core, { frame: FRAME }, false, undefined, cameras);
	const box = new MeshGeometry(1, 0.87, core);
	const ball = new MeshGeometry(2, 1.5, core);
	const paint = new Material(1, core, 'materials.standard.set');
	const f32 = (at: number, length: number) => new Float32Array(memory.buffer, at, length);
	const u32 = (at: number, length: number) => new Uint32Array(memory.buffer, at, length);
	return {
		core,
		scene,
		eventFrames,
		/** Sizes the canvas: device pixels, then CSS pixels. */
		setCanvas(width: number, height: number, cssWidth: number, cssHeight: number) {
			control.slots[Slot.CanvasWidth] = width;
			control.slots[Slot.CanvasHeight] = height;
			control.slotFloats[Slot.CanvasCssWidth] = cssWidth;
			control.slotFloats[Slot.CanvasCssHeight] = cssHeight;
		},
		/** The background calls: a color's linear components, or a texture's handle (0 for none). */
		backgrounds,
		box,
		ball,
		paint,
		/** Sets the world matrix that the core gives an object, from a three.js matrix. */
		setWorld(object: Object3D, matrix: Matrix4) {
			const e = matrix.elements;
			const rows = [0, 1, 2].flatMap((r) => [e[r], e[4 + r], e[8 + r], e[12 + r]]);
			matrices.set(object.handle, rows as number[]);
		},
		/** An object's row of one of the per-slot arrays. */
		row(object: Object3D, array: 'positions' | 'rotations' | 'scales' | 'centers' | 'radii') {
			const width = { positions: 3, rotations: 4, scales: 3, centers: 3, radii: 1 }[array];
			return [...f32(AT[array] + object.slot * width * 4, width)];
		},
		/** The commands written since the last call, as [operation, handle, a, b]. */
		take(): number[][] {
			const [write, read] = [u32(AT.write, 1)[0] as number, u32(AT.read, 1)[0] as number];
			const records = u32(AT.records, RING * 4);
			const out: number[][] = [];
			for (let k = read; k < write; k++) {
				const at = (k % RING) * 4;
				out.push([...records.subarray(at, at + 4)]);
			}
			u32(AT.read, 1)[0] = write;
			return out;
		},
	};
}

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

/** A three.js object's quaternion as four numbers. */
const xyzw = (q: Quaternion) => [q.x, q.y, q.z, q.w];

/** Expects two lists of numbers to match to about the precision of a 32-bit float. */
function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, digits = 6): void {
	expect(actual.length).toBe(expected.length);
	for (let k = 0; k < expected.length; k++)
		expect(actual[k] as number).toBeCloseTo(expected[k] as number, digits);
}

describe('object transforms', () => {
	test('rotateX, rotateY and rotateZ turn an object about its own axes, as three.js does', () => {
		const { scene, row } = fakeCore();
		const start = new Quaternion(0.1, 0.4, -0.2, 0.9).normalize();
		const mine = scene.createGroup({ rotation: xyzw(start) as [number, number, number, number] });
		const theirs = new ThreeObject();
		theirs.quaternion.copy(start);
		mine.rotateX(0.3);
		mine.rotateY(-1.1);
		mine.rotateZ(2);
		theirs.rotateX(0.3).rotateY(-1.1).rotateZ(2);
		expectClose(row(mine, 'rotations'), xyzw(theirs.quaternion));
	});

	test('translate moves an object along its own axes and ignores its scale, as three.js does', () => {
		const { scene, row } = fakeCore();
		const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
		const mine = scene.createGroup({
			position: [1, 2, 3],
			rotation: xyzw(turn) as [number, number, number, number],
			scale: [2, 2, 2],
		});
		const theirs = new ThreeObject();
		theirs.position.set(1, 2, 3);
		theirs.quaternion.copy(turn);
		theirs.scale.set(2, 2, 2);
		mine.translate(0.5, -1, 4);
		theirs.translateX(0.5).translateY(-1).translateZ(4);
		expectClose(row(mine, 'positions'), theirs.position.toArray());
		// A quarter turn about Y moves local +Z to world +X.
		expectClose(row(mine, 'positions'), [5, 1, 2.5]);
	});

	test('getPosition and getRotation copy the values relative to the parent', () => {
		const { scene } = fakeCore();
		const object = scene.createGroup({ position: [1, 2, 3], rotation: [0, 0.6, 0, 0.8] });
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 0];
		object.getPosition(position);
		object.getRotation(rotation);
		expectClose(position, [1, 2, 3]);
		expectClose(rotation, [0, 0.6, 0, 0.8]);
	});

	test('the world getters read the world matrix of the frame that last ran', () => {
		const { scene, setWorld } = fakeCore();
		const object = scene.createGroup();
		const rotation = new Quaternion(0.2, -0.3, 0.1, 0.9).normalize();
		// A translation 1,000 km out that a 32-bit float would round to 6 cm.
		const position = new Vector3(1_000_000.123, 2, -3);
		const world = new Matrix4().compose(position, rotation, new Vector3(2, 0.5, 3));
		setWorld(object, world);
		const matrix = new Array<number>(16).fill(0);
		object.getWorldMatrix(matrix);
		expect(matrix).toEqual(world.elements);
		const where = [0, 0, 0];
		object.getWorldPosition(where);
		expect(where).toEqual([1_000_000.123, 2, -3]);
		const turned = [0, 0, 0, 0];
		object.getWorldQuaternion(turned);
		const three = new ThreeObject();
		three.matrixWorld.copy(world);
		three.matrixAutoUpdate = false;
		three.matrixWorldAutoUpdate = false;
		expectClose(turned, xyzw(three.getWorldQuaternion(new Quaternion())), 12);
	});
});

describe('structural changes', () => {
	test('setParent queues the new parent, with keepWorld when it is asked for', () => {
		const { scene, take } = fakeCore();
		const arm = scene.createGroup();
		const hand = scene.createGroup();
		take();
		hand.setParent(arm);
		hand.setParent(arm, { keepWorld: true });
		hand.setParent(null, { keepWorld: true });
		expect(take()).toEqual([
			[C.COMMAND_SET_PARENT, hand.handle, arm.handle, 0],
			[C.COMMAND_SET_PARENT, hand.handle, arm.handle, C.COMMAND_KEEP_WORLD],
			[C.COMMAND_SET_PARENT, hand.handle, 0, C.COMMAND_KEEP_WORLD],
		]);
	});

	test('createMesh passes the shadow options with the create command', () => {
		const { scene, box, paint, take } = fakeCore();
		const plain = scene.createMesh({ mesh: box, material: paint });
		const shadowed = scene.createMesh({
			mesh: box,
			material: paint,
			castShadows: true,
			receiveShadows: true,
		});
		const flagsOf = (op: number) => op >>> 8;
		const creates = take().filter(([op]) => ((op as number) & 0xff) === C.COMMAND_CREATE);
		expect(creates.map(([op, handle]) => [flagsOf(op as number), handle])).toEqual([
			[C.FLAG_VISIBLE, plain.handle],
			[C.FLAG_VISIBLE | C.FLAG_CAST_SHADOWS | C.FLAG_RECEIVE_SHADOWS, shadowed.handle],
		]);
	});

	test('the mesh calls queue their changes and write the bounds first', () => {
		const { scene, box, ball, paint, row, take } = fakeCore();
		const rock = scene.createMesh({ mesh: box, material: paint });
		expect(row(rock, 'radii')).toEqual([Math.fround(0.87)]);
		take();
		const flags = (flag: number, on: boolean) => [
			C.COMMAND_SET_FLAGS,
			rock.handle,
			flag,
			on ? flag : 0,
		];
		rock.setCastShadows(true);
		rock.setReceiveShadows(true);
		rock.setCastShadows(false);
		rock.setFrustumCulled(false);
		rock.setFrustumCulled(true);
		expect(take()).toEqual([
			flags(C.FLAG_CAST_SHADOWS, true),
			flags(C.FLAG_RECEIVE_SHADOWS, true),
			flags(C.FLAG_CAST_SHADOWS, false),
			flags(C.FLAG_UNCULLED, true),
			flags(C.FLAG_UNCULLED, false),
		]);

		// The order travels as the bits of a 32-bit float.
		rock.setRenderOrder(-2.5);
		const bits = new Uint32Array(new Float32Array([-2.5]).buffer)[0];
		expect(take()).toEqual([[C.COMMAND_SET_RENDER_ORDER, rock.handle, bits as number, 0]]);

		rock.setBounds([0, 1.5, -1], 4);
		expect(row(rock, 'centers')).toEqual([0, 1.5, -1]);
		expect(row(rock, 'radii')).toEqual([4]);
		expect(take()).toEqual([flags(C.FLAG_CUSTOM_BOUNDS, true)]);

		// A new mesh brings its own bounds back.
		rock.setMesh(ball);
		expect(row(rock, 'centers')).toEqual([0, 0, 0]);
		expect(row(rock, 'radii')).toEqual([1.5]);
		expect(take()).toEqual([[C.COMMAND_SET_MESH, rock.handle, ball.id, 0]]);
	});
});

describe('scene.find', () => {
	test('finds the first live object with a name, in the order of creation', () => {
		const { scene } = fakeCore();
		const first = scene.createGroup({ name: 'crate' });
		const second = scene.createGroup({ name: 'crate' });
		const lamp = scene.createGroup({ name: 'lamp' });
		scene.createGroup();
		expect(scene.find('crate')).toBe(first);
		expect(scene.find('lamp')).toBe(lamp);
		expect(scene.find('')).toBeUndefined();
		expect(scene.find('missing')).toBeUndefined();
		first.destroy();
		expect(scene.find('crate')).toBe(second);
		second.destroy();
		lamp.destroy();
		expect(scene.find('crate')).toBeUndefined();
		expect(scene.find('lamp')).toBeUndefined();
		const third = scene.createGroup({ name: 'crate' });
		expect(scene.find('crate')).toBe(third);
	});
});

describe('scene.setBackground', () => {
	/** A texture with `handle` as the engine core's handle. */
	const texture = (handle: number) =>
		new Texture(handle, 4, 4, 1, 'rgba8unorm', 'srgb', 0, undefined as unknown as Textures);

	test('a texture keeps the color, and a color takes the place of a texture', () => {
		const { scene, backgrounds } = fakeCore();
		scene.setBackground('#ff0000');
		scene.setBackground(texture(9));
		expect(backgrounds).toEqual([[1, 0, 0], 0, 9]);
		scene.setBackground([0, 0, 1]);
		expect(backgrounds.slice(3)).toEqual([[0, 0, 1], 0]);
	});

	test('a destroyed texture throws E1101', () => {
		const { scene, backgrounds } = fakeCore();
		expect(thrown(() => scene.setBackground(texture(DESTROYED_TEXTURE))).message).toStartWith(
			`E1101: setBackground() was called on a texture (slot ${DESTROYED_TEXTURE}), which was destroyed in frame ${FRAME}.`,
		);
		expect(backgrounds).toEqual([]);
	});
});

describe('development checks', () => {
	test('every call on a destroyed object throws E1101', () => {
		const { scene, box, paint } = fakeCore();
		const rock = scene.createMesh({ name: 'Rock', mesh: box, material: paint });
		const other = scene.createGroup();
		rock.destroy();
		const out = [0, 0, 0, 0];
		const calls: Record<string, () => void> = {
			setPosition: () => rock.setPosition(1, 2, 3),
			setRotation: () => rock.setRotation(0, 0, 0, 1),
			setRotationEuler: () => rock.setRotationEuler(0, 1, 0),
			setScale: () => rock.setScale(2, 2, 2),
			lookAt: () => rock.lookAt(0, 0, 0),
			setVisible: () => rock.setVisible(false),
			setDynamic: () => rock.setDynamic(true),
			destroy: () => rock.destroy(),
			rotateX: () => rock.rotateX(1),
			rotateY: () => rock.rotateY(1),
			rotateZ: () => rock.rotateZ(1),
			translate: () => rock.translate(1, 0, 0),
			getPosition: () => rock.getPosition(out),
			getRotation: () => rock.getRotation(out),
			getWorldPosition: () => rock.getWorldPosition(out),
			getWorldQuaternion: () => rock.getWorldQuaternion(out),
			getWorldMatrix: () => rock.getWorldMatrix([]),
			setParent: () => rock.setParent(other, { keepWorld: true }),
			setMaterial: () => rock.setMaterial(paint),
			setMesh: () => rock.setMesh(box),
			setCastShadows: () => rock.setCastShadows(true),
			setReceiveShadows: () => rock.setReceiveShadows(true),
			setRenderOrder: () => rock.setRenderOrder(1),
			setFrustumCulled: () => rock.setFrustumCulled(false),
			setBounds: () => rock.setBounds([0, 0, 0], 1),
		};
		for (const [name, call] of Object.entries(calls)) {
			const error = thrown(call);
			expect(error.code).toBe('E1101');
			expect(error.message).toStartWith(
				`E1101: ${name}() was called on "Rock" (slot ${rock.slot}), which was destroyed in frame ${FRAME}.`,
			);
		}
		const camera = scene.createPerspectiveCamera();
		camera.destroy();
		expect(thrown(() => camera.setFov(40)).code).toBe('E1101');
		expect(thrown(() => camera.setNearFar(0.5, 50)).code).toBe('E1101');
	});

	test('a parent must live, belong to this engine and differ from the object', () => {
		const { scene } = fakeCore();
		const arm = scene.createGroup({ name: 'Arm' });
		const hand = scene.createGroup({ name: 'Hand' });
		const stranger = fakeCore().scene.createGroup({ name: 'Stranger' });
		expect(thrown(() => hand.setParent(hand)).message).toStartWith(
			`E1104: setParent() would put "Hand" (slot ${hand.slot}) under itself.`,
		);
		expect(thrown(() => hand.setParent(stranger)).message).toStartWith(
			`E1103: setParent() got "Stranger" (slot ${stranger.slot}), which is not from this engine.`,
		);
		arm.destroy();
		expect(thrown(() => hand.setParent(arm)).message).toStartWith(
			`E1101: setParent() got "Arm" (slot ${arm.slot}), which was destroyed in frame ${FRAME}.`,
		);
		expect(thrown(() => scene.createGroup({ parent: arm })).code).toBe('E1101');
	});

	test('numbers must be finite, and a radius must not be negative', () => {
		const { scene, box, paint } = fakeCore();
		const rock = scene.createMesh({ name: 'Rock', mesh: box, material: paint });
		const where = `on "Rock" (slot ${rock.slot})`;
		expect(thrown(() => rock.rotateY(Number.NaN)).message).toStartWith(
			`E1203: rotateY() got NaN for angle ${where}.`,
		);
		expect(thrown(() => rock.translate(0, Number.POSITIVE_INFINITY, 0)).message).toStartWith(
			`E1203: translate() got Infinity for y ${where}.`,
		);
		expect(thrown(() => rock.setRenderOrder(Number.NaN)).code).toBe('E1203');
		expect(thrown(() => rock.setBounds([0, Number.NaN, 0], 1)).code).toBe('E1203');
		expect(thrown(() => rock.setBounds([0, 0, 0], Number.NaN)).code).toBe('E1203');
		expect(thrown(() => rock.setBounds([0, 0, 0], -1)).message).toStartWith(
			`E1108: setBounds() got the radius -1 ${where}, below 0.`,
		);
	});

	test('meshes and materials must come from this engine', () => {
		const { scene, box, paint } = fakeCore();
		const other = fakeCore();
		const rock = scene.createMesh({ mesh: box, material: paint });
		expect(thrown(() => rock.setMesh(other.box)).message).toStartWith(
			'E1103: setMesh() got a mesh that is not from this engine.',
		);
		expect(thrown(() => rock.setMaterial(other.paint)).message).toStartWith(
			'E1103: setMaterial() got a material that is not from this engine.',
		);
		expect(thrown(() => scene.createMesh({ mesh: other.box, material: paint })).code).toBe('E1103');
		expect(thrown(() => scene.createMesh({ mesh: box, material: other.paint })).code).toBe('E1103');
	});

	test('a world getter on an object that the frame removed throws in every build', () => {
		const { scene } = fakeCore();
		const gone = scene.createGroup({ name: 'Gone' });
		// The core no longer knows the object, as after the frame that destroyed it.
		expect(thrown(() => gone.getWorldMatrix([])).message).toStartWith(
			`E1101: getWorldMatrix() was called on "Gone" (slot ${gone.slot}), which was destroyed in frame ${FRAME}.`,
		);
	});
});

describe('screenToRay and worldToScreen', () => {
	/** A canvas of 640 x 360 CSS pixels at a pixel ratio of 2. */
	const CSS = [640, 360] as const;
	const setup = () => {
		const core = fakeCore();
		core.setCanvas(CSS[0] * 2, CSS[1] * 2, CSS[0], CSS[1]);
		return core;
	};
	const world = (position: [number, number, number], euler: [number, number, number], scale = 1) =>
		new Matrix4().compose(
			new Vector3(...position),
			new Quaternion().setFromEuler(new ThreeObject().rotation.set(...euler)),
			new Vector3(scale, scale, scale),
		);
	/** three.js's ray through the point, from a camera whose matrices `world` places. */
	const threeRay = (
		camera: ThreePerspectiveCamera | ThreeOrthographicCamera,
		matrix: Matrix4,
		x: number,
		y: number,
	) => {
		camera.matrixWorld.copy(matrix);
		camera.matrixWorldInverse.copy(matrix).invert();
		camera.updateProjectionMatrix();
		const caster = new Raycaster();
		caster.setFromCamera(new Vector2((x / CSS[0]) * 2 - 1, 1 - (y / CSS[1]) * 2), camera);
		return [...caster.ray.origin.toArray(), ...caster.ray.direction.toArray()];
	};
	const rayOf = (ray: { origin: number[]; direction: number[] }) => [
		...ray.origin,
		...ray.direction,
	];
	const newRay = () => ({ origin: [0, 0, 0], direction: [0, 0, 0] });
	const POINTS = [
		[320, 180],
		[0, 0],
		[640, 360],
		[17.5, 301.25],
	] as const;

	test('a perspective ray matches three.js, scaled cameras included', () => {
		const { scene, setWorld } = setup();
		const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.5, far: 300 });
		const theirs = new ThreePerspectiveCamera(60, CSS[0] / CSS[1], 0.5, 300);
		const ray = newRay();
		for (const scale of [1, 2.5]) {
			const matrix = world([3, -2, 7], [0.3, -1.2, 0.1], scale);
			setWorld(camera, matrix);
			for (const [x, y] of POINTS) {
				camera.screenToRay(x, y, ray);
				expectClose(rayOf(ray), threeRay(theirs, matrix, x, y), 9);
			}
		}
	});

	test("an orthographic ray has three.js's direction, and starts on the near plane", () => {
		const { scene, setWorld } = setup();
		const matrix = world([-4, 9, 2], [-0.7, 0.4, 0.2]);
		const ray = newRay();
		// A view made from edges keeps them; a view made from a height follows the canvas.
		const edges = scene.createOrthographicCamera({
			left: -3,
			right: 5,
			top: 2,
			bottom: -4,
			near: -2,
		});
		setWorld(edges, matrix);
		const theirEdges = new ThreeOrthographicCamera(-3, 5, 2, -4, -2, 2000);
		const tall = scene.createOrthographicCamera({ height: 10, near: 1, far: 50 });
		setWorld(tall, matrix);
		const half = (10 * CSS[0]) / CSS[1] / 2;
		const theirTall = new ThreeOrthographicCamera(-half, half, 5, -5, 1, 50);
		// three.js starts the ray on the camera's plane, which misses what a near plane behind the
		// camera shows: the engine starts it `near` further along.
		const onNear = (ray: number[], near: number) => [
			...[0, 1, 2].map((k) => (ray[k] as number) + near * (ray[3 + k] as number)),
			...ray.slice(3),
		];
		for (const [x, y] of POINTS) {
			edges.screenToRay(x, y, ray);
			expectClose(rayOf(ray), onNear(threeRay(theirEdges, matrix, x, y), -2), 9);
			tall.screenToRay(x, y, ray);
			expectClose(rayOf(ray), onNear(threeRay(theirTall, matrix, x, y), 1), 9);
		}
	});

	test('the lens takes the shape of the canvas in device pixels, as the frame draws it', () => {
		const { scene, setWorld, setCanvas } = setup();
		// 401 x 200 device pixels show on 200 x 100 CSS pixels: a shape a little wider than 2.
		setCanvas(401, 200, CSS[0], CSS[1]);
		const camera = scene.createPerspectiveCamera({ fov: 45 });
		const matrix = world([1, 2, 3], [0.2, 0.5, 0]);
		setWorld(camera, matrix);
		const ray = newRay();
		camera.screenToRay(600, 40, ray);
		const theirs = new ThreePerspectiveCamera(45, 401 / 200, 0.1, 2000);
		expectClose(rayOf(ray), threeRay(theirs, matrix, 600, 40), 9);
	});

	test('worldToScreen matches three.js project, and inverts screenToRay', () => {
		const { scene, setWorld } = setup();
		const matrix = world([2, 1, 10], [-0.2, 0.3, 0.05]);
		const perspective = scene.createPerspectiveCamera({ fov: 50 });
		const orthographic = scene.createOrthographicCamera({ height: 8 });
		setWorld(perspective, matrix);
		setWorld(orthographic, matrix);
		const half = (8 * CSS[0]) / CSS[1] / 2;
		const pairs = [
			[perspective, new ThreePerspectiveCamera(50, CSS[0] / CSS[1], 0.1, 2000)],
			[orthographic, new ThreeOrthographicCamera(-half, half, 4, -4, 0.1, 2000)],
		] as const;
		const out = [0, 0, 0];
		const ray = newRay();
		for (const [mine, theirs] of pairs) {
			theirs.matrixWorld.copy(matrix);
			theirs.matrixWorldInverse.copy(matrix).invert();
			theirs.updateProjectionMatrix();
			for (const point of [
				[1, 2, 3],
				[-2.5, 0.5, -4],
			]) {
				mine.worldToScreen(point, out);
				const ndc = new Vector3(...point).project(theirs);
				const depth = -new Vector3(...point).applyMatrix4(theirs.matrixWorldInverse).z;
				expectClose(out, [((ndc.x + 1) / 2) * CSS[0], ((1 - ndc.y) / 2) * CSS[1], depth], 7);
				// The ray through the point's place on the canvas passes through the point.
				mine.screenToRay(out[0] as number, out[1] as number, ray);
				const along = new Vector3(...point).sub(new Vector3(...ray.origin));
				const across = along.clone().cross(new Vector3(...ray.direction));
				expect(across.length()).toBeLessThan(1e-9);
			}
		}
	});

	test('worldToScreen keeps its precision far from the origin', () => {
		const { scene, setWorld } = setup();
		const camera = scene.createPerspectiveCamera({ fov: 90 });
		// 6,378 km out, where a 32-bit float steps by half a meter.
		setWorld(camera, new Matrix4().makeTranslation(6_378_000.25, 0, 0));
		const out = [0, 0, 0];
		camera.worldToScreen([6_378_000.25 + 0.01, 0, -10], out);
		// At 90 degrees, 10 m away the view is 20 m tall and 20 * 16 / 9 m wide.
		expectClose(out, [320 + (0.01 / ((20 * 16) / 9)) * 640, 180, 10], 6);
	});

	test('a ray from an input event uses the camera of the frame that the event names', () => {
		const { scene, setWorld, eventFrames } = setup();
		const camera = scene.createPerspectiveCamera({ fov: 60 });
		const other = scene.createPerspectiveCamera({ fov: 60 });
		scene.setActiveCamera(camera);
		const theirs = new ThreePerspectiveCamera(60, CSS[0] / CSS[1], 0.1, 2000);
		// A fast pan: each frame turns the camera a tenth of a radian further.
		const frameWorld = (frame: number) => world([0, 1, 5], [0, frame * 0.1, 0]);
		for (let frame = 1; frame <= 5; frame++) {
			setWorld(camera, frameWorld(frame));
			scene.keepFrameCamera(frame, CSS[0] * 2, CSS[1] * 2);
		}
		setWorld(camera, frameWorld(6));
		setWorld(other, frameWorld(6));
		const ray = newRay();
		const [x, y] = [100.5, 80.25];
		// An event that came while frame 3 was on screen.
		eventFrames.set(`${x},${y}`, 3);
		camera.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(3), x, y), 9);
		// Another point, or another camera, uses the camera as it stands.
		camera.screenToRay(x + 1, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(6), x + 1, y), 9);
		other.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(6), x, y), 9);
		// The ring keeps four frames: frame 1's place now holds frame 5.
		eventFrames.set(`${x},${y}`, 1);
		camera.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(6), x, y), 9);
		// A frame drawn from another camera does not lend its camera to this one.
		scene.setActiveCamera(other);
		setWorld(other, frameWorld(7));
		scene.keepFrameCamera(7, CSS[0] * 2, CSS[1] * 2);
		eventFrames.set(`${x},${y}`, 7);
		camera.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(6), x, y), 9);
		other.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(7), x, y), 9);
	});

	test("a ray from an input event during the setup's frames uses the setup's camera", () => {
		const { scene, setWorld, eventFrames } = setup();
		const camera = scene.createPerspectiveCamera({ fov: 60 });
		scene.setActiveCamera(camera);
		const theirs = new ThreePerspectiveCamera(60, CSS[0] / CSS[1], 0.1, 2000);
		const frameWorld = (frame: number) => world([0, 1, 5], [0, frame * 0.1, 0]);
		const ray = newRay();
		const [x, y] = [100.5, 80.25];
		// Frame 0 names a frame of the setup, so the ring must not mistake an empty entry for it.
		eventFrames.set(`${x},${y}`, 0);
		setWorld(camera, frameWorld(0));
		camera.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(0), x, y), 9);
		scene.keepFrameCamera(0, CSS[0] * 2, CSS[1] * 2);
		// The sketch's first frames turn the camera while the setup's frame is still on screen.
		for (let frame = 1; frame <= 2; frame++) {
			setWorld(camera, frameWorld(frame));
			scene.keepFrameCamera(frame, CSS[0] * 2, CSS[1] * 2);
		}
		camera.screenToRay(x, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(0), x, y), 9);
		camera.screenToRay(x + 1, y, ray);
		expectClose(rayOf(ray), threeRay(theirs, frameWorld(2), x + 1, y), 9);
	});

	test('development builds check the point and the camera', () => {
		const { scene, setWorld } = setup();
		const camera = scene.createPerspectiveCamera();
		setWorld(camera, new Matrix4());
		expect(thrown(() => camera.screenToRay(Number.NaN, 0, newRay())).message).toContain(
			'screenToRay() got NaN for x',
		);
		expect(thrown(() => camera.worldToScreen([0, Infinity, 0], [0, 0, 0])).message).toContain(
			'worldToScreen() got Infinity for y',
		);
	});
});
