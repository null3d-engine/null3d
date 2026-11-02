// Screen-space bounce light is off on Low and Medium, which phones and tablets start on, so a demo
// that shows it sets the rays itself from the preset it runs, and puts the cycle's value back
// after a preset change. A change handler cannot do that: the engine calls it for every live
// setting change, the demo's own included, so it would undo each step of the cycle.
import type { SketchContext } from '@null3d/engine';

/** The seconds of each half of the on-and-off cycle. */
export const BOUNCE_CYCLE = 4;

/** The rays that each texel of the light casts through the half of the cycle that shows it. */
export const BOUNCE_RAYS = 8;

/** The rays that the bounce light casts at sketch time `seconds`: the lit half's, or none. */
export function bounceRaysAt(seconds: number): 0 | typeof BOUNCE_RAYS {
	return Math.floor(seconds / BOUNCE_CYCLE) % 2 === 0 ? BOUNCE_RAYS : 0;
}

/**
 * Gives the bounce light the ray count that the cycle shows at `seconds`, when the setting holds
 * another value, which a preset's own value or a change of preset leaves.
 */
export function showBounce(ctx: SketchContext, seconds: number): void {
	const rays = bounceRaysAt(seconds);
	if (ctx.quality.settings.bounceRays !== rays) ctx.quality.set({ bounceRays: rays });
}
