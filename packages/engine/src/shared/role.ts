// The rings of the metrics buffer, one per thread role, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

export const Sketch = 0;
export const Render = 1;
/** GPU time per frame and per pass from timestamp queries, written by the thread that draws. */
export const Gpu = 2;
/**
 * Frames the GPU finished: each record's busy time is the time from the frame's submit to its
 * completion, and its interval the time since the previous completion.
 */
export const Completion = 3;
export const Job = 4;
