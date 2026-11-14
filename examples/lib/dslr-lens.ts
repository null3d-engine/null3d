// The digital lens that a scene turns on from its address: a long lens wide open, focused on the
// point that the scene keeps up to date.

/** The aperture and blur of the lens. */
const DSLR_LENS = { aperture: 1.8, maxBlur: 0.025 } as const;

/**
 * The lens's post settings, focused on `focus`. The engine reads the point when the settings are
 * passed, so a scene whose focus moves passes them again each frame.
 */
export function lensSettings(focus: readonly number[]) {
	return { dof: { ...DSLR_LENS, focusPoint: focus } };
}
