// The numbers that the page sends the sketch for each frame, in one array: the camera's pose a tick
// before and at the latest tick, how far the frame is between the two, and the orbs caught. The
// page writes them from the simulation's state, and the sketch draws from them alone.

/** Where a pose starts: the eye's x, y and z, then the view's rotation as x, y, z and w. */
export const BEFORE = 0;
export const NOW = 7;
/** How far the frame is from the first pose to the second, from 0 to 1. */
export const BETWEEN = 14;
/** One bit for each orb that the run caught. */
export const CAUGHT = 15;
export const VIEW_NUMBERS = 16;
