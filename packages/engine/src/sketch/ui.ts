// The sketch's labels: each one follows a scene object, and the page moves an HTML element to it.
// After each frame records, the sketch thread places every label with the frame's camera and writes
// it into the table of the frame's parity (shared/labels.ts). The thread that draws copies that
// table when it presents the frame, so the page places each element where the frame on screen drew
// the object. A label's id goes to the page once, with its slot in the table, so no message goes per
// frame. A slot's generation changes each time it passes to another label, so the page never places
// an element from the slot's earlier label. The projection allocates nothing: every number lives in
// typed arrays made once.
//
// A screen label is a place on the canvas, which the page puts an element on. A label that is a
// plane of the scene is the world matrix of an element that CSS turns with the scene's own
// perspective: the matrix turns and scales with the object, or with the camera when the element
// faces it. Both kinds share the frame's parity rule, so an element follows the frame on screen.

import { checkLive, checkVector, DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { FLAG_VISIBLE } from '../generated/core';
import type { Vec3Like } from '../math/types';
import {
	type FrameCameras,
	projectPoint,
	VIEW_CENTER_X,
	VIEW_CENTER_Y,
	VIEW_FAR,
	VIEW_FLOATS,
	VIEW_NEAR,
	VIEW_ORTHO,
	VIEW_SCALE_Y,
} from '../scene/frame-cameras';
import type { CoreMemory } from '../scene/memory';
import type { Object3D, Scene } from '../scene/scene';
import {
	CAMERA_CENTER_X,
	CAMERA_CENTER_Y,
	CAMERA_HALF_HEIGHT,
	CAMERA_ORTHO,
	GENERATION_SHIFT,
	LABEL_DEPTH,
	LABEL_SHOWN,
	LABEL_STATE,
	LABEL_WORDS,
	LABEL_X,
	LABEL_Y,
	LABEL3D_MATRIX,
	LABEL3D_STATE,
	LABEL3D_WORDS,
	type LabelRegion,
	parityTable,
	parityTable3d,
	setParityCount,
	setParityCount3d,
	TABLE_3D,
	TABLE_SCREEN,
} from '../shared/labels';

/**
 * How a label's element sits in the scene.
 *
 * - `'screen'` keeps the element flat on the screen at the label's place, always the same size, as
 *   three.js's `CSS2DRenderer` does.
 * - `'world'` makes the element a plane of the scene: it turns and scales with the object, as
 *   three.js's `CSS3DObject` does.
 * - `'billboard'` makes the element a plane of the scene that always faces the camera, as
 *   three.js's `CSS3DSprite` does.
 *
 * @category api/ui
 */
export type LabelTransform = 'screen' | 'world' | 'billboard';

/**
 * Options for `ui.trackLabel`.
 *
 * @category api/ui
 */
export interface LabelOptions {
	/**
	 * Where the label sits relative to the object, in the object's own space, so the offset turns
	 * and scales with it. The default is the object's origin, `[0, 0, 0]`.
	 */
	offset?: Vec3Like;
	/** How the element sits in the scene. The default is `'screen'`. */
	transform?: LabelTransform;
	/**
	 * The element's turn in its own plane, in radians, for `'billboard'`. It turns the content of the
	 * element, as three.js's `CSS3DSprite` `rotation2D` does.
	 */
	rotation?: number;
}

/** Tells the page which table and slot a label's id has, or that the id has none (-1). */
export type LabelSlotSender = (id: string, table: number, slot: number, generation: number) => void;

const GENERATIONS = 1 << 16;
/** The three transform modes, as the label's own tables number them. */
const SCREEN = 0;
const WORLD = 1;
const BILLBOARD = 2;
/** The numbers of an element's world matrix, row by row: three rows of four. */
const MATRIX_FLOATS = 12;

/**
 * HTML labels that follow scene objects. The sketch tracks a label on an object under an id, and the
 * page binds an HTML element to the same id with `engine.labels.bind`. The engine then moves the
 * element over the object in each frame on screen, with no message per frame.
 *
 * @category api/ui
 */
export class Ui {
	/** The slot of each screen label's id, and of each 3D label's, in its own table. */
	private readonly slots = new Map<string, number>();
	private readonly slots3d = new Map<string, number>();
	/** The id, object and offset of each screen label's slot, and its generation. */
	private readonly ids: (string | undefined)[] = [];
	private readonly objects: (Object3D | undefined)[] = [];
	private readonly offsets: Float64Array;
	private readonly generations: Uint16Array;
	/** Slots that labels used and gave back, which new labels take first. */
	private readonly freeSlots: Int32Array;
	private freeCount = 0;
	/** The slots in use or used before: every slot below it is written each frame. */
	private used = 0;
	/** The same for the 3D labels, which also hold each label's turn and whether it faces the camera. */
	private readonly ids3d: (string | undefined)[] = [];
	private readonly objects3d: (Object3D | undefined)[] = [];
	private readonly offsets3d: Float64Array;
	private readonly turns: Float64Array;
	private readonly billboards: Uint8Array;
	private readonly generations3d: Uint16Array;
	private readonly freeSlots3d: Int32Array;
	private freeCount3d = 0;
	private used3d = 0;
	/** @internal The engine's number of the frame that `project` placed last, for tests. */
	frame = 0;
	private readonly matrix = new Float64Array(MATRIX_FLOATS);
	private readonly view = new Float64Array(VIEW_FLOATS);
	private readonly anchor = new Float64Array(3);
	private readonly projected = new Float64Array(3);

	/** @internal */
	constructor(
		private readonly region: LabelRegion | undefined,
		private readonly scene: Scene,
		private readonly core: CoreMemory,
		private readonly cameras: FrameCameras,
		private readonly sendSlot: LabelSlotSender,
	) {
		const capacity = region?.capacity ?? 0;
		this.offsets = new Float64Array(capacity * 3);
		this.generations = new Uint16Array(capacity);
		this.freeSlots = new Int32Array(capacity);
		const capacity3d = region?.capacity3d ?? 0;
		this.offsets3d = new Float64Array(capacity3d * 3);
		this.turns = new Float64Array(capacity3d);
		this.billboards = new Uint8Array(capacity3d);
		this.generations3d = new Uint16Array(capacity3d);
		this.freeSlots3d = new Int32Array(capacity3d);
	}

	/**
	 * Tracks a label on `object` under `id`, from this frame on: the element that the page binds to
	 * the same id with `engine.labels.bind` then follows the object. Tracking an id again moves its
	 * label to the new object, offset and transform. A label stops when the sketch untracks it or
	 * destroys its object. The engine holds the number of labels that `createEngine`'s `maxLabels`
	 * option gives, 4,096 by default, and one more fails with E1219. A label whose transform is not
	 * `'screen'` takes a slot in the engine's 3D labels instead, which `maxLabels3d` holds.
	 */
	trackLabel(object: Object3D, id: string, options?: LabelOptions): void {
		const transform = readTransform(options);
		if (DEV) {
			checkId('trackLabel', id);
			checkLive('trackLabel', object, true);
			if (object.scene !== this.scene)
				throw new EngineError('E1103', 'trackLabel() got an object that is not from this engine.');
			const offset = options?.offset;
			if (offset)
				checkVector(
					'trackLabel',
					object,
					offset[0] as number,
					offset[1] as number,
					offset[2] as number,
				);
		}
		const offset = options?.offset;
		const ox = (offset?.[0] as number | undefined) ?? 0;
		const oy = (offset?.[1] as number | undefined) ?? 0;
		const oz = (offset?.[2] as number | undefined) ?? 0;
		// A label that changes how it sits gives its slot in the other table back.
		const other = transform === SCREEN ? this.slots3d.get(id) : this.slots.get(id);
		if (other !== undefined) {
			if (transform === SCREEN) this.release3d(other);
			else this.release(other);
		}
		if (transform === SCREEN) {
			const slot = this.slotOf(id, TABLE_SCREEN);
			this.objects[slot] = object;
			const at = slot * 3;
			this.offsets[at] = ox;
			this.offsets[at + 1] = oy;
			this.offsets[at + 2] = oz;
			return;
		}
		const slot = this.slotOf(id, TABLE_3D);
		this.objects3d[slot] = object;
		const at = slot * 3;
		this.offsets3d[at] = ox;
		this.offsets3d[at + 1] = oy;
		this.offsets3d[at + 2] = oz;
		this.turns[slot] = options?.rotation ?? 0;
		this.billboards[slot] = transform === BILLBOARD ? 1 : 0;
	}

	/** Stops the label with `id`, which the page then hides. An id that is not tracked does nothing. */
	untrackLabel(id: string): void {
		if (DEV) checkId('untrackLabel', id);
		const slot = this.slots.get(id);
		if (slot !== undefined) this.release(slot);
		const slot3d = this.slots3d.get(id);
		if (slot3d !== undefined) this.release3d(slot3d);
	}

	/**
	 * @internal Places every label with the frame's camera into the table of frame `frame`'s parity,
	 * on a canvas of `width` by `height` device pixels. A label is shown when its object and the
	 * object's ancestors are visible, the camera draws a layer of the object, and the label's anchor
	 * lies between the camera's near and far planes, as three.js's CSS2DRenderer shows its labels.
	 */
	project(frame: number, width: number, height: number): void {
		const region = this.region;
		if (region === undefined) return;
		const parity = frame & 1;
		const table = parityTable(region, parity);
		const table3d = parityTable3d(region, parity);
		const { ints, floats } = region;
		const { objects, offsets, generations, matrix, view, anchor, projected, core } = this;
		const used = this.used;
		const used3d = this.used3d;
		const camera = this.scene.shownCamera;
		const viewing = camera !== undefined && this.cameras.viewOf(camera, width, height, view);
		if (viewing && region.capacity3d > 0) writeCamera(region, parity, view);
		const layers = camera?.layers ?? 0;
		const near = view[VIEW_NEAR] as number;
		const far = view[VIEW_FAR] as number;
		for (let slot = 0; slot < used; slot++) {
			const at = table + slot * LABEL_WORDS;
			let state = (generations[slot] as number) << GENERATION_SHIFT;
			const object = objects[slot];
			if (object !== undefined && object.destroyedFrame !== -1) {
				this.release(slot);
				state = (generations[slot] as number) << GENERATION_SHIFT;
			} else if (
				viewing &&
				object !== undefined &&
				object.layerMask & layers &&
				shownWithAncestors(object) &&
				core.readWorldMatrix(object.handle, matrix) === 0
			) {
				const o = slot * 3;
				anchorPoint(
					matrix,
					offsets[o] as number,
					offsets[o + 1] as number,
					offsets[o + 2] as number,
					anchor,
				);
				projectPoint(view, anchor, projected);
				const depth = projected[2] as number;
				floats[at + LABEL_X] = projected[0] as number;
				floats[at + LABEL_Y] = projected[1] as number;
				floats[at + LABEL_DEPTH] = depth;
				if (depth >= near && depth <= far) state |= LABEL_SHOWN;
			}
			ints[at + LABEL_STATE] = state;
		}
		const { objects3d, offsets3d, generations3d } = this;
		for (let slot = 0; slot < used3d; slot++) {
			const at = table3d + slot * LABEL3D_WORDS;
			let state = (generations3d[slot] as number) << GENERATION_SHIFT;
			const object = objects3d[slot];
			if (object !== undefined && object.destroyedFrame !== -1) {
				this.release3d(slot);
				state = (generations3d[slot] as number) << GENERATION_SHIFT;
			} else if (
				viewing &&
				object !== undefined &&
				object.layerMask & layers &&
				shownWithAncestors(object) &&
				core.readWorldMatrix(object.handle, matrix) === 0
			) {
				const o = slot * 3;
				anchorPoint(
					matrix,
					offsets3d[o] as number,
					offsets3d[o + 1] as number,
					offsets3d[o + 2] as number,
					anchor,
				);
				projectPoint(view, anchor, projected);
				const depth = projected[2] as number;
				if (depth >= near && depth <= far) {
					state |= LABEL_SHOWN;
					this.writeMatrix(slot, at, matrix, anchor, floats);
				}
			}
			ints[at + LABEL3D_STATE] = state;
		}
		setParityCount(region, parity, used);
		setParityCount3d(region, parity, used3d);
		this.frame = frame;
	}

	/** Writes the twelve numbers of a 3D label's element matrix, and its anchor. */
	private writeMatrix(
		slot: number,
		at: number,
		m: Float64Array,
		anchor: Float64Array,
		out: Float32Array,
	): void {
		const base = at + LABEL3D_MATRIX;
		if (this.billboards[slot] === 0) {
			for (let row = 0; row < 3; row++) {
				const r = row * 4;
				out[base + r] = m[r] as number;
				out[base + r + 1] = m[r + 1] as number;
				out[base + r + 2] = m[r + 2] as number;
				out[base + r + 3] = anchor[row] as number;
			}
			return;
		}
		// The element faces the camera: its axes are the camera's own, turned in its plane by the
		// label's rotation, and scaled by the object's. The view's rows are the camera's axes in the
		// world, because the view turns the world into the camera's own frame.
		const view = this.view;
		const x0 = view[0] as number;
		const x1 = view[1] as number;
		const x2 = view[2] as number;
		const y0 = view[3] as number;
		const y1 = view[4] as number;
		const y2 = view[5] as number;
		const z0 = view[6] as number;
		const z1 = view[7] as number;
		const z2 = view[8] as number;
		const turn = this.turns[slot] as number;
		const cos = Math.cos(turn);
		const sin = Math.sin(turn);
		const sx = Math.hypot(m[0] as number, m[4] as number, m[8] as number);
		const sy = Math.hypot(m[1] as number, m[5] as number, m[9] as number);
		const sz = Math.hypot(m[2] as number, m[6] as number, m[10] as number);
		// Column by column: the camera's x axis turned, the camera's y axis turned, and its z axis.
		const c0x = (cos * x0 + sin * y0) * sx;
		const c0y = (cos * x1 + sin * y1) * sx;
		const c0z = (cos * x2 + sin * y2) * sx;
		const c1x = (cos * y0 - sin * x0) * sy;
		const c1y = (cos * y1 - sin * x1) * sy;
		const c1z = (cos * y2 - sin * x2) * sy;
		const c2x = z0 * sz;
		const c2y = z1 * sz;
		const c2z = z2 * sz;
		out[base] = c0x;
		out[base + 1] = c1x;
		out[base + 2] = c2x;
		out[base + 3] = anchor[0] as number;
		out[base + 4] = c0y;
		out[base + 5] = c1y;
		out[base + 6] = c2y;
		out[base + 7] = anchor[1] as number;
		out[base + 8] = c0z;
		out[base + 9] = c1z;
		out[base + 10] = c2z;
		out[base + 11] = anchor[2] as number;
	}

	/** The slot that `id` holds in the table of its kind, which it takes when it has none there. */
	private slotOf(id: string, table: number): number {
		const three = table === TABLE_3D;
		const slots = three ? this.slots3d : this.slots;
		const existing = slots.get(id);
		if (existing !== undefined) return existing;
		const capacity = three ? (this.region?.capacity3d ?? 0) : (this.region?.capacity ?? 0);
		const free = three ? this.freeSlots3d : this.freeSlots;
		const freeCount = three ? this.freeCount3d : this.freeCount;
		let slot: number;
		if (freeCount > 0) {
			slot = free[freeCount - 1] as number;
			if (three) this.freeCount3d = freeCount - 1;
			else this.freeCount = freeCount - 1;
		} else {
			slot = three ? this.used3d : this.used;
			if (slot >= capacity)
				throw new EngineError(
					'E1219',
					three
						? `trackLabel() could not track "${id}": the engine already tracks ${capacity} labels of the scene. Raise createEngine()'s maxLabels3d option for more.`
						: `trackLabel() could not track "${id}": the engine already tracks ${capacity} labels. Raise createEngine()'s maxLabels option for more.`,
				);
			if (three) this.used3d = slot + 1;
			else this.used = slot + 1;
		}
		slots.set(id, slot);
		if (three) {
			this.ids3d[slot] = id;
			this.sendSlot(id, TABLE_3D, slot, this.generations3d[slot] as number);
		} else {
			this.ids[slot] = id;
			this.sendSlot(id, TABLE_SCREEN, slot, this.generations[slot] as number);
		}
		return slot;
	}

	/** Gives a screen label's slot back, under a new generation, and tells the page that its id has none. */
	private release(slot: number): void {
		const id = this.ids[slot] as string;
		this.slots.delete(id);
		this.ids[slot] = undefined;
		this.objects[slot] = undefined;
		this.generations[slot] = ((this.generations[slot] as number) + 1) % GENERATIONS;
		this.freeSlots[this.freeCount++] = slot;
		this.sendSlot(id, TABLE_SCREEN, -1, 0);
	}

	/** The same for a 3D label. */
	private release3d(slot: number): void {
		const id = this.ids3d[slot] as string;
		this.slots3d.delete(id);
		this.ids3d[slot] = undefined;
		this.objects3d[slot] = undefined;
		this.generations3d[slot] = ((this.generations3d[slot] as number) + 1) % GENERATIONS;
		this.freeSlots3d[this.freeCount3d++] = slot;
		this.sendSlot(id, TABLE_3D, -1, 0);
	}
}

/** The transform mode that `options` asks for, or E1219 for one the engine does not have. */
function readTransform(options: LabelOptions | undefined): number {
	const transform = options?.transform ?? 'screen';
	const rotation = options?.rotation;
	if (rotation !== undefined && (typeof rotation !== 'number' || !Number.isFinite(rotation)))
		throw new EngineError(
			'E1219',
			`trackLabel() got ${String(rotation)} as a label's rotation, which is not a number in radians.`,
		);
	if (transform === 'screen') {
		if (rotation !== undefined)
			throw new EngineError(
				'E1219',
				"trackLabel() got a rotation for a label whose transform is 'screen'. Set transform: 'billboard' to turn the element's content.",
			);
		return SCREEN;
	}
	if (transform === 'world') return WORLD;
	if (transform === 'billboard') return BILLBOARD;
	throw new EngineError(
		'E1219',
		`trackLabel() got the transform ${String(transform)}, which is not 'screen', 'world' or 'billboard'.`,
	);
}

/** Writes the world matrix's application to the offset into `out`. */
function anchorPoint(m: Float64Array, ox: number, oy: number, oz: number, out: Float64Array): void {
	for (let row = 0; row < 3; row++) {
		const r = row * 4;
		out[row] =
			(m[r] as number) * ox +
			(m[r + 1] as number) * oy +
			(m[r + 2] as number) * oz +
			(m[r + 3] as number);
	}
}

/** Writes the frame's camera into the record that the thread that draws presents with the labels. */
function writeCamera(region: LabelRegion, parity: number, view: Float64Array): void {
	const record = region.parityCameras[parity] as Float32Array;
	// The view's rotation rows and the camera's position, then the lens that the page projects with.
	for (let k = 0; k < CAMERA_HALF_HEIGHT; k++) record[k] = view[k] as number;
	record[CAMERA_HALF_HEIGHT] = view[VIEW_SCALE_Y] as number;
	record[CAMERA_ORTHO] = view[VIEW_ORTHO] as number;
	record[CAMERA_CENTER_X] = view[VIEW_CENTER_X] as number;
	record[CAMERA_CENTER_Y] = view[VIEW_CENTER_Y] as number;
}

/** True when `object` and every ancestor it has are visible. */
function shownWithAncestors(object: Object3D): boolean {
	for (let o: Object3D | null = object; o !== null; o = o.liveParent)
		if ((o.flags & FLAG_VISIBLE) === 0) return false;
	return true;
}

/** Throws E1219 when a label's id is not a string with at least one character. */
function checkId(call: string, id: string): void {
	if (typeof id === 'string' && id.length > 0) return;
	throw new EngineError(
		'E1219',
		`${call}() got ${typeof id === 'string' ? 'an empty string' : String(id)} as a label's id.`,
	);
}
