// The depth mode that a test page's engine drew, and whether it is the mode that the page's ?depth=
// switch asked for, so a test can tell that the switch took effect.
import type { Engine } from '@null3d/engine';

/**
 * The depth mode the engine drew, whether its WebGL2 context has EXT_clip_control, and whether it
 * drew the depth that ?depth= asked for. Every path draws reversed depth unless ?depth= asks for
 * another mode, or WebGL2 lacks the extension and draws reversed depth in its own range.
 */
export function depthFacts(engine: Engine): {
	depth: string;
	clipControl: boolean;
	drewAsked: boolean;
} {
	const { tier, depth } = engine.capabilities;
	const clipControl = engine.report.webgl2.extensions.EXT_clip_control === true;
	const asked = new URLSearchParams(location.search).get('depth') ?? 'reversed';
	return {
		depth,
		clipControl,
		drewAsked: depth === asked || (asked === 'reversed' && tier === 'webgl2' && !clipControl),
	};
}
