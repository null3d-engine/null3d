// What a GPU record's counter slots hold, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

/** The passes of the frame, timed alone or not. */
export const Passes = 0;
/** Bit k is set when the frame's pass k is a render pass, and clear when it is a compute pass. */
export const RenderPasses = 1;
/** The step between the frame's timestamps in nanoseconds: the divisor of their offsets, or 0. */
export const Tick = 2;
/**
 * The first of the words that name the scope of each pass that the frame times one by one, in the
 * pass's order: a code from the engine, or 0 where no scope names the pass. They hold
 * `GPU_TIMED_PASSES` words, which the frame's counter slots leave free.
 */
export const Scope = 3;
