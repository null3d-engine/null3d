// The touch controls of a showcase demo, on a coarse pointer: the camera's mode, a drag pad that
// pans, the rise and fall, and the scene's own action where it has one, such as a gust. Each
// control sends the key that the keyboard sends, so the scene reads one input and the page's
// controls and the keys do the same thing.
import { CAMERA_KEYS } from './cinematic-keys';

/** How far from the pad's middle a drag must reach, as a share of its half size, to press a way. */
export const PAD_DEAD_ZONE = 0.28;

/** The ways that a drag presses: forward and back, left and right. */
export interface PadWays {
	forward: boolean;
	back: boolean;
	left: boolean;
	right: boolean;
}

/**
 * The ways that a drag presses, from its offset from the pad's middle, x to the right and y down,
 * each from -1 to 1 across the pad's half size.
 */
export function padWays(x: number, y: number): PadWays {
	const past = (offset: number) => Math.abs(offset) >= PAD_DEAD_ZONE;
	return {
		forward: past(y) && y < 0,
		back: past(y) && y > 0,
		left: past(x) && x < 0,
		right: past(x) && x > 0,
	};
}

/** The pad's ways and the keys they hold. */
const PAD_KEYS: Readonly<Record<keyof PadWays, string>> = {
	forward: CAMERA_KEYS.forward,
	back: CAMERA_KEYS.back,
	left: CAMERA_KEYS.left,
	right: CAMERA_KEYS.right,
};

/** The touch controls' actions, over one function that sends a key's code down or up. */
export interface TouchActions {
	/** Presses the ways that the drag's offset asks, and releases the rest. */
	pad(x: number, y: number): void;
	/** Holds a control's key down, for as long as its finger stays. */
	hold(code: string): void;
	/** Releases a control's key. */
	release(code: string): void;
	/** Sends a control's key down and up once, as a press. */
	tap(code: string): void;
	/** Releases every key that the controls hold. */
	dispose(): void;
}

/**
 * The touch controls' actions. Repeated holds and releases send nothing: the emit hears each key
 * go down once and come up once, as the browser's own key events do.
 */
export function createTouchActions(emit: (code: string, down: boolean) => void): TouchActions {
	const held = new Set<string>();
	const set = (code: string, down: boolean): void => {
		if (down === held.has(code)) return;
		if (down) held.add(code);
		else held.delete(code);
		emit(code, down);
	};
	let ways: PadWays = { forward: false, back: false, left: false, right: false };
	const setWays = (next: PadWays): void => {
		for (const way of Object.keys(PAD_KEYS) as (keyof PadWays)[])
			if (next[way] !== ways[way]) set(PAD_KEYS[way], next[way]);
		ways = next;
	};
	return {
		pad(x: number, y: number) {
			setWays(padWays(x, y));
		},
		hold(code: string) {
			set(code, true);
		},
		release(code: string) {
			set(code, false);
		},
		tap(code: string) {
			set(code, true);
			set(code, false);
		},
		dispose() {
			setWays({ forward: false, back: false, left: false, right: false });
			for (const code of [...held]) set(code, false);
		},
	};
}
