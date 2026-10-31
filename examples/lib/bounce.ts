// Screen-space bounce light is off on the Low and Medium presets, which phones and tablets start
// on. A demo that shows it turns it on there, and again after each change of preset.
import type { SketchContext } from '@null3d/engine';

/** Turns the bounce light on with more samples than a preset may give it, so the demo is smooth. */
export function enableBounce(ctx: SketchContext): void {
	const { quality } = ctx;
	const turnOn = () => quality.settings.bounceRays < 8 && quality.set({ bounceRays: 8 });
	turnOn();
	quality.onChange(turnOn);
}
