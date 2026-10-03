// Pointer events on objects: `object.on('click', handler)` and the other pointer events. While an
// object or an instance batch listens, the input reader copies each frame's pointer events into a
// log. Before the sketch's update, each event casts one ray from the camera of the frame that was on
// screen at the event, and the closest hit is the object under the pointer. The event goes to that
// object's handlers, then up through its parents, as an event on a web page goes up through the
// elements that hold its target. Enter and leave events follow the objects under each pointer, and
// a pointer that rests over the canvas casts its ray again in each frame, so they follow objects
// that move under it. A frame in which no object listens copies no event and casts no ray. The
// event, the log and each pointer's state are made once, so dispatching allocates nothing.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import type { Vec3Like } from '../math/types';
import {
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LEAVE,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	FIELD_BUTTONS,
	FIELD_CODE,
	FIELD_FLAGS,
	FIELD_FRAME,
	FIELD_ID,
	FIELD_TYPE,
	FIELD_X,
	FIELD_Y,
	FLAG_TOUCH,
	INPUT_RING_EVENTS,
} from '../shared/control';
import type { Ray } from './frame-cameras';
import type { InstanceBatch, Object3D } from './scene';

/**
 * The pointer events that objects take, as `object.on` names them. The section on pointer events
 * above says when each one comes.
 *
 * @category api/input
 */
export type ObjectEventType =
	| 'click'
	| 'pointerdown'
	| 'pointerup'
	| 'pointermove'
	| 'pointerenter'
	| 'pointerleave';

/**
 * A pointer event on an object, which the handlers of `object.on` take. The engine reuses one event
 * object for every handler, so copy any value that you keep after the handler returns.
 *
 * @category api/input
 */
export interface ObjectPointerEvent {
	/** The event's type. */
	readonly type: ObjectEventType;
	/**
	 * The object under the pointer: the closest object that the ray hits, or the instance batch of
	 * a row. It can be a child of the object whose handler runs. For `pointerleave`, it is the
	 * object that the pointer moved onto, or null when the pointer is over nothing.
	 */
	readonly object: Object3D | InstanceBatch | null;
	/** The row of an instance batch, or -1 for an object. */
	readonly instance: number;
	/** Where the ray hits `object`, in world space. */
	readonly point: Vec3Like;
	/** The unit normal of the hit triangle in world space, on the side that faces the camera. */
	readonly normal: Vec3Like;
	/** The distance from the ray's origin to the hit, in meters. */
	readonly distance: number;
	/** The index of the hit triangle in its mesh, as three.js's `faceIndex`. */
	readonly triangle: number;
	/** The ray from the camera through the pointer, from the frame that was on screen at the event. */
	readonly ray: Ray;
	/** The pointer's distance from the canvas's left edge in CSS pixels. */
	readonly x: number;
	/** The pointer's distance from the canvas's top edge in CSS pixels. */
	readonly y: number;
	/** The browser's `pointerId`: each finger on a touch screen has its own. */
	readonly pointerId: number;
	/** True when the pointer is a finger on a touch screen. */
	readonly isTouch: boolean;
	/**
	 * The button that went down or came up, as `PointerEvent.button` gives it: 0 for the main button
	 * or a finger, 1 for the middle button and 2 for the right button. -1 for the other events.
	 */
	readonly button: number;
	/** The buttons held, as `PointerEvent.buttons` gives them: 1 for the main button, 2 for the right. */
	readonly buttons: number;
	/** Stops the event from going on to the parents of the object whose handler runs. */
	stopPropagation(): void;
}

/**
 * A handler of pointer events on an object.
 *
 * @category api/input
 */
export type ObjectEventHandler = (event: ObjectPointerEvent) => void;

/** An object or an instance batch, which both take pointer events. */
export type PointerTarget = Object3D | InstanceBatch;

/** A target's handlers, one list for each event type, by its number. */
export type PointerListeners = (readonly ObjectEventHandler[] | undefined)[];

/** The event types by number. A list's index stays its type's number. */
const TYPES: readonly ObjectEventType[] = [
	'click',
	'pointerdown',
	'pointerup',
	'pointermove',
	'pointerenter',
	'pointerleave',
];
const CLICK = 0;
const DOWN = 1;
const UP = 2;
const MOVE = 3;
const ENTER = 4;
const LEAVE = 5;

/**
 * The numbers of an event, in one array so that no fraction lands in an object's field: the
 * pointer's position, then its hit.
 */
export const EVENT_X = 0;
export const EVENT_Y = 1;
export const EVENT_DISTANCE = 2;
export const EVENT_TRIANGLE = 3;
export const EVENT_ROW = 4;
export const EVENT_POINT = 5;
export const EVENT_NORMAL = 8;
const EVENT_NUMBERS = 11;

/**
 * How far a pointer may move between its press and its release, in CSS pixels, for the release to
 * count as a click, so a drag that turns the camera selects nothing. A mouse or a pen takes the
 * distance under which react-three-fiber counts a click on nothing as a miss. A finger moves a
 * little as it lifts, so it takes about a phone's tolerance for a tap.
 */
const CLICK_SLOP_MOUSE = 2;
const CLICK_SLOP_TOUCH = 10;

/** The pointers that the engine follows at once: ten fingers, the mouse and pens. */
const POINTERS = 16;

/** Finds the object under a point of a frame on screen. */
export interface PointerPicker {
	/**
	 * Writes the ray from the camera of sketch frame `frame` through the point at `EVENT_X` and
	 * `EVENT_Y` of `numbers` into `ray`, and casts it. Writes the closest hit's numbers into
	 * `numbers`, and returns its object or batch, or null when it hits nothing.
	 */
	pick(frame: number, numbers: Float64Array, ray: Ray): PointerTarget | null;
}

/** The input reader's side of pointer events. */
export interface PointerInput {
	/** The log that collects each frame's pointer events, set while objects listen. */
	pointerLog: PointerLog | undefined;
	/**
	 * The sketch frame on screen now, whose camera a pointer that rests casts its ray from. A frame
	 * of the setup is frame 0.
	 */
	presentedFrame(): number;
}

/** Each logged event's whole numbers. */
const LOG_TYPE = 0;
const LOG_ID = 1;
const LOG_FRAME = 2;
const LOG_BUTTON = 3;
const LOG_BUTTONS = 4;
const LOG_FLAGS = 5;
const LOG_INTS = 6;

/** A frame's pointer events, copied from the input ring as the input reader reads them. */
export class PointerLog {
	/** The events logged in this frame. */
	count = 0;
	readonly ints = new Int32Array(INPUT_RING_EVENTS * LOG_INTS);
	/** Each event's position in CSS pixels, as the ring holds it. */
	readonly floats = new Float32Array(INPUT_RING_EVENTS * 2);

	/**
	 * Copies the ring's pointer event at `base`, with its frame in the sketch's count, which leaves
	 * out the `setupFrames` that ran no sketch code. A move that follows a move of the same pointer
	 * takes its place: one ray then serves a run of moves.
	 */
	add(ring: Int32Array, ringFloats: Float32Array, base: number, setupFrames: number): void {
		const { ints } = this;
		const type = ring[base + FIELD_TYPE] as number;
		const id = ring[base + FIELD_ID] as number;
		let at = this.count;
		const last = (at - 1) * LOG_INTS;
		if (
			type === EVENT_POINTER_MOVE &&
			at > 0 &&
			ints[last + LOG_TYPE] === EVENT_POINTER_MOVE &&
			ints[last + LOG_ID] === id
		)
			at--;
		else if (at === INPUT_RING_EVENTS) return;
		else this.count = at + 1;
		const i = at * LOG_INTS;
		ints[i + LOG_TYPE] = type;
		ints[i + LOG_ID] = id;
		ints[i + LOG_FRAME] = Math.max(0, (ring[base + FIELD_FRAME] as number) - setupFrames);
		ints[i + LOG_BUTTON] = ring[base + FIELD_CODE] as number;
		ints[i + LOG_BUTTONS] = ring[base + FIELD_BUTTONS] as number;
		ints[i + LOG_FLAGS] = ring[base + FIELD_FLAGS] as number;
		this.floats[at * 2] = ringFloats[base + FIELD_X] as number;
		this.floats[at * 2 + 1] = ringFloats[base + FIELD_Y] as number;
	}
}

/** The one event object that every handler gets. */
class PointerEventState implements ObjectPointerEvent {
	type: ObjectEventType = 'pointermove';
	object: PointerTarget | null = null;
	instance = -1;
	pointerId = 0;
	isTouch = false;
	button = -1;
	buttons = 0;
	/** True once a handler stopped the event from going to the parents. */
	stopped = false;
	readonly numbers = new Float64Array(EVENT_NUMBERS);
	readonly point = this.numbers.subarray(EVENT_POINT, EVENT_POINT + 3);
	readonly normal = this.numbers.subarray(EVENT_NORMAL, EVENT_NORMAL + 3);
	readonly ray: Ray = { origin: new Float64Array(3), direction: new Float64Array(3) };

	get distance(): number {
		return this.numbers[EVENT_DISTANCE] as number;
	}

	get triangle(): number {
		return this.numbers[EVENT_TRIANGLE] as number;
	}

	get x(): number {
		return this.numbers[EVENT_X] as number;
	}

	get y(): number {
		return this.numbers[EVENT_Y] as number;
	}

	stopPropagation(): void {
		this.stopped = true;
	}
}

/**
 * The targets under a pointer: the object hit, then each parent up to the root, with the row of
 * the first when it is an instance batch. Lists keep their storage, so they grow only once to the
 * deepest object.
 */
class Chain {
	readonly targets: (PointerTarget | null)[] = [];
	count = 0;
	instance = -1;

	/** Fills the chain from `target` up through its parents. */
	fill(target: PointerTarget | null, instance: number): void {
		const { targets } = this;
		let count = 0;
		for (let node = target; node !== null; node = node.pointerParent()) targets[count++] = node;
		this.clear(count);
		this.count = count;
		this.instance = instance;
	}

	/** Copies another chain. */
	copy(from: Chain): void {
		const { targets } = this;
		for (let k = 0; k < from.count; k++) targets[k] = from.targets[k] as PointerTarget;
		this.clear(from.count);
		this.count = from.count;
		this.instance = from.instance;
	}

	/** True when the chain holds `target`, with row `instance` when `target` is its first entry. */
	holds(target: PointerTarget, instance: number): boolean {
		for (let k = 0; k < this.count; k++)
			if (this.targets[k] === target) return (k === 0 ? this.instance : -1) === instance;
		return false;
	}

	/** The row of the chain's target at `index`: only the first can be a row. */
	instanceAt(index: number): number {
		return index === 0 ? this.instance : -1;
	}

	/** Drops the targets after the first `count`, so the chain keeps no destroyed object alive. */
	clear(count: number): void {
		for (let k = count; k < this.count; k++) this.targets[k] = null;
	}
}

/** What the engine knows of one pointer between its events. */
class PointerState {
	/** The browser's pointer id, or -1 while the state is free. */
	id = -1;
	/** True for a finger, which leaves when it lifts. */
	touch = false;
	/** True while a mouse or a pen is over the canvas, whose ray each frame without an event casts again. */
	over = false;
	buttons = 0;
	/** The pointer's position at its last event, in CSS pixels. */
	readonly at = new Float64Array(2);
	/** The objects under the pointer, which have had `pointerenter`. */
	readonly hover = new Chain();
	/** The objects under the pointer at a press of the main button, until its release. */
	readonly pressed = new Chain();
	/** Where the main button went down. */
	readonly pressedAt = new Float64Array(2);
	/** The dispatch that last saw an event of the pointer. */
	seen = 0;

	free(): void {
		this.id = -1;
		this.over = false;
		this.hover.fill(null, -1);
		this.pressed.fill(null, -1);
	}
}

/** The pointer events of a scene's objects: see the module comment. */
export class PointerEvents {
	readonly log = new PointerLog();
	/** @internal The rays cast so far, which tests count. */
	rays = 0;
	/** The handlers of each event type, over every target. */
	private readonly counts = new Int32Array(TYPES.length);
	private total = 0;
	private readonly event = new PointerEventState();
	private readonly pointers = Array.from({ length: POINTERS }, () => new PointerState());
	/** The chain under the pointer at the event being dispatched, and one for finding a click's target. */
	private readonly chain = new Chain();
	private readonly scratch = new Chain();
	/** Counts dispatches, so each pointer knows whether this one saw an event of it. */
	private dispatches = 0;

	constructor(
		private readonly picker: PointerPicker,
		private readonly input: PointerInput | undefined,
	) {}

	/** Adds `handler` for events of `type` on `target`. A handler that it already has is not added again. */
	add(target: PointerTarget, type: ObjectEventType, handler: ObjectEventHandler): void {
		const code = typeCode(type, 'on');
		// A destroyed target never takes events, and its handlers would keep the log running.
		if (code < 0 || target.destroyedFrame >= 0) return;
		const lists = target.pointerListeners ?? new Array(TYPES.length).fill(undefined);
		target.pointerListeners = lists;
		const list = lists[code];
		if (list?.includes(handler)) return;
		// Each change makes a new list, so a dispatch that runs keeps the list it started with.
		lists[code] = list ? [...list, handler] : [handler];
		this.count(code, 1);
	}

	/** Removes `handler` for events of `type` from `target`. */
	remove(target: PointerTarget, type: ObjectEventType, handler: ObjectEventHandler): void {
		const code = typeCode(type, 'off');
		const list = code < 0 ? undefined : target.pointerListeners?.[code];
		if (list === undefined || !list.includes(handler)) return;
		(target.pointerListeners as PointerListeners)[code] =
			list.length === 1 ? undefined : list.filter((each) => each !== handler);
		this.count(code, -1);
	}

	/** Removes every handler of a target that is destroyed. */
	forget(target: PointerTarget): void {
		const lists = target.pointerListeners;
		if (lists === undefined) return;
		target.pointerListeners = undefined;
		for (let code = 0; code < lists.length; code++) {
			const list = lists[code];
			if (list !== undefined) this.count(code, -list.length);
		}
	}

	/** Counts handlers, and starts or stops the log as the first comes and the last goes. */
	private count(code: number, change: number): void {
		this.counts[code] = (this.counts[code] as number) + change;
		const before = this.total;
		this.total += change;
		const { input } = this;
		if (input === undefined) return;
		if (before === 0 && this.total > 0) input.pointerLog = this.log;
		else if (before > 0 && this.total === 0) {
			input.pointerLog = undefined;
			this.log.count = 0;
			for (const pointer of this.pointers) pointer.free();
		}
	}

	/** True when a handler of any of the types `a` and `b` exists. */
	private listens(a: number, b = a): boolean {
		return (this.counts[a] as number) > 0 || (this.counts[b] as number) > 0;
	}

	/**
	 * Dispatches the frame's pointer events, then casts again the ray of each mouse or pen that rests
	 * over the canvas, so enter and leave follow what moves under it. `report` takes the errors of
	 * handlers, which do not stop the events that follow.
	 */
	dispatch(report: (error: unknown) => void): void {
		if (this.total === 0) return;
		const dispatch = ++this.dispatches;
		const { log, event } = this;
		const hovers = this.listens(ENTER, LEAVE);
		for (let k = 0; k < log.count; k++) {
			const i = k * LOG_INTS;
			const type = log.ints[i + LOG_TYPE] as number;
			const id = log.ints[i + LOG_ID] as number;
			const touch = ((log.ints[i + LOG_FLAGS] as number) & FLAG_TOUCH) !== 0;
			const pointer = this.pointer(id, touch);
			if (pointer === undefined) continue;
			pointer.seen = dispatch;
			pointer.at[0] = log.floats[k * 2] as number;
			pointer.at[1] = log.floats[k * 2 + 1] as number;
			pointer.buttons = log.ints[i + LOG_BUTTONS] as number;
			const button = log.ints[i + LOG_BUTTON] as number;
			const main = button === 0;
			if (type === EVENT_POINTER_LEAVE) {
				this.leave(pointer, report);
				continue;
			}
			if (!touch) pointer.over = true;
			const needed =
				hovers ||
				(type === EVENT_POINTER_MOVE
					? this.listens(MOVE)
					: type === EVENT_POINTER_DOWN
						? this.listens(DOWN, CLICK)
						: this.listens(UP) || (main && pointer.pressed.count > 0));
			if (!needed) {
				if (type === EVENT_POINTER_UP && touch) pointer.free();
				continue;
			}
			this.cast(pointer, log.ints[i + LOG_FRAME] as number, report);
			event.button = type === EVENT_POINTER_MOVE ? -1 : button;
			const target = this.chain.count > 0 ? (this.chain.targets[0] as PointerTarget) : null;
			if (type === EVENT_POINTER_MOVE) this.bubble(target, MOVE, report);
			else if (type === EVENT_POINTER_DOWN) {
				this.bubble(target, DOWN, report);
				if (main && this.listens(CLICK)) {
					pointer.pressed.copy(this.chain);
					pointer.pressedAt.set(pointer.at);
				}
			} else {
				this.bubble(target, UP, report);
				if (main) this.click(pointer, report);
				// A finger that lifts leaves the objects it was over.
				if (touch) this.leave(pointer, report);
			}
		}
		if (!hovers) return;
		let frame = -1;
		for (const pointer of this.pointers) {
			if (pointer.id < 0 || !pointer.over || pointer.seen === dispatch) continue;
			if (frame < 0) frame = this.input?.presentedFrame() ?? 0;
			this.cast(pointer, frame, report);
		}
	}

	/** The state of pointer `id`, claimed for it on its first event; undefined when all are taken. */
	private pointer(id: number, touch: boolean): PointerState | undefined {
		let free: PointerState | undefined;
		for (const pointer of this.pointers) {
			if (pointer.id === id) return pointer;
			if (pointer.id < 0) free ??= pointer;
		}
		if (free === undefined) return undefined;
		free.id = id;
		free.touch = touch;
		free.seen = 0;
		return free;
	}

	/**
	 * Casts the pointer's ray from the camera of `frame` into the event, and moves the pointer's
	 * hover to the objects it hits, with their enter and leave events.
	 */
	private cast(pointer: PointerState, frame: number, report: (error: unknown) => void): void {
		const { event, chain } = this;
		const { numbers } = event;
		numbers.set(pointer.at, EVENT_X);
		let target: PointerTarget | null = null;
		this.rays++;
		try {
			target = this.picker.pick(frame, numbers, event.ray);
		} catch (error) {
			report(error);
		}
		// A whole number: a value from the array stored in a field would make a number object.
		const instance = target === null ? -1 : (numbers[EVENT_ROW] as number) | 0;
		chain.fill(target, instance);
		event.object = target;
		event.instance = instance;
		event.pointerId = pointer.id;
		event.isTouch = pointer.touch;
		event.buttons = pointer.buttons;
		event.button = -1;
		if (this.listens(ENTER, LEAVE)) this.hover(pointer, chain, report);
	}

	/**
	 * Moves the pointer's hover to `to`: `pointerleave` on each object it leaves, the object hit
	 * first, then `pointerenter` on each object it comes over, the outermost parent first.
	 */
	private hover(pointer: PointerState, to: Chain, report: (error: unknown) => void): void {
		const from = pointer.hover;
		for (let k = 0; k < from.count; k++) {
			const target = from.targets[k] as PointerTarget;
			if (!to.holds(target, from.instanceAt(k))) this.fire(target, LEAVE, report);
		}
		for (let k = to.count - 1; k >= 0; k--) {
			const target = to.targets[k] as PointerTarget;
			if (!from.holds(target, to.instanceAt(k))) this.fire(target, ENTER, report);
		}
		from.copy(to);
	}

	/** The pointer left the canvas, or its finger lifted: it leaves every object it was over. */
	private leave(pointer: PointerState, report: (error: unknown) => void): void {
		const { event } = this;
		event.object = null;
		event.instance = -1;
		event.pointerId = pointer.id;
		event.isTouch = pointer.touch;
		event.buttons = pointer.buttons;
		event.button = -1;
		this.chain.fill(null, -1);
		this.hover(pointer, this.chain, report);
		if (pointer.pressed.count === 0 || pointer.touch) pointer.free();
		else pointer.over = false;
	}

	/**
	 * Ends a press of the main button: a click on the closest object that was under the pointer at
	 * both the press and the release, when the pointer moved no more than a few pixels between.
	 */
	private click(pointer: PointerState, report: (error: unknown) => void): void {
		const { pressed, at, pressedAt } = pointer;
		const slop = pointer.touch ? CLICK_SLOP_TOUCH : CLICK_SLOP_MOUSE;
		const dx = (at[0] as number) - (pressedAt[0] as number);
		const dy = (at[1] as number) - (pressedAt[1] as number);
		if (this.listens(CLICK) && dx * dx + dy * dy <= slop * slop) {
			const released = this.chain;
			for (let k = 0; k < released.count; k++) {
				const target = released.targets[k] as PointerTarget;
				if (pressed.holds(target, released.instanceAt(k)) && target.destroyedFrame < 0) {
					this.bubble(target, CLICK, report);
					break;
				}
			}
		}
		pressed.fill(null, -1);
	}

	/** Calls the handlers of `code` on `target`, then on each of its parents, until one stops it. */
	private bubble(
		target: PointerTarget | null,
		code: number,
		report: (error: unknown) => void,
	): void {
		if (!this.listens(code)) return;
		this.event.stopped = false;
		// The chain was filled from the hit before any handler ran, so a handler that moves or
		// destroys an object does not change where the event goes.
		const chain = this.scratch;
		chain.fill(target, -1);
		for (let k = 0; k < chain.count && !this.event.stopped; k++)
			this.fire(chain.targets[k] as PointerTarget, code, report);
		chain.clear(0);
		chain.count = 0;
	}

	/** Calls the handlers of `code` on `target` alone. */
	private fire(target: PointerTarget, code: number, report: (error: unknown) => void): void {
		const list = target.pointerListeners?.[code];
		if (list === undefined) return;
		const { event } = this;
		event.type = TYPES[code] as ObjectEventType;
		for (let k = 0; k < list.length; k++) {
			try {
				(list[k] as ObjectEventHandler)(event);
			} catch (error) {
				report(error);
			}
		}
	}
}

/** The number of an event type; E1205 in development builds when objects have no such event. */
function typeCode(type: string, call: string): number {
	const code = TYPES.indexOf(type as ObjectEventType);
	if (code < 0 && DEV)
		throw new EngineError(
			'E1205',
			`${call}() got "${type}", which names no pointer event of objects: use ${TYPES.map((name) => `'${name}'`).join(', ')}.`,
		);
	return code;
}
