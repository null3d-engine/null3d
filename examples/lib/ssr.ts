// Screen-space reflections are off on the Low preset, which phones start on. A demo that shows
// reflections turns them on there at a quarter of the size, and again after each change of preset.
import type { SketchContext } from '@null3d/engine';

/** Turns the reflections on for a preset that leaves them off, at a quarter of the render size. */
export function enableReflections(ctx: SketchContext): void {
	const { quality } = ctx;
	const turnOn = () => quality.settings.ssrScale === 0 && quality.set({ ssrScale: 0.25 });
	turnOn();
	quality.onChange(turnOn);
}
