// The places and values of the subsurface sketch's scene, which the subsurface spec measures the
// image with.

/** The panels' centers along x, plain on the left and with a scatter radius on the right. */
export const PANEL_X = [-0.75, 0.75] as const;
export const PANEL_SIZE = [1.3, 1.5] as const;
/** The camera, which the spec projects the panels with. */
export const CAMERA = { fov: 40, position: [0, 0.35, 4], target: [0, 0.3, 0] } as const;
/** The direction of the sun's light: from in front of the panels, above and to the right. */
export const SUN = [-0.3, -0.6, -1] as const;
/** The thin bar in front of the panels whose shadow crosses both, and its depth in front of them. */
export const BAR = { y: 0.6, z: 0.5, thickness: 0.06 } as const;
/** The height at which the bar's shadow crosses the panels, along the sun's light. */
export const SHADOW_Y = BAR.y + (SUN[1] * BAR.z) / -SUN[2];
/** The skin panel's scatter radius in metres, and each channel's share of it. */
export const RADIUS = 0.12;
export const SCATTER_COLOR = [1, 0.4, 0.25] as const;
/** The box in front of the skin panel's lower part, which takes no blur. */
export const BLOCKER = [0.75, -0.2, 0.4] as const;
export const BLOCKER_SIZE = 0.3;
