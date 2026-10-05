// The sketch's labels: each one follows a scene object, and the page moves an HTML element to it.
// After each frame records, the sketch thread projects every label's anchor (the object's world
// matrix applied to the label's offset) with the frame's camera, as `worldToScreen` does, and
// writes it into the label table of the frame's parity (shared/labels.ts). The thread that draws
// copies that table when it presents the frame, so the page places each element where the frame on
// screen drew the object. A label's id goes to the page once, with its slot in the table, so no
// message goes per frame. A slot's generation changes each time it passes to another label, so
// the page never places an element from the slot's earlier label. The projection allocates
// nothing: every number lives in typed arrays made once.

import { checkLive, checkVector, DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { FLAG_VISIBLE } from '../generated/core';
import type { Vec3Like } from '../math/types';
import {
	type FrameCameras,
	projectPoint,
	VIEW_FAR,
	VIEW_FLOATS,
	VIEW_NEAR,
} from '../scene/frame-cameras';
import type { CoreMemory } from '../scene/memory';
import type { Object3D, Scene } from '../scene/scene';
import {
	GENERATION_SHIFT,
	LABEL_DEPTH,
	LABEL_SHOWN,
	LABEL_STATE,
	LABEL_WORDS,
	LABEL_X,
	LABEL_Y,
	type LabelRegion,
	parityTable,
	setParityCount,
} from '../shared/labels';

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
}

/** Tells the page which slot of the label table a label's id has, or that the id has none (-1). */
export type LabelSlotSender = (id: string, slot: number, generation: number) => void;

const GENERATIONS = 1 << 16;

/**
 * HTML labels that follow scene objects. The sketch tracks a label on an object under an id, and the
 * page binds an HTML element to the same id with `engine.labels.bind`. The engine then moves the
 * element over the object in each frame on screen, with no message per frame.
 *
 * @category api/ui
 */
export class Ui {
	/** The slot of each tracked id. */
	private readonly slots = new Map<string, number>();
	/** The id, object and offset of each slot, and its generation. */
	private readonly ids: (string | undefined)[] = [];
	private readonly objects: (Object3D | undefined)[] = [];
	private readonly offsets: Float64Array;
	private readonly generations: Uint16Array;
	/** Slots that labels used and gave back, which new labels take first. */
	private readonly freeSlots: Int32Array;
	private freeCount = 0;
	/** The slots in use or used before: every slot below it is written each frame. */
	private used = 0;
	/** @internal The engine's number of the frame that `project` placed last, for tests. */
	frame = 0;
	private readonly matrix = new Float64Array(12);
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
	}

	/**
	 * Tracks a label on `object` under `id`, from this frame on: the element that the page binds to
	 * the same id with `engine.labels.bind` then follows the object. Tracking an id again moves its
	 * label to the new object and offset. A label stops when the sketch untracks it or destroys its
	 * object. The engine holds the number of labels that `createEngine`'s `maxLabels` option gives,
	 * 4,096 by default, and one more fails with E1219.
	 */
	trackLabel(object: Object3D, id: string, options?: LabelOptions): void {
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
		let slot = this.slots.get(id);
		if (slot === undefined) {
			slot = this.takeSlot(id);
			this.slots.set(id, slot);
			this.ids[slot] = id;
			this.sendSlot(id, slot, this.generations[slot] as number);
		}
		this.objects[slot] = object;
		const offset = options?.offset;
		const at = slot * 3;
		this.offsets[at] = (offset?.[0] as number | undefined) ?? 0;
		this.offsets[at + 1] = (offset?.[1] as number | undefined) ?? 0;
		this.offsets[at + 2] = (offset?.[2] as number | undefined) ?? 0;
	}

	/** Stops the label with `id`, which the page then hides. An id that is not tracked does nothing. */
	untrackLabel(id: string): void {
		if (DEV) checkId('untrackLabel', id);
		const slot = this.slots.get(id);
		if (slot !== undefined) this.release(slot);
	}

	/**
	 * @internal Projects every label with the frame's camera into the table of frame `frame`'s
	 * parity, on a canvas of `width` by `height` device pixels. A label is shown when its object
	 * and the object's ancestors are visible, the camera draws a layer of the object, and the
	 * anchor lies between the camera's near and far planes, as three.js's `CSS2DRenderer` shows
	 * its labels.
	 */
	project(frame: number, width: number, height: number): void {
		const region = this.region;
		if (region === undefined) return;
		const parity = frame & 1;
		const used = this.used;
		if (used > 0) {
			const table = parityTable(region, parity);
			const { ints, floats } = region;
			const { objects, offsets, generations, matrix, view, anchor, projected, core } = this;
			const camera = this.scene.shownCamera;
			const viewing = camera !== undefined && this.cameras.viewOf(camera, width, height, view);
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
					(object.layerMask & layers) !== 0 &&
					shownWithAncestors(object) &&
					core.readWorldMatrix(object.handle, matrix) === 0
				) {
					const o = slot * 3;
					const ox = offsets[o] as number;
					const oy = offsets[o + 1] as number;
					const oz = offsets[o + 2] as number;
					for (let row = 0; row < 3; row++) {
						const r = row * 4;
						anchor[row] =
							(matrix[r] as number) * ox +
							(matrix[r + 1] as number) * oy +
							(matrix[r + 2] as number) * oz +
							(matrix[r + 3] as number);
					}
					projectPoint(view, anchor, projected);
					const depth = projected[2] as number;
					floats[at + LABEL_X] = projected[0] as number;
					floats[at + LABEL_Y] = projected[1] as number;
					floats[at + LABEL_DEPTH] = depth;
					if (depth >= near && depth <= far) state |= LABEL_SHOWN;
				}
				ints[at + LABEL_STATE] = state;
			}
		}
		setParityCount(region, parity, used);
		this.frame = frame;
	}

	/** A free slot for `id`'s new label, or E1219 when the table is full. */
	private takeSlot(id: string): number {
		if (this.freeCount > 0) return this.freeSlots[--this.freeCount] as number;
		const capacity = this.region?.capacity ?? 0;
		if (this.used >= capacity)
			throw new EngineError(
				'E1219',
				`trackLabel() could not track "${id}": the engine already tracks ${capacity} labels.`,
			);
		return this.used++;
	}

	/** Gives a label's slot back, under a new generation, and tells the page that its id has none. */
	private release(slot: number): void {
		const id = this.ids[slot] as string;
		this.slots.delete(id);
		this.ids[slot] = undefined;
		this.objects[slot] = undefined;
		this.generations[slot] = ((this.generations[slot] as number) + 1) % GENERATIONS;
		this.freeSlots[this.freeCount++] = slot;
		this.sendSlot(id, -1, 0);
	}
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
