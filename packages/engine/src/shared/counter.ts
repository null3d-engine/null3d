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
/**
 * Draw commands that the frame skipped because their pipeline was still building, so the objects
 * they draw were missing from it.
 */
export const SkippedDraws = 6;
/**
 * GPU buffers, textures, texture views, samplers and bind groups that the replay of the frame
 * made, on the record of the thread that draws.
 */
export const GpuObjects = 7;
/**
 * The sources inside the camera's frustum that software occlusion culling hid, on the sketch
 * thread's record, or `CORE_NOT_COUNTED` where the GPU culls.
 */
export const OccludedEntries = 8;
