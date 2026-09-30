// The counters of a frame record, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

export const UploadBytes = 0;
export const DrawCalls = 1;
export const Dispatches = 2;
/** 1 in a frame whose structure change rebuilt the draw tables, on the sketch thread's record. */
export const Rebuilds = 3;
/** Render and compute pipelines the GPU built for the frame. */
export const Pipelines = 4;
/**
 * The frame's index list entries, on the sketch thread's record, or `CORE_NOT_COUNTED` where the
 * GPU culls.
 */
export const VisibleEntries = 5;
