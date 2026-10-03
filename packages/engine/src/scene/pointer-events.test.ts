import { beforeEach, describe, expect, test } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { InputRing } from '../page/input-ring';
import {
	controlViews,
	createControlBuffer,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LEAVE,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	type InputEventType,
	Slot,
} from '../shared/control';
import { KEY_CODES } from '../shared/key-codes';
import { InputReader } from '../sketch/input';
import type { Ray } from './frame-cameras';
import {
	EVENT_DISTANCE,
	EVENT_ROW,
	EVENT_X,
	type ObjectEventType,
	type ObjectPointerEvent,
	PointerEvents,
	type PointerListeners,
	type PointerTarget,
} from './pointer-events';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A stand-in for an object: its handlers, its parent and whether it is destroyed. */
class Target {
	pointerListeners: PointerListeners | undefined = undefined;
	destroyedFrame = -1;
	constructor(
		readonly name: string,
		readonly parent: Target | null = null,
	) {}
	pointerParent(): PointerTarget | null {
		return this.parent as unknown as PointerTarget | null;
	}
}

const asTarget = (target: Target) => target as unknown as PointerTarget;
const nameOf = (object: unknown) => (object as Target | null)?.name ?? 'nothing';

/**
 * A group with two children side by side, a box beside them, and a batch beyond: each takes a band
 * of the canvas's x. The batch's row is the tens of x past its band's start.
 */
function scene() {
	const group = new Target('group');
	const left = new Target('left', group);
	const right = new Target('right', group);
	const box = new Target('box');
	const batch = new Target('batch');
	/** What each band of x holds; a test can move objects by changing it. */
	const bands: [number, Target | null][] = [
		[100, left],
		[200, right],
		[300, box],
		[400, batch],
		[Infinity, null],
	];
	const picks: { frame: number; x: number }[] = [];
	const control = createControlBuffer(false);
	const views = controlViews(control);
	const ring = new InputRing(control);
	const input = new InputReader(views, KEY_CODES);
	const events = new PointerEvents(
		{
			pick(frame: number, numbers: Float64Array, ray: Ray) {
				const x = numbers[EVENT_X] as number;
				picks.push({ frame, x });
				ray.origin[0] = x;
				const band = bands.findIndex(([end]) => x < end);
				const target = bands[band]?.[1] ?? null;
				if (target === null) return null;
				numbers[EVENT_DISTANCE] = x / 10;
				numbers[EVENT_ROW] = target === batch ? Math.floor((x - 300) / 10) : -1;
				return asTarget(target);
			},
		},
		input,
	);
	const seen: string[] = [];
	const errors: unknown[] = [];
	let frame = 0;
	/** Runs a frame: the reader takes the ring's events, then the objects' handlers run. */
	const next = () => {
		input.beginFrame(++frame);
		events.dispatch((error) => errors.push(error));
	};
	/** A mouse event, or with `flags`, another pointer's. */
	const pointer = (
		type: InputEventType,
		x: number,
		buttons = 0,
		button = 0,
		id = 1,
		flags = FLAG_PRIMARY,
	) => ring.write(type, x, 50, button, id, buttons, flags);
	const touch = (type: InputEventType, x: number, id: number) =>
		pointer(type, x, type === EVENT_POINTER_UP ? 0 : 1, 0, id, FLAG_TOUCH | FLAG_PRIMARY);
	/** Writes "type target(hit)" for each event that reaches `target`. */
	const listen = (target: Target, ...types: ObjectEventType[]) => {
		const handler = (event: ObjectPointerEvent) =>
			seen.push(`${event.type} ${target.name}(${nameOf(event.object)})`);
		for (const type of types) events.add(asTarget(target), type, handler);
		return handler;
	};
	const take = () => seen.splice(0);
	return {
		group,
		left,
		right,
		box,
		batch,
		bands,
		picks,
		views,
		input,
		events,
		errors,
		next,
		pointer,
		touch,
		listen,
		take,
	};
}

const ALL: ObjectEventType[] = [
	'click',
	'pointerdown',
	'pointerup',
	'pointermove',
	'pointerenter',
	'pointerleave',
];

describe('pointer events on objects', () => {
	test('a frame without handlers logs no event and casts no ray', () => {
		const { input, picks, events, next, pointer, listen, left } = scene();
		pointer(EVENT_POINTER_MOVE, 50);
		pointer(EVENT_POINTER_DOWN, 50, 1);
		pointer(EVENT_POINTER_UP, 50);
		next();
		expect(input.pointerLog).toBeUndefined();
		expect(events.rays).toBe(0);
		// The first handler starts the log, and the last one's removal stops it.
		const handler = listen(left, 'click');
		expect(input.pointerLog).toBe(events.log);
		pointer(EVENT_POINTER_DOWN, 50, 1);
		pointer(EVENT_POINTER_UP, 50);
		next();
		expect(events.rays).toBe(2);
		events.remove(asTarget(left), 'click', handler);
		expect(input.pointerLog).toBeUndefined();
		pointer(EVENT_POINTER_DOWN, 50, 1);
		pointer(EVENT_POINTER_UP, 50);
		next();
		expect(events.rays).toBe(2);
		expect(picks).toHaveLength(2);
	});

	test('casts only the rays that the handlers need', () => {
		const { events, next, pointer, listen, left } = scene();
		listen(left, 'click');
		// Moves need no ray for a click.
		pointer(EVENT_POINTER_MOVE, 50);
		pointer(EVENT_POINTER_MOVE, 60);
		next();
		expect(events.rays).toBe(0);
		// A right button's release needs no ray either: a click is the main button's.
		pointer(EVENT_POINTER_DOWN, 60, 2, 2);
		pointer(EVENT_POINTER_UP, 60, 0, 2);
		next();
		expect(events.rays).toBe(1);
	});

	test('presses, releases and clicks go to the object hit, then to its parents', () => {
		const { next, pointer, listen, take, group, left, box } = scene();
		listen(group, 'click', 'pointerdown', 'pointerup');
		listen(left, 'click', 'pointerdown', 'pointerup');
		listen(box, 'click');
		pointer(EVENT_POINTER_DOWN, 50, 1);
		pointer(EVENT_POINTER_UP, 51);
		next();
		expect(take()).toEqual([
			'pointerdown left(left)',
			'pointerdown group(left)',
			'pointerup left(left)',
			'pointerup group(left)',
			'click left(left)',
			'click group(left)',
		]);
	});

	test('a click goes to the closest object under both the press and the release', () => {
		const { next, pointer, listen, take, group, left, right, box } = scene();
		for (const target of [group, left, right, box]) listen(target, 'click');
		// From one child to the other: the group holds both.
		pointer(EVENT_POINTER_DOWN, 99, 1);
		pointer(EVENT_POINTER_UP, 100);
		next();
		expect(take()).toEqual(['click group(right)']);
		// From a child to the box: nothing holds both.
		pointer(EVENT_POINTER_DOWN, 199, 1);
		pointer(EVENT_POINTER_UP, 200);
		next();
		expect(take()).toEqual([]);
		// Over nothing at the press.
		pointer(EVENT_POINTER_DOWN, 500, 1);
		pointer(EVENT_POINTER_UP, 250);
		next();
		expect(take()).toEqual([]);
	});

	test('a drag is no click: a mouse may move 2 pixels, and a finger 10', () => {
		const { next, pointer, touch, listen, take, box } = scene();
		listen(box, 'click');
		pointer(EVENT_POINTER_DOWN, 250, 1);
		pointer(EVENT_POINTER_UP, 253);
		next();
		expect(take()).toEqual([]);
		pointer(EVENT_POINTER_DOWN, 250, 1);
		pointer(EVENT_POINTER_UP, 252);
		next();
		expect(take()).toEqual(['click box(box)']);
		touch(EVENT_POINTER_DOWN, 250, 7);
		touch(EVENT_POINTER_UP, 259, 7);
		next();
		expect(take()).toEqual(['click box(box)']);
		touch(EVENT_POINTER_DOWN, 250, 8);
		touch(EVENT_POINTER_UP, 261, 8);
		next();
		expect(take()).toEqual([]);
	});

	test('enter and leave come in pairs, and a group counts its children as inside', () => {
		const { next, pointer, listen, take, group, left, right, box } = scene();
		for (const target of [group, left, right, box]) listen(target, 'pointerenter', 'pointerleave');
		const steps: [number, string[]][] = [
			[50, ['pointerenter group(left)', 'pointerenter left(left)']],
			[150, ['pointerleave left(right)', 'pointerenter right(right)']],
			[250, ['pointerleave right(box)', 'pointerleave group(box)', 'pointerenter box(box)']],
			[500, ['pointerleave box(nothing)']],
			[60, ['pointerenter group(left)', 'pointerenter left(left)']],
		];
		for (const [x, expected] of steps) {
			pointer(EVENT_POINTER_MOVE, x);
			next();
			expect(take()).toEqual(expected);
		}
		// Leaving the canvas leaves everything.
		pointer(EVENT_POINTER_LEAVE, 60);
		next();
		expect(take()).toEqual(['pointerleave left(nothing)', 'pointerleave group(nothing)']);
		next();
		expect(take()).toEqual([]);
	});

	test('each row of a batch is its own target for enter and leave', () => {
		const { next, pointer, events, batch } = scene();
		const rows: string[] = [];
		const handler = (event: ObjectPointerEvent) => rows.push(`${event.type} ${event.instance}`);
		events.add(asTarget(batch), 'pointerenter', handler);
		events.add(asTarget(batch), 'pointerleave', handler);
		for (const x of [305, 308, 315]) {
			pointer(EVENT_POINTER_MOVE, x);
			next();
		}
		// The leave carries the hit that the pointer moved onto: the next row.
		expect(rows).toEqual(['pointerenter 0', 'pointerleave 1', 'pointerenter 1']);
	});

	test('a pointer that rests casts again each frame, from the frame on screen now', () => {
		const { views, picks, bands, next, pointer, listen, take, box } = scene();
		listen(box, 'pointerenter', 'pointerleave');
		Atomics.store(views.slots, Slot.FramePresented, 9);
		pointer(EVENT_POINTER_MOVE, 250);
		next();
		expect(take()).toEqual(['pointerenter box(box)']);
		// The box moves away under the resting pointer.
		(bands[2] as [number, null])[1] = null;
		Atomics.store(views.slots, Slot.FramePresented, 11);
		next();
		expect(take()).toEqual(['pointerleave box(nothing)']);
		expect(picks.map(({ frame }) => frame)).toEqual([9, 11]);
	});

	test('each event casts its ray from the frame that was on screen when it came', () => {
		const { views, picks, next, pointer, listen, box } = scene();
		listen(box, 'pointerdown');
		Atomics.store(views.slots, Slot.FramePresented, 5);
		pointer(EVENT_POINTER_DOWN, 250, 1);
		Atomics.store(views.slots, Slot.FramePresented, 6);
		pointer(EVENT_POINTER_UP, 250);
		pointer(EVENT_POINTER_DOWN, 250, 1);
		next();
		// The second press waits for the next frame, as the input reader holds it back.
		expect(picks).toEqual([{ frame: 5, x: 250 }]);
		next();
		expect(picks.map(({ frame }) => frame)).toEqual([5, 6]);
	});

	test('a run of moves casts one ray, at its last position', () => {
		const { events, picks, next, pointer, listen, take, box } = scene();
		listen(box, 'pointermove');
		for (let x = 210; x <= 250; x += 10) pointer(EVENT_POINTER_MOVE, x);
		next();
		expect(events.rays).toBe(1);
		expect(picks[0]?.x).toBe(250);
		expect(take()).toEqual(['pointermove box(box)']);
	});

	test('a finger enters at its press, and leaves after its release and click', () => {
		const { next, touch, listen, take, box } = scene();
		listen(box, ...ALL);
		touch(EVENT_POINTER_DOWN, 250, 4);
		next();
		expect(take()).toEqual(['pointerenter box(box)', 'pointerdown box(box)']);
		touch(EVENT_POINTER_UP, 251, 4);
		next();
		expect(take()).toEqual(['pointerup box(box)', 'click box(box)', 'pointerleave box(nothing)']);
		// A finger leaves no hover behind: the next frame casts nothing.
		next();
		expect(take()).toEqual([]);
	});

	test('two fingers are two pointers', () => {
		const { next, touch, listen, take, left, box } = scene();
		listen(left, 'click');
		listen(box, 'click');
		touch(EVENT_POINTER_DOWN, 50, 1);
		touch(EVENT_POINTER_DOWN, 250, 2);
		touch(EVENT_POINTER_UP, 250, 2);
		touch(EVENT_POINTER_UP, 50, 1);
		next();
		expect(take()).toEqual(['click box(box)', 'click left(left)']);
	});

	test('stopPropagation keeps an event from the parents', () => {
		const { next, pointer, listen, take, group, left, events } = scene();
		listen(group, 'click');
		events.add(asTarget(left), 'click', (event) => event.stopPropagation());
		pointer(EVENT_POINTER_DOWN, 50, 1);
		pointer(EVENT_POINTER_UP, 50);
		next();
		expect(take()).toEqual([]);
	});

	test("a handler's error is reported, and the other handlers still run", () => {
		const { next, pointer, listen, take, errors, events, box } = scene();
		const failure = new Error('handler failed');
		events.add(asTarget(box), 'click', () => {
			throw failure;
		});
		listen(box, 'click');
		pointer(EVENT_POINTER_DOWN, 250, 1);
		pointer(EVENT_POINTER_UP, 250);
		next();
		expect(errors).toEqual([failure]);
		expect(take()).toEqual(['click box(box)']);
	});

	test('a handler is added once, and a destroyed target loses its handlers', () => {
		const { input, next, pointer, take, events, box } = scene();
		const seen: string[] = [];
		const handler = (event: ObjectPointerEvent) => seen.push(event.type);
		events.add(asTarget(box), 'click', handler);
		events.add(asTarget(box), 'click', handler);
		pointer(EVENT_POINTER_DOWN, 250, 1);
		pointer(EVENT_POINTER_UP, 250);
		next();
		expect(seen).toEqual(['click']);
		box.destroyedFrame = 3;
		events.forget(asTarget(box));
		expect(input.pointerLog).toBeUndefined();
		// A destroyed target takes no new handler.
		events.add(asTarget(box), 'click', handler);
		expect(input.pointerLog).toBeUndefined();
		expect(take()).toEqual([]);
	});

	test('an event type that objects lack throws E1205', () => {
		const { events, box } = scene();
		let error: EngineError | undefined;
		try {
			events.add(asTarget(box), 'mouseover' as ObjectEventType, () => {});
		} catch (thrown) {
			error = thrown as EngineError;
		}
		expect(error?.message).toStartWith(
			`E1205: on() got "mouseover", which names no pointer event of objects: use 'click', 'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave'.`,
		);
	});
});
