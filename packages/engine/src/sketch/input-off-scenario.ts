// Test support for input-off.test.ts, which runs it as a development build and as a release build.
// On an input reader that carries the notes, as the sketch's thread makes one for a page that
// started the engine with `input: false`, it gives an object two pointer event handlers. It listens
// for add-ons that check their version, as the sketch's thread does, while the controls check theirs
// and stops before another add-on checks its own.

import type { PointerTarget } from '../scene/pointer-events';
import { PointerEvents } from '../scene/pointer-events';
import { checkAddonVersion, onAddonChecked, VERSION } from '../shared/version';
import { InputOffNotes } from './input-off';

/** What the scenario's notes said, and the add-ons that its handler heard. */
export interface InputOffResult {
	said: string[];
	heard: string[];
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
	const heard: string[] = [];
	const stop = onAddonChecked((name) => heard.push(name));
	checkAddonVersion('@null3d/controls', VERSION);
	stop();
	checkAddonVersion('@null3d/water', VERSION);
	return { said, heard };
}
