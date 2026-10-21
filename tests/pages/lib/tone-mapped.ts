// The scene of the tone-mapped image test (tests/pages/sketches/tone-mapped-sketch.ts): one bright
// unlit color on two panels side by side, the left with toneMapped: false. The spec reads the mean
// color inside each panel, so the scene's color, panel and camera live here for both to share.

/** The color that both panels give their material, in sRGB. */
export const PANEL_COLOR = '#ffcc66';
/** The same color in sRGB steps, which the 8-bit path's flagged panel must show. */
export const PANEL_SRGB = [255, 204, 102] as const;
/** The size of the test's image, in pixels. */
export const SIZE = [320, 180] as const;
/** The panels: their size in meters and the center of each along x. */
export const PANEL = { width: 1.5, height: 2.4, x: [-0.95, 0.95] as const };
/** The camera, which looks along -z at the panels' plane from `position`. */
export const CAMERA = { fov: 40, near: 0.1, far: 100, position: [0, 0, 5] as const };
