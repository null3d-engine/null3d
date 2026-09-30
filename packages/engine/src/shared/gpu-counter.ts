// What a GPU record's counter slots hold, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

/** The passes of the frame, timed alone or not. */
export const Passes = 0;
/** Bit k is set when the frame's pass k is a render pass, and clear when it is a compute pass. */
export const RenderPasses = 1;
