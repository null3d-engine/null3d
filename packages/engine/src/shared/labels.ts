// The label tables: where each label tracked in the sketch lies for the page, which moves its HTML
// element to it. They live in the control buffer, after the input ring, so every thread reaches
// them with no message per frame. Each frame, the sketch thread writes its labels into the table of
// the frame's parity. The thread that draws copies the table of each frame it presents into the
// presented table, under a sequence counter that is odd while it copies. The page reads only the
// presented table, so its elements follow the frame on screen, and the sketch never writes a table
// that the page reads. The capacity is fixed when the engine starts.
//
// A screen label's record holds a place on the canvas. A label that is a plane of the scene also
// has a record: the world matrix of its element, which CSS turns with its own perspective. Those
// records sit in a table set of their own, so a page that shows no such label pays nothing for them,
// and the camera of each frame sits beside the tables, for the page to build the perspective.

/** The screen labels a control buffer holds when `createEngine` names no capacity. */
export const DEFAULT_MAX_LABELS = 4096;
/** The 3D labels a control buffer holds when `createEngine` names no capacity. */
export const DEFAULT_MAX_LABELS_3D = 256;
/** The most labels a control buffer can hold: a label's slot fits in 16 bits. */
export const MAX_LABELS_LIMIT = 65_536;

/** The table that a label's slot is in: the screen labels' table, or the 3D labels'. */
export const TABLE_SCREEN = 0;
export const TABLE_3D = 1;

/**
 * Int32 words per screen label: its place in normalized device coordinates, x right and y up from
 * -1 to 1, as floats; its depth in front of the camera along the view, a float; then its state.
 */
export const LABEL_WORDS = 4;
export const LABEL_X = 0;
export const LABEL_Y = 1;
export const LABEL_DEPTH = 2;
export const LABEL_STATE = 3;
/**
 * A label's state: flags in the low 16 bits, and in the high 16 bits the generation of its slot,
 * which changes each time the slot passes to another label.
 */
export const LABEL_SHOWN = 1;
export const GENERATION_SHIFT = 16;

/**
 * Words per 3D label: the twelve numbers of its element's world matrix, row by row, then its state.
 * The matrix is affine, so its last row is always 0, 0, 0, 1.
 */
export const LABEL3D_WORDS = 13;
export const LABEL3D_MATRIX = 0;
export const LABEL3D_STATE = 12;

/**
 * The frame's camera, as the page needs it to build the perspective that turns a 3D label's matrix
 * into a place on the canvas: the inverse of its world matrix's 3 × 3 part, row by row; the camera's
 * position; half the view's height at one unit in front of a perspective camera, or across an
 * orthographic view; 1 for an orthographic lens; and that view's center.
 */
export const CAMERA_ROTATION = 0;
export const CAMERA_POSITION = 9;
export const CAMERA_HALF_HEIGHT = 12;
export const CAMERA_ORTHO = 13;
export const CAMERA_CENTER_X = 14;
export const CAMERA_CENTER_Y = 15;
export const CAMERA_FLOATS = 16;

/** The header's words, before the tables. */
const SEQUENCE = 0;
const FRAME = 1;
const COUNT = 2;
const COUNT3D = 3;
/** The labels in use in each parity's table, which the sketch thread writes with the table. */
const PARITY_COUNT = 4;
const PARITY_COUNT3D = 6;
/** The 3D labels that the control buffer holds. The engine writes it as it makes the buffer. */
const CAPACITY3D = 8;
/** The camera of the presented frame, then of each parity's frame, as floats. */
const CAMERA_PRESENTED = 9;
const CAMERA_PARITY = CAMERA_PRESENTED + CAMERA_FLOATS;
const HEADER_WORDS = CAMERA_PARITY + 2 * CAMERA_FLOATS;

/** The labels' part of the control buffer. */
export interface LabelRegion {
	/** The header and the tables, as integers. */
	ints: Int32Array;
	/** The same memory as floats, for the fields that hold floats. */
	floats: Float32Array;
	/** The screen labels each table holds. */
	capacity: number;
	/** The 3D labels each table holds. */
	capacity3d: number;
	/** The camera of the frame on screen. */
	presentedCamera: Float32Array;
	/** The camera of the frame of each parity. */
	parityCameras: [Float32Array, Float32Array];
}

/** Bytes of the labels' part of a control buffer that holds each kind of label. */
export function labelBytes(capacity: number, capacity3d: number): number {
	if (capacity <= 0 && capacity3d <= 0) return 0;
	const words = HEADER_WORDS + 3 * capacity * LABEL_WORDS + 3 * capacity3d * LABEL3D_WORDS;
	return words * 4;
}

/**
 * The labels' part of `buffer`, which starts at byte `offset` and runs to the buffer's end, or
 * undefined when the buffer holds no labels.
 */
export function labelRegion(buffer: ArrayBufferLike, offset: number): LabelRegion | undefined {
	const words = (buffer.byteLength - offset) / 4;
	if (words < HEADER_WORDS) return undefined;
	const ints = new Int32Array(buffer, offset, words);
	const floats = new Float32Array(buffer, offset, words);
	const capacity3d = ints[CAPACITY3D] as number;
	const available = words - HEADER_WORDS - 3 * capacity3d * LABEL3D_WORDS;
	const capacity = Math.max(0, Math.floor(available / (3 * LABEL_WORDS)));
	if (capacity <= 0 && capacity3d <= 0) return undefined;
	return {
		ints,
		floats,
		capacity,
		capacity3d,
		presentedCamera: new Float32Array(buffer, offset + CAMERA_PRESENTED * 4, CAMERA_FLOATS),
		parityCameras: [
			new Float32Array(buffer, offset + CAMERA_PARITY * 4, CAMERA_FLOATS),
			new Float32Array(buffer, offset + (CAMERA_PARITY + CAMERA_FLOATS) * 4, CAMERA_FLOATS),
		],
	};
}

/** Records that `buffer` holds `capacity3d` 3D labels. The engine calls it as it makes the buffer. */
export function setLabelCapacity3d(
	buffer: ArrayBufferLike,
	offset: number,
	capacity3d: number,
): void {
	new Int32Array(buffer, offset + CAPACITY3D * 4, 1)[0] = capacity3d;
}

/** The word where the presented table starts. */
export const PRESENTED_TABLE = HEADER_WORDS;

/** The word where the table of frames of `parity` starts. */
export function parityTable(region: LabelRegion, parity: number): number {
	return HEADER_WORDS + (1 + parity) * region.capacity * LABEL_WORDS;
}

/** The word where the presented table of 3D labels starts. */
export function presentedTable3d(region: LabelRegion): number {
	return HEADER_WORDS + 3 * region.capacity * LABEL_WORDS;
}

/** The word where the table of 3D labels of frames of `parity` starts. */
export function parityTable3d(region: LabelRegion, parity: number): number {
	return presentedTable3d(region) + (1 + parity) * region.capacity3d * LABEL3D_WORDS;
}

/** Records that the table of frames of `parity` holds `count` screen labels, after the sketch wrote it. */
export function setParityCount(region: LabelRegion, parity: number, count: number): void {
	Atomics.store(region.ints, PARITY_COUNT + parity, count);
}

/** Records that the table of frames of `parity` holds `count` 3D labels, after the sketch wrote it. */
export function setParityCount3d(region: LabelRegion, parity: number, count: number): void {
	Atomics.store(region.ints, PARITY_COUNT3D + parity, count);
}

/**
 * The thread that draws: copies the tables of `frame`, which it presents, into the presented
 * tables, the frame's camera with them. The sequence counter is odd while it copies, so a page that
 * reads meanwhile reads again.
 */
export function presentLabels(region: LabelRegion, frame: number): void {
	const { ints, capacity3d } = region;
	const parity = frame & 1;
	const count = Atomics.load(ints, PARITY_COUNT + parity);
	const count3d = capacity3d > 0 ? Atomics.load(ints, PARITY_COUNT3D + parity) : 0;
	Atomics.add(ints, SEQUENCE, 1);
	if (count > 0) {
		const from = parityTable(region, parity);
		ints.copyWithin(PRESENTED_TABLE, from, from + count * LABEL_WORDS);
	}
	if (count3d > 0) {
		const from = parityTable3d(region, parity);
		ints.copyWithin(presentedTable3d(region), from, from + count3d * LABEL3D_WORDS);
	}
	if (capacity3d > 0) region.presentedCamera.set(region.parityCameras[parity] as Float32Array);
	ints[COUNT] = count;
	ints[COUNT3D] = count3d;
	ints[FRAME] = frame;
	Atomics.add(ints, SEQUENCE, 1);
}

/** The sequence counter: even when the presented tables are whole, odd while they change. */
export function labelSequence(region: LabelRegion): number {
	return Atomics.load(region.ints, SEQUENCE);
}

/** The screen labels in the presented table. */
export function presentedCount(region: LabelRegion): number {
	return region.ints[COUNT] as number;
}

/** The 3D labels in the presented table. */
export function presentedCount3d(region: LabelRegion): number {
	return region.ints[COUNT3D] as number;
}

/** The frame whose labels the presented tables hold, or 0 before the first. */
export function presentedFrame(region: LabelRegion): number {
	return region.ints[FRAME] as number;
}
