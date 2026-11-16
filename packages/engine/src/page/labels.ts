// The page's side of the labels, as far as every page needs it: `engine.labels.bind`, the table and
// slot in the label tables of each id that the sketch tracks, and the checks of `createEngine`'s
// `maxLabels` and `maxLabels3d`. The code that moves the elements (label-loop.ts) loads on the
// first bind, so a page without labels never downloads it. Binds made while it loads wait for it.

import { EngineError } from '../errors/engine-error';
import type { ControlViews } from '../shared/control';
import { DEFAULT_MAX_LABELS, DEFAULT_MAX_LABELS_3D, MAX_LABELS_LIMIT } from '../shared/labels';
import type { LabelLoop } from './label-loop';

/**
 * The page's labels, as `engine.labels` gives them.
 *
 * @category api/ui
 */
export interface EngineLabels {
	/**
	 * Binds `element` to the label that the sketch tracks under `id` with `ui.trackLabel`. The
	 * engine then moves the element's center over the label's place on the canvas, in each frame on
	 * screen, through its CSS `transform`. It sets the element's `position` to `absolute` at the
	 * top left of its container, so put the element in a container that covers the canvas. It hides
	 * the element with `visibility: hidden` while the label's object is hidden, outside the camera's
	 * near and far planes, or not tracked. Binding another element to an id replaces the first.
	 * Returns a function that unbinds the element, which then stays where it is.
	 *
	 * A label that the sketch tracks with `transform: 'world'` or `'billboard'` is a plane of the
	 * scene: the engine moves the element into a container of its own inside the element's parent,
	 * and turns it with the scene's perspective, as three.js's `CSS3DRenderer` does. Leave the
	 * element's `transform-origin` at its center, and size the element in CSS pixels, which are the
	 * scene's units at the distance where the view is one pixel per unit.
	 */
	bind(id: string, element: HTMLElement): () => void;
}

/** The labels that `createEngine`'s `maxLabels` option asks for, or E1213 for a value out of range. */
export function labelCapacity(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAX_LABELS;
	if (Number.isInteger(value) && value >= 1 && value <= MAX_LABELS_LIMIT) return value;
	throw new EngineError(
		'E1213',
		`createEngine() got ${value} for maxLabels, which is not a whole number from 1 to ${MAX_LABELS_LIMIT}.`,
	);
}

/** The 3D labels that `createEngine`'s `maxLabels3d` option asks for, or E1213 for a value out of range. */
export function labelCapacity3d(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAX_LABELS_3D;
	if (Number.isInteger(value) && value >= 0 && value <= MAX_LABELS_LIMIT) return value;
	throw new EngineError(
		'E1213',
		`createEngine() got ${value} for maxLabels3d, which is not a whole number from 0 to ${MAX_LABELS_LIMIT}.`,
	);
}

/** The table and slot in the label tables, and the slot's generation, of each id that the sketch tracks. */
export class LabelSlots {
	readonly table = new Map<string, number>();
	readonly slot = new Map<string, number>();
	readonly generation = new Map<string, number>();

	/** Keeps `id`'s table, slot and generation, or forgets the id when its slot is -1. */
	set(id: string, table: number, slot: number, generation: number): void {
		if (slot < 0) {
			this.table.delete(id);
			this.slot.delete(id);
			this.generation.delete(id);
		} else {
			this.table.set(id, table);
			this.slot.set(id, slot);
			this.generation.set(id, generation);
		}
	}
}

/** The page's labels: the slots of the ids, and the element loop once the first bind loads it. */
export class PageLabels implements EngineLabels {
	private readonly slots = new LabelSlots();
	private loop: LabelLoop | undefined;
	private loading = false;
	/** Binds made while the element loop loads. */
	private readonly waiting: [string, HTMLElement][] = [];

	/**
	 * `drawsHere` is true when the page draws the frames, and then calls `update` after each frame
	 * it presents.
	 */
	constructor(
		private readonly control: ControlViews,
		private readonly drawsHere: boolean,
	) {}

	/** @internal The frame whose labels the elements show, for tests. */
	get frame(): number {
		return this.loop?.frame ?? 0;
	}

	bind(id: string, element: HTMLElement): () => void {
		const loop = this.loop;
		if (loop) {
			loop.bind(id, element);
			return () => this.loop?.unbind(id, element);
		}
		// Hidden until the loop places it, so it never shows at the container's corner.
		element.style.visibility = 'hidden';
		this.waiting.push([id, element]);
		if (!this.loading) {
			this.loading = true;
			import('./label-loop').then(
				({ LabelLoop }) => {
					const made = new LabelLoop(this.control, this.drawsHere, this.slots);
					this.loop = made;
					for (const [waitingId, waitingElement] of this.waiting.splice(0))
						made.bind(waitingId, waitingElement);
				},
				(error: unknown) => console.warn(`null3D could not load the label code: ${String(error)}`),
			);
		}
		return () => {
			if (this.loop) this.loop.unbind(id, element);
			else {
				const index = this.waiting.findIndex(([i, e]) => i === id && e === element);
				if (index >= 0) this.waiting.splice(index, 1);
			}
		};
	}

	/** The sketch gave a label's id a table, a slot and a generation, or took its slot back (-1). */
	setSlot(id: string, table: number, slot: number, generation: number): void {
		if (this.loop) this.loop.setSlot(id, table, slot, generation);
		else this.slots.set(id, table, slot, generation);
	}

	/** Moves each bound element to its label in the frame on screen, once the loop has loaded. */
	update(): void {
		this.loop?.update();
	}
}
