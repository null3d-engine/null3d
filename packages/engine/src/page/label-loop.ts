// The page's element loop for the labels, which loads on the first `engine.labels.bind`
// (labels.ts). The thread that draws copies each presented frame's labels into the control buffer
// (shared/labels.ts). Where a worker draws, the loop reads them in a frame callback of its own,
// which runs only while an element is bound. Where the page draws, it reads them right after each
// frame it draws, so the elements move in the same update as the canvas. Each update reads every
// label before it writes any style, and writes a style only when its value changed: a position
// that moved by half a pixel or more, or the label coming into view or leaving it.

import { type ControlViews, controlLabels, Slot } from '../shared/control';
import {
	GENERATION_SHIFT,
	LABEL_SHOWN,
	LABEL_STATE,
	LABEL_WORDS,
	LABEL_X,
	LABEL_Y,
	type LabelRegion,
	labelSequence,
	PRESENTED_TABLE,
	presentedCount,
	presentedFrame,
} from '../shared/labels';
import type { LabelSlots } from './labels';

/** How many times an update reads the labels again when the thread that draws changed them meanwhile. */
const READ_TRIES = 3;
/** The smallest move, in CSS pixels, that moves an element. */
const MIN_MOVE = 0.5;

/** The bound elements, and the loop that moves them. */
export class LabelLoop {
	private readonly region: LabelRegion | undefined;
	/** The bound ids and elements, by binding index, and the index of each bound id. */
	private readonly ids: string[] = [];
	private readonly elements: HTMLElement[] = [];
	private readonly indexOf = new Map<string, number>();
	/** Each binding's slot (-1 for none) and generation. */
	private slots = new Int32Array(8);
	private generations = new Int32Array(8);
	/**
	 * Each binding's place as the update reads it, then as the element shows it: x and y in CSS
	 * pixels, and 1 when shown. The applied state starts at -1, so the first update writes it.
	 */
	private next = new Float64Array(8 * 3);
	private applied = new Float64Array(8 * 3);
	/** The sequence counter and the canvas's CSS size when the elements last moved. */
	private readonly seen = Float64Array.of(-1, 0, 0);
	/** True when a binding or a slot changed since the last update. */
	private changed = false;
	/** @internal The frame whose labels the elements show, for tests. */
	frame = 0;
	private looping = false;
	/** One update, for a binding made while the page draws. */
	private readonly once = (): void => this.update();
	private readonly loop = (): void => {
		if (this.ids.length === 0 || Atomics.load(this.control.slots, Slot.Running) === 0) {
			this.looping = false;
			return;
		}
		this.update();
		requestAnimationFrame(this.loop);
	};

	/**
	 * `drawsHere` is true when the page draws the frames, and then calls `update` after each frame
	 * it presents, so no frame callback of the labels' own runs.
	 */
	constructor(
		private readonly control: ControlViews,
		private readonly drawsHere: boolean,
		/** The slot of each tracked id, as the sketch sent them. */
		private readonly labelSlots: LabelSlots,
	) {
		this.region = controlLabels(control.slots.buffer);
	}

	/** Binds `element` to the label with `id`, in place of an element bound there before. */
	bind(id: string, element: HTMLElement): void {
		const existing = this.indexOf.get(id);
		if (existing !== undefined) this.unbind(id, this.elements[existing] as HTMLElement);
		const index = this.ids.length;
		this.grow(index + 1);
		this.ids.push(id);
		this.elements.push(element);
		this.indexOf.set(id, index);
		this.slots[index] = this.labelSlots.slot.get(id) ?? -1;
		this.generations[index] = this.labelSlots.generation.get(id) ?? 0;
		this.applied[index * 3 + 2] = -1;
		const style = element.style;
		style.position = 'absolute';
		style.left = '0';
		style.top = '0';
		style.visibility = 'hidden';
		this.changed = true;
		// Where the page draws, each frame it presents updates the elements. One update now places
		// the new element while no frame comes, as in a pause.
		if (this.drawsHere) requestAnimationFrame(this.once);
		else if (!this.looping) {
			this.looping = true;
			requestAnimationFrame(this.loop);
		}
	}

	/** The sketch gave a label's id a slot and a generation, or took its slot back (-1). */
	setSlot(id: string, slot: number, generation: number): void {
		this.labelSlots.set(id, slot, generation);
		const index = this.indexOf.get(id);
		if (index === undefined) return;
		this.slots[index] = slot;
		this.generations[index] = generation;
		this.changed = true;
	}

	/** Moves each bound element to its label in the frame on screen, if anything changed. */
	update(): void {
		const region = this.region;
		const count = this.ids.length;
		if (region === undefined || count === 0) return;
		const { slotFloats } = this.control;
		const width = slotFloats[Slot.CanvasCssWidth] as number;
		const height = slotFloats[Slot.CanvasCssHeight] as number;
		const seen = this.seen;
		const sequence = labelSequence(region);
		if (!this.changed && sequence === seen[0] && width === seen[1] && height === seen[2]) return;
		if (!this.read(region, count, width, height)) return;
		seen[0] = labelSequence(region);
		seen[1] = width;
		seen[2] = height;
		this.changed = false;
		this.write(count);
	}

	/**
	 * Reads each binding's place from the presented table into `next`. Returns false when the thread
	 * that draws kept changing the table, so the elements stay as they are until the next update.
	 */
	private read(region: LabelRegion, count: number, width: number, height: number): boolean {
		const { ints, floats } = region;
		const { slots, generations, next } = this;
		for (let attempt = 0; attempt < READ_TRIES; attempt++) {
			const sequence = labelSequence(region);
			if ((sequence & 1) !== 0) continue;
			const labels = presentedCount(region);
			const frame = presentedFrame(region);
			for (let i = 0; i < count; i++) {
				const slot = slots[i] as number;
				const at = PRESENTED_TABLE + slot * LABEL_WORDS;
				const state = slot >= 0 && slot < labels ? (ints[at + LABEL_STATE] as number) : 0;
				const shown = (state & LABEL_SHOWN) !== 0 && state >>> GENERATION_SHIFT === generations[i];
				const n = i * 3;
				next[n + 2] = shown ? 1 : 0;
				if (!shown) continue;
				next[n] = (((floats[at + LABEL_X] as number) + 1) / 2) * width;
				next[n + 1] = ((1 - (floats[at + LABEL_Y] as number)) / 2) * height;
			}
			if (labelSequence(region) !== sequence) continue;
			this.frame = frame;
			return true;
		}
		return false;
	}

	/** Writes the styles of the elements whose place or view changed, after every read. */
	private write(count: number): void {
		const { next, applied, elements } = this;
		for (let i = 0; i < count; i++) {
			const n = i * 3;
			const shown = next[n + 2] as number;
			const style = (elements[i] as HTMLElement).style;
			if (shown !== applied[n + 2]) {
				style.visibility = shown === 1 ? '' : 'hidden';
				applied[n + 2] = shown;
				if (shown === 1) applied[n] = Number.NaN;
			}
			if (shown !== 1) continue;
			const x = next[n] as number;
			const y = next[n + 1] as number;
			if (
				Math.abs(x - (applied[n] as number)) < MIN_MOVE &&
				Math.abs(y - (applied[n + 1] as number)) < MIN_MOVE
			)
				continue;
			applied[n] = x;
			applied[n + 1] = y;
			style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
		}
	}

	/** Unbinds `element` from `id`, if it is still the element bound there. */
	unbind(id: string, element: HTMLElement): void {
		const index = this.indexOf.get(id);
		if (index === undefined || this.elements[index] !== element) return;
		// The last binding takes the place of the one that leaves.
		const last = this.ids.length - 1;
		this.indexOf.delete(id);
		if (index !== last) {
			const lastId = this.ids[last] as string;
			this.ids[index] = lastId;
			this.elements[index] = this.elements[last] as HTMLElement;
			this.slots[index] = this.slots[last] as number;
			this.generations[index] = this.generations[last] as number;
			this.next.copyWithin(index * 3, last * 3, last * 3 + 3);
			this.applied.copyWithin(index * 3, last * 3, last * 3 + 3);
			this.indexOf.set(lastId, index);
		}
		this.ids.pop();
		this.elements.pop();
	}

	/** Makes room for `count` bindings. */
	private grow(count: number): void {
		if (count <= this.slots.length) return;
		const size = this.slots.length * 2;
		const slots = new Int32Array(size);
		slots.set(this.slots);
		this.slots = slots;
		const generations = new Int32Array(size);
		generations.set(this.generations);
		this.generations = generations;
		const next = new Float64Array(size * 3);
		next.set(this.next);
		this.next = next;
		const applied = new Float64Array(size * 3);
		applied.set(this.applied);
		this.applied = applied;
	}
}
