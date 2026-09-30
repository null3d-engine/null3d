// The CPU phases of a frame, in the order they run, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

/** The sketch's update callback. */
export const Update = 0;
/** Structural changes applied from the command ring. */
export const Commands = 1;
export const Transforms = 2;
export const Batches = 3;
export const Cull = 4;
/** Draw-list recording. */
export const Record = 5;
/** Writes of changed data to GPU buffers. */
export const Upload = 6;
/** Draw-list replay into GPU commands, including the submit. */
export const Replay = 7;
