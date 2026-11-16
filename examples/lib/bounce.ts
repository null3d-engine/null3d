// Screen-space bounce light is off on Low and Medium, which phones and tablets start on, so a demo
// that shows it sets the rays itself from the preset it runs, and puts the value it shows back
// after a preset change. A change handler cannot do that: the engine calls it for every live
// setting change, the demo's own included, so it would undo each step of the cycle.
import type { SketchContext } from '@null3d/engine';

/** The seconds of each half of the on-and-off cycle. */
export const BOUNCE_CYCLE = 4;

/** The rays that each texel of the light casts through the half of the cycle that shows it. */
export const BOUNCE_RAYS = 8;

/** The light as the viewer leaves it, once they take it from the cycle: on or off. */
export type BounceState = 'on' | 'off';

/** The rays that the bounce light casts at sketch time `seconds`: the lit half's, or none. */
export function bounceRaysAt(seconds: number): 0 | typeof BOUNCE_RAYS {
	return Math.floor(seconds / BOUNCE_CYCLE) % 2 === 0 ? BOUNCE_RAYS : 0;
}

/**
 * The light's state at sketch time `seconds`: the viewer's while they hold it, and the cycle's
 * before then.
 */
export function bounceStateAt(seconds: number, manual: BounceState | null): BounceState {
	return manual ?? (bounceRaysAt(seconds) === 0 ? 'off' : 'on');
}

/**
 * The state that a toggle leaves: the opposite of the state on show at `seconds`. The first
 * toggle takes the light from the cycle, and the cycle does not run it again.
 */
export function toggledBounce(seconds: number, manual: BounceState | null): BounceState {
	return bounceStateAt(seconds, manual) === 'on' ? 'off' : 'on';
}

/**
 * Gives the bounce light the ray count that it shows at `seconds`, or the viewer's state while
 * they hold it, when the setting holds another value, which a preset's own value or a change of
 * preset leaves.
 */
export function showBounce(ctx: SketchContext, seconds: number, manual: BounceState | null): void {
	const state = bounceStateAt(seconds, manual);
	const rays = state === 'on' ? BOUNCE_RAYS : 0;
	if (ctx.quality.settings.bounceRays !== rays) ctx.quality.set({ bounceRays: rays });
}
