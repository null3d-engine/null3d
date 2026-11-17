// Test support for input-off.test.ts, which runs it as a development build and as a release build.
// On an input reader that carries the notes, as the sketch's thread makes one for a page that
// started the engine with `input: false`, it gives an object two pointer event handlers and checks
// the controls package's version.

import type { PointerTarget } from '../scene/pointer-events';
import { PointerEvents } from '../scene/pointer-events';
import { addonChecked, checkAddonVersion, VERSION } from '../shared/version';
import { InputOffNotes } from './input-off';

/** What the scenario's notes said, and whether the thread's list holds the controls package. */
export interface InputOffResult {
	said: string[];
	controls: boolean;
}

/** Runs the scenario and returns what it said. */
export function inputOffNotes(): InputOffResult {
	const said: string[] = [];
	const notes = new InputOffNotes((note) => said.push(note));
	const input = { pointerLog: undefined, presentedFrame: () => 0, inputOffNotes: notes };
	const events = new PointerEvents({ pick: () => null }, input);
	const target = { destroyedFrame: -1, pointerListeners: undefined } as unknown as PointerTarget;
	events.add(target, 'click', () => {});
	events.add(target, 'pointerdown', () => {});
	checkAddonVersion('@null3d/controls', VERSION);
	return { said, controls: addonChecked('@null3d/controls') };
}
