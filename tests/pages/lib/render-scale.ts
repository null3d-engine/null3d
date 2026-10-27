// The render scales that the render scale page's sketch fixes, one per frame, which its test checks.
export const SCALES = [0.9, 0.7, 0.5, 0.8, 0.6, 0.75, 0.55, 0.95];

/**
 * The render scales at which the frame resolution page fixes the scene, one per frame: the whole
 * scale, a step below it, and the lowest scale of High, Medium and Low. Every value is one that the
 * governor reaches: it steps by 50 thousandths, and each floor is where a preset's walk stops.
 */
export const FRAME_RESOLUTION_SCALES = [1, 0.9, 0.75, 0.6, 0.5];

/**
 * The render scales at which the frame resolution page fixes the scene for its vignette check: the
 * whole scale and two below it, where the target's corner separates the vignette's place from the
 * fragment's own row.
 */
export const VIGNETTE_SCALES = [1, 0.75, 0.5];
