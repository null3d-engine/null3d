// The touch controls send the keys that the keyboard sends, held or tapped, so the scene reads one
// input: the mode and the scene's gust are single presses. Each key goes down once and up once.
import { expect, test } from 'bun:test';
import { CAMERA_KEYS } from './cinematic-keys';
import { createTouchActions } from './touch-controls';

/** The keys that a control sent, in order, with whether each went down or up. */
function recorder() {
	const events: [string, boolean][] = [];
	const actions = createTouchActions((code, down) => events.push([code, down]));
	return { events, actions };
}

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
	actions.hold(CAMERA_KEYS.mode);
	actions.dispose();
	expect(events.slice(2)).toEqual([
		[CAMERA_KEYS.fall, true],
		[CAMERA_KEYS.mode, true],
		[CAMERA_KEYS.fall, false],
		[CAMERA_KEYS.mode, false],
	]);
});
