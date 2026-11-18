// Demos that no page lists. Each one needs a package that ships nowhere, so the list that a website
// imports (`DEMOS` in demos.ts) leaves it out, and a website's build never takes in its sketch. The
// repository's examples page and the tests read every demo through `ALL_DEMOS`: a hidden demo still
// starts at its own address, and its image test still draws it.
import { DEMOS, type Demo } from './demos';

/** The demos that no page lists, each with the reason in a comment. */
export const HIDDEN_DEMOS: readonly Demo[] = [
	// The vegetation add-on is private and unpublished, so its meadow is for work on the add-on.
	{
		name: 'vegetation',
		group: 'Building scenes',
		sketch: new URL('./vegetation/sketch.ts', import.meta.url),
		code: 'vegetation/',
		title: 'Vegetation',
		scene: 'A meadow of every species',
		summary:
			"The vegetation add-on's meadow: every species the catalogue registers, each grown from its own record through the add-on's public functions and planted across a field. The pedunculate oak stands there today with the species that follow it, so the page fills as records land. Drag to turn round the meadow and use the wheel to step in, and press R to grow it all again from another seed.",
		controls: [{ keys: ['R'], does: 'Grow the meadow again from another seed' }],
		hold: 2,
		// The meadow grows every registered species at medium detail with shadows, and its held
		// capture needs more than 240 s on CI's software GPU. The wait takes the 600 s ceiling that
		// the island and the timed script use.
		timeoutSeconds: 600,
	},
];

/** Every demo: the listed ones, then the hidden ones. */
export const ALL_DEMOS: readonly Demo[] = [...DEMOS, ...HIDDEN_DEMOS];
