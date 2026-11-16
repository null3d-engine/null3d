// The page's element loop for the labels, which loads on the first `engine.labels.bind`
// (labels.ts). The thread that draws copies each presented frame's labels into the control buffer
// (shared/labels.ts). Where a worker draws, the loop reads them in a frame callback of its own,
// which runs only while an element is bound. Where the page draws, it reads them right after each
// frame it draws, so the elements move in the same update as the canvas. Each update reads every
// label before it writes any style, and writes a style only when its value changed: a position
// that moved by half a pixel or more, a matrix that changed, or a label coming into view or leaving
// it.
//
// A screen label's element is placed with a translate. A 3D label's element is a plane of the
// scene: it sits in a container of its own, which holds the camera's perspective and turn, and its
// transform is the element's world matrix. The browser then turns it as it turns the scene.

import { type ControlViews, controlLabels, Slot } from '../shared/control';
import {
	CAMERA_CENTER_X,
	CAMERA_CENTER_Y,
	CAMERA_HALF_HEIGHT,
	CAMERA_ORTHO,
	GENERATION_SHIFT,
	LABEL_SHOWN,
	LABEL_STATE,
	LABEL_WORDS,
	LABEL_X,
	LABEL_Y,
	LABEL3D_STATE,
	LABEL3D_WORDS,
	type LabelRegion,
	labelSequence,
	PRESENTED_TABLE,
	presentedCount,
	presentedCount3d,
	presentedFrame,
	presentedTable3d,
	TABLE_3D,
} from '../shared/labels';
import type { LabelSlots } from './labels';

/** How many times an update reads the labels again when the thread that draws changed them meanwhile. */
const READ_TRIES = 3;
/** The smallest move, in CSS pixels, that moves a screen label's element. */
const MIN_MOVE = 0.5;
/** The numbers that an update keeps for each binding: its place, shown or not, and its matrix. */
const STATE = 16;
const STATE_X = 0;
const STATE_Y = 1;
const STATE_SHOWN = 2;
const STATE_MATRIX = 3;
/** The camera record that the containers show, then the canvas size they were made for. */
const CAMERA_STATE = 18;
/** The smallest number of a matrix that counts as zero, so a turn of the camera writes no noise. */
const EPSILON = 1e-10;

/** The bound elements, and the loop that moves them. */
export class LabelLoop {
	private readonly region: LabelRegion | undefined;
	/** The bound ids and elements, by binding index, and the index of each bound id. */
	private readonly ids: string[] = [];
	private readonly elements: HTMLElement[] = [];
	private readonly indexOf = new Map<string, number>();
	/** Each binding's table, slot (-1 for none) and generation. */
	private tables = new Uint8Array(8);
	private slots = new Int32Array(8);
	private generations = new Int32Array(8);
	/**
	 * Each binding's place as the update reads it, then as the element shows it. A screen label's
	 * place is x and y in CSS pixels; a 3D label's is the twelve numbers of its matrix.
	 */
	private next = new Float64Array(8 * STATE);
	private applied = new Float64Array(8 * STATE);
	/** The sequence counter and the canvas's CSS size when the elements last moved. */
	private readonly seen = Float64Array.of(-1, 0, 0);
	/** The camera that the containers show, and the canvas size, as the update read them. */
	private readonly cameraSeen = new Float64Array(CAMERA_STATE).fill(Number.NaN);
	/** The transform of a container, and the container of each parent element that holds 3D labels. */
	private containerTransform = '';
	private readonly containers = new Map<HTMLElement, HTMLElement>();
	private readonly cameras: HTMLElement[] = [];
	private readonly adopted = new WeakSet<HTMLElement>();
	/** The bindings whose element is a plane of the scene. */
	private three = 0;
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
		/** The table and slot of each tracked id, as the sketch sent them. */
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
		this.tables[index] = this.labelSlots.table.get(id) ?? 0;
		if (this.tables[index] === TABLE_3D) this.three++;
		this.applied[index * STATE + STATE_SHOWN] = -1;
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

	/** The sketch gave a label's id a table, a slot and a generation, or took its slot back (-1). */
	setSlot(id: string, table: number, slot: number, generation: number): void {
		this.labelSlots.set(id, table, slot, generation);
		const index = this.indexOf.get(id);
		if (index === undefined) return;
		if (this.tables[index] === TABLE_3D && table !== TABLE_3D) this.three--;
		else if (this.tables[index] !== TABLE_3D && table === TABLE_3D) this.three++;
		this.tables[index] = table;
		this.slots[index] = slot;
		this.generations[index] = generation;
		// The element's own styles follow its kind, which the sketch may tell the page after the bind.
		if (table === TABLE_3D) this.styleScene(this.elements[index] as HTMLElement);
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
		if (this.three > 0) this.updateCamera(region, width, height);
		this.write(count);
	}

	/**
	 * Reads each binding's place from the presented tables into `next`. Returns false when the thread
	 * that draws kept changing the tables, so the elements stay as they are until the next update.
	 */
	private read(region: LabelRegion, count: number, width: number, height: number): boolean {
		const { ints, floats } = region;
		const { slots, generations, tables, next } = this;
		for (let attempt = 0; attempt < READ_TRIES; attempt++) {
			const sequence = labelSequence(region);
			if ((sequence & 1) !== 0) continue;
			const labels = presentedCount(region);
			const labels3d = presentedCount3d(region);
			const table3d = presentedTable3d(region);
			const frame = presentedFrame(region);
			for (let i = 0; i < count; i++) {
				const slot = slots[i] as number;
				const n = i * STATE;
				if (tables[i] === TABLE_3D) {
					const at = table3d + slot * LABEL3D_WORDS;
					const state = slot >= 0 && slot < labels3d ? (ints[at + LABEL3D_STATE] as number) : 0;
					const shown =
						(state & LABEL_SHOWN) !== 0 && state >>> GENERATION_SHIFT === generations[i];
					next[n + STATE_SHOWN] = shown ? 1 : 0;
					if (!shown) continue;
					for (let k = 0; k < 12; k++) next[n + STATE_MATRIX + k] = floats[at + k] as number;
					continue;
				}
				const at = PRESENTED_TABLE + slot * LABEL_WORDS;
				const state = slot >= 0 && slot < labels ? (ints[at + LABEL_STATE] as number) : 0;
				const shown = (state & LABEL_SHOWN) !== 0 && state >>> GENERATION_SHIFT === generations[i];
				next[n + STATE_SHOWN] = shown ? 1 : 0;
				if (!shown) continue;
				next[n + STATE_X] = (((floats[at + LABEL_X] as number) + 1) / 2) * width;
				next[n + STATE_Y] = ((1 - (floats[at + LABEL_Y] as number)) / 2) * height;
			}
			if (labelSequence(region) !== sequence) continue;
			this.frame = frame;
			return true;
		}
		return false;
	}

	/** Moves the containers to the presented frame's camera, when the camera or the canvas changed. */
	private updateCamera(region: LabelRegion, width: number, height: number): void {
		const seen = this.cameraSeen;
		const camera = region.presentedCamera;
		let changed = seen[CAMERA_STATE - 2] !== width || seen[CAMERA_STATE - 1] !== height;
		for (let k = 0; k < CAMERA_STATE - 2; k++) {
			if (seen[k] !== (camera[k] as number)) changed = true;
			seen[k] = camera[k] as number;
		}
		seen[CAMERA_STATE - 2] = width;
		seen[CAMERA_STATE - 1] = height;
		if (!changed) return;
		this.containerTransform = cameraTransform(seen, width, height);
		for (const container of this.cameras) container.style.transform = this.containerTransform;
	}

	/** Writes the styles of the elements whose place or view changed, after every read. */
	private write(count: number): void {
		const { next, applied, elements, tables } = this;
		for (let i = 0; i < count; i++) {
			const n = i * STATE;
			const shown = next[n + STATE_SHOWN] as number;
			const element = elements[i] as HTMLElement;
			const style = element.style;
			if (shown !== applied[n + STATE_SHOWN]) {
				style.visibility = shown === 1 ? '' : 'hidden';
				applied[n + STATE_SHOWN] = shown;
				applied[n + STATE_X] = Number.NaN;
				applied[n + STATE_MATRIX] = Number.NaN;
			}
			if (shown !== 1) continue;
			if (tables[i] === TABLE_3D) {
				// An element with no parent yet keeps its matrix, and moves into a container once it has one.
				this.adopt(element);
				if (!changedMatrix(next, applied, n)) continue;
				for (let k = 0; k < 12; k++)
					applied[n + STATE_MATRIX + k] = next[n + STATE_MATRIX + k] as number;
				style.transform = matrixTransform(next, n + STATE_MATRIX);
				continue;
			}
			const x = next[n + STATE_X] as number;
			const y = next[n + STATE_Y] as number;
			if (
				Math.abs(x - (applied[n + STATE_X] as number)) < MIN_MOVE &&
				Math.abs(y - (applied[n + STATE_Y] as number)) < MIN_MOVE
			)
				continue;
			applied[n + STATE_X] = x;
			applied[n + STATE_Y] = y;
			style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
		}
	}

	/**
	 * Moves a 3D label's element into a container that holds the camera's perspective, once it has a
	 * parent. An element with none waits for a later update.
	 */
	private adopt(element: HTMLElement): void {
		if (this.adopted.has(element)) return;
		const parent = element.parentElement;
		if (!parent) return;
		const container = this.container(parent);
		this.styleScene(element);
		container.append(element);
		this.adopted.add(element);
	}

	/** The container for 3D labels inside `parent`, which covers it and holds the camera's view. */
	private container(parent: HTMLElement): HTMLElement {
		const existing = this.containers.get(parent);
		if (existing !== undefined) return existing;
		const wrapper = document.createElement('div');
		fill(wrapper.style);
		wrapper.style.overflow = 'hidden';
		wrapper.style.pointerEvents = 'none';
		const container = document.createElement('div');
		fill(container.style);
		container.style.transformStyle = 'preserve-3d';
		container.style.transform = this.containerTransform || 'none';
		wrapper.append(container);
		parent.append(wrapper);
		this.containers.set(parent, container);
		this.cameras.push(container);
		return container;
	}

	/** The styles that a 3D label's element takes, which its plane and its content need. */
	private styleScene(element: HTMLElement): void {
		element.style.userSelect = 'none';
	}

	/** Unbinds `element` from `id`, if it is still the element bound there. */
	unbind(id: string, element: HTMLElement): void {
		const index = this.indexOf.get(id);
		if (index === undefined || this.elements[index] !== element) return;
		// The last binding takes the place of the one that leaves.
		const last = this.ids.length - 1;
		this.indexOf.delete(id);
		if (this.tables[index] === TABLE_3D) this.three--;
		if (index !== last) {
			const lastId = this.ids[last] as string;
			this.ids[index] = lastId;
			this.elements[index] = this.elements[last] as HTMLElement;
			this.tables[index] = this.tables[last] as number;
			this.slots[index] = this.slots[last] as number;
			this.generations[index] = this.generations[last] as number;
			this.next.copyWithin(index * STATE, last * STATE, last * STATE + STATE);
			this.applied.copyWithin(index * STATE, last * STATE, last * STATE + STATE);
			this.indexOf.set(lastId, index);
			if (this.tables[index] === TABLE_3D) this.three++;
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
		const tables = new Uint8Array(size);
		tables.set(this.tables);
		this.tables = tables;
		const next = new Float64Array(size * STATE);
		next.set(this.next);
		this.next = next;
		const applied = new Float64Array(size * STATE);
		applied.set(this.applied);
		this.applied = applied;
	}
}

/** True when the twelve numbers of a 3D label's matrix differ from the ones the element shows. */
function changedMatrix(next: Float64Array, applied: Float64Array, n: number): boolean {
	for (let k = 0; k < 12; k++)
		if (next[n + STATE_MATRIX + k] !== applied[n + STATE_MATRIX + k]) return true;
	return false;
}

/** Fills `style` so that an element covers its parent's box. */
function fill(style: CSSStyleDeclaration): void {
	style.position = 'absolute';
	style.left = '0';
	style.top = '0';
	style.width = '100%';
	style.height = '100%';
}

/**
 * The transform of a 3D label's element, from the twelve numbers of its world matrix. The page's y
 * axis runs down the screen, so the element's own y axis is turned over, as three.js's
 * `CSS3DRenderer` turns it.
 *
 * @internal
 */
export function matrixTransform(m: ArrayLike<number>, at: number): string {
	return (
		'translate(-50%,-50%) matrix3d(' +
		`${number(m[at] as number)},${number(m[at + 4] as number)},${number(m[at + 8] as number)},0,` +
		`${number(-(m[at + 1] as number))},${number(-(m[at + 5] as number))},${number(-(m[at + 9] as number))},0,` +
		`${number(m[at + 2] as number)},${number(m[at + 6] as number)},${number(m[at + 10] as number)},0,` +
		`${number(m[at + 3] as number)},${number(m[at + 7] as number)},${number(m[at + 11] as number)},1)`
	);
}

/**
 * The transform of a container that holds 3D labels, from the presented frame's camera and the
 * canvas's CSS size: the camera's perspective, turn and place, then the canvas's center.
 *
 * @internal
 */
export function cameraTransform(camera: ArrayLike<number>, width: number, height: number): string {
	const halfHeight = camera[CAMERA_HALF_HEIGHT] as number;
	// No camera has reached the page yet, so no element shows.
	if (!(halfHeight > 0)) return '';
	const focal = height / 2 / halfHeight;
	const px = camera[9] as number;
	const py = camera[10] as number;
	const pz = camera[11] as number;
	const tx = -(
		(camera[0] as number) * px +
		(camera[1] as number) * py +
		(camera[2] as number) * pz
	);
	const ty = -(
		(camera[3] as number) * px +
		(camera[4] as number) * py +
		(camera[5] as number) * pz
	);
	const tz = -(
		(camera[6] as number) * px +
		(camera[7] as number) * py +
		(camera[8] as number) * pz
	);
	const matrix =
		'matrix3d(' +
		`${number(camera[0] as number)},${number(-(camera[3] as number))},${number(camera[6] as number)},0,` +
		`${number(camera[1] as number)},${number(-(camera[4] as number))},${number(camera[7] as number)},0,` +
		`${number(camera[2] as number)},${number(-(camera[5] as number))},${number(camera[8] as number)},0,` +
		`${number(tx)},${number(-ty)},${number(tz)},1)`;
	const head =
		camera[CAMERA_ORTHO] !== 0
			? `scale(${number(focal)}) translate(${number(-(camera[CAMERA_CENTER_X] as number))}px,${number(
					camera[CAMERA_CENTER_Y] as number,
				)}px) `
			: `perspective(${number(focal)}px) translateZ(${number(focal)}px) `;
	return `${head}${matrix} translate(${number(width / 2)}px,${number(height / 2)}px)`;
}

/** A number as CSS takes it, with the noise of a turn that did not move it set to zero. */
function number(value: number): string {
	return `${Math.abs(value) < EPSILON ? 0 : value}`;
}
