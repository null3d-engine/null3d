// The touch controls of a showcase demo, on a coarse pointer: the camera's mode and the scene's own
// action where it has one, such as a gust. Turning and zooming stay on the scene's own gestures, one
// finger to turn and a pinch to zoom, so the screen keeps its space for the picture. Each control
// sends the key that the keyboard sends, so the scene reads one input and the page's controls and
// the keys do the same thing.

/** The touch controls' actions, over one function that sends a key's code down or up. */
export interface TouchActions {
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
	return {
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
			for (const code of [...held]) set(code, false);
		},
	};
}
