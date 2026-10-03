// The CPU phases of a frame, in the order they run, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

/**
 * The sketch's callbacks: its fixed steps, its update, its late update and its animation event
 * handlers.
 */
export const Update = 0;
/** Structural changes applied from the command ring. */
export const Commands = 1;
/** The animation step, the transform update, and the second one after the sketch's late update. */
export const Transforms = 2;
export const Batches = 3;
export const Cull = 4;
/** Draw-list recording. */
export const Record = 5;
/** Writes of changed data to GPU buffers. */
export const Upload = 6;
/** Draw-list replay into GPU commands, including the submit. */
export const Replay = 7;
