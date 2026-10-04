// The label tables: where each label tracked in the sketch lies on the canvas, for the page to move
// its HTML element there. They live in the control buffer, after the input ring, so every thread
// reaches them with no message per frame. Each frame, the sketch thread writes its labels into the
// table of the frame's parity. The thread that draws copies the table of each frame it presents
// into the presented table, under a sequence counter that is odd while it copies. The page reads
// only the presented table, so its elements follow the frame on screen, and the sketch never writes
// a table that the page reads. The capacity is fixed when the engine starts.

/** The labels a control buffer holds when `createEngine` names no capacity. */
export const DEFAULT_MAX_LABELS = 4096;
/** The most labels a control buffer can hold: a label's slot fits in 16 bits. */
export const MAX_LABELS_LIMIT = 65_536;

/**
 * Int32 words per label: its place in normalized device coordinates, x right and y up from -1 to
 * 1, as floats; its depth in front of the camera along the view, a float; then its state.
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

/** The header's words, before the tables. */
const SEQUENCE = 0;
const FRAME = 1;
const COUNT = 2;
/** The labels in use in each parity's table, which the sketch thread writes with the table. */
const PARITY_COUNT = 3;
const HEADER_WORDS = 8;

/** The labels' part of the control buffer. */
export interface LabelRegion {
	/** The header and the tables, as integers. */
	ints: Int32Array;
	/** The same memory as floats, for the fields that hold floats. */
	floats: Float32Array;
	/** The labels each table holds. */
	capacity: number;
}

/** Bytes of the labels' part of a control buffer that holds `capacity` labels. */
export function labelBytes(capacity: number): number {
	return capacity > 0 ? (HEADER_WORDS + 3 * capacity * LABEL_WORDS) * 4 : 0;
}

/**
 * The labels' part of `buffer`, which starts at byte `offset` and runs to the buffer's end, or
 * undefined when the buffer holds no labels.
 */
export function labelRegion(buffer: ArrayBufferLike, offset: number): LabelRegion | undefined {
	const words = (buffer.byteLength - offset) / 4;
	const capacity = Math.floor((words - HEADER_WORDS) / (3 * LABEL_WORDS));
	if (capacity <= 0) return undefined;
	return {
		ints: new Int32Array(buffer, offset, words),
		floats: new Float32Array(buffer, offset, words),
		capacity,
	};
}

/** The word where the presented table starts. */
export const PRESENTED_TABLE = HEADER_WORDS;

/** The word where the table of frames of `parity` starts. */
export function parityTable(region: LabelRegion, parity: number): number {
	return HEADER_WORDS + (1 + parity) * region.capacity * LABEL_WORDS;
}

/** Records that the table of frames of `parity` holds `count` labels, after the sketch wrote it. */
export function setParityCount(region: LabelRegion, parity: number, count: number): void {
	Atomics.store(region.ints, PARITY_COUNT + parity, count);
}

/**
 * The thread that draws: copies the table of `frame`, which it presents, into the presented table.
 * The sequence counter is odd while it copies, so a page that reads meanwhile reads again.
 */
export function presentLabels(region: LabelRegion, frame: number): void {
	const { ints } = region;
	const parity = frame & 1;
	const count = Atomics.load(ints, PARITY_COUNT + parity);
	Atomics.add(ints, SEQUENCE, 1);
	if (count > 0) {
		const from = parityTable(region, parity);
		ints.copyWithin(PRESENTED_TABLE, from, from + count * LABEL_WORDS);
	}
	ints[COUNT] = count;
	ints[FRAME] = frame;
	Atomics.add(ints, SEQUENCE, 1);
}

/** The sequence counter: even when the presented table is whole, odd while it changes. */
export function labelSequence(region: LabelRegion): number {
	return Atomics.load(region.ints, SEQUENCE);
}

/** The labels in the presented table. */
export function presentedCount(region: LabelRegion): number {
	return region.ints[COUNT] as number;
}

/** The frame whose labels the presented table holds, or 0 before the first. */
export function presentedFrame(region: LabelRegion): number {
	return region.ints[FRAME] as number;
}
