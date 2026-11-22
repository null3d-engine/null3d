// The touch controls send the keys that the keyboard sends, held or tapped, so the scene reads one
// input: a drag pans with the camera's own keys, the rise and fall hold theirs while a finger
// stays, and the mode and the scene's gust are single presses. Each key goes down once and up once.
import { expect, test } from 'bun:test';
import { CAMERA_KEYS } from './cinematic-keys';
import { createTouchActions, PAD_DEAD_ZONE, padWays } from './touch-controls';

/** The keys that a control sent, in order, with whether each went down or up. */
function recorder() {
	const events: [string, boolean][] = [];
	const actions = createTouchActions((code, down) => events.push([code, down]));
	const up = events
		.filter(([, down]) => !down)
		.map(([code]) => code)
		.sort();
	return { events, actions, released: () => up };
}

test('a drag presses a way only past the dead zone', () => {
	expect(padWays(0, 0)).toEqual({ forward: false, back: false, left: false, right: false });
	expect(padWays(PAD_DEAD_ZONE / 2, 0)).toEqual({
		forward: false,
		back: false,
		left: false,
		right: false,
	});
	expect(padWays(0.5, 0)).toEqual({ forward: false, back: false, left: false, right: true });
	expect(padWays(-0.5, 0)).toEqual({ forward: false, back: false, left: true, right: false });
	expect(padWays(0, -0.5)).toEqual({ forward: true, back: false, left: false, right: false });
	expect(padWays(0, 0.5)).toEqual({ forward: false, back: true, left: false, right: false });
	// A diagonal presses both ways, as two keys on a keyboard.
	expect(padWays(0.5, -0.5)).toEqual({ forward: true, back: false, left: false, right: true });
});

test('the pad sends the camera keys for the ways it presses', () => {
	const { events, actions } = recorder();
	actions.pad(0, 0);
	expect(events).toEqual([]);
	actions.pad(1, 0);
	expect(events).toEqual([[CAMERA_KEYS.right, true]]);
	actions.pad(1, -1);
	expect(events).toEqual([
		[CAMERA_KEYS.right, true],
		[CAMERA_KEYS.forward, true],
	]);
	actions.pad(0, 0);
	expect(events.slice(2)).toEqual([
		[CAMERA_KEYS.forward, false],
		[CAMERA_KEYS.right, false],
	]);
	expect(events).toHaveLength(4);
});

test('a key goes down once and up once, however often it is asked', () => {
	const { events, actions } = recorder();
	actions.hold(CAMERA_KEYS.rise);
	actions.hold(CAMERA_KEYS.rise);
	actions.release(CAMERA_KEYS.rise);
	actions.release(CAMERA_KEYS.rise);
	expect(events).toEqual([
		[CAMERA_KEYS.rise, true],
		[CAMERA_KEYS.rise, false],
	]);
});

test('a tap presses its key once, and a dispose releases what is held', () => {
	const { events, actions } = recorder();
	actions.tap(CAMERA_KEYS.mode);
	expect(events).toEqual([
		[CAMERA_KEYS.mode, true],
		[CAMERA_KEYS.mode, false],
	]);
	actions.hold(CAMERA_KEYS.fall);
	actions.pad(0, 1);
	actions.dispose();
	expect(events.slice(2)).toEqual([
		[CAMERA_KEYS.fall, true],
		[CAMERA_KEYS.back, true],
		[CAMERA_KEYS.back, false],
		[CAMERA_KEYS.fall, false],
	]);
});
