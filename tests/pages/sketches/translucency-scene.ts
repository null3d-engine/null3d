// The places and values of the translucency sketch's scene, which the translucency spec measures
// the image with.

/** The panels' diffuse transmission, left to right. */
export const PANEL_SHARES = [0, 1 / 3, 2 / 3, 1] as const;
/** The panels' centers along x, and their size. */
export const PANEL_X = [-2.25, -0.75, 0.75, 2.25] as const;
export const PANEL_SIZE = [1.2, 1.6] as const;
/** The camera, which the spec projects the panels with. */
export const CAMERA = { fov: 45, position: [0, 0.3, 6.5], target: [0, 0.1, 0] } as const;
/** The direction of the sun's light: from behind the panels toward the camera. */
export const SUN = [0.25, -0.35, 1] as const;
/** The box whose shadow falls on the last panel's lower half, behind it. */
export const BOX = [PANEL_X[3] - 0.45, 0.14, -1.4] as const;
/** The lamp behind the second panel's lower half, and how far its light reaches. */
export const LAMP = [PANEL_X[1], -0.45, -0.35] as const;
export const LAMP_RANGE = 1;
