// Passes the user's display preferences to the sketch. Workers have no media queries, so the page
// reads them and writes each one into the control block, where the sketch reads it every frame.

import { Slot } from '../shared/control';

/** Writes the preferences now and whenever they change, until the returned function stops it. */
export function watchPreferences(slots: Int32Array): () => void {
	const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
	const write = () => Atomics.store(slots, Slot.ReducedMotion, motion?.matches ? 1 : 0);
	write();
	motion?.addEventListener('change', write);
	return () => motion?.removeEventListener('change', write);
}
