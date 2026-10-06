// The Int32 slots of the control block, by name.
// Each is a plain constant, which the bundler writes into the code as a number; an enum would ship
// as an object with every name, in every thread's file.

/** Frames the sketch worker has published, counting from 1. */
export const FramesPublished = 0;
/** The newest frame the renderer has taken for drawing. */
export const FramesTaken = 1;
/** Nonzero while the engine runs; zero stops every loop. */
export const Running = 2;
/** Nonzero while the engine is paused by the page. */
export const Paused = 3;
/** Incremented each time the page writes a new canvas size. */
export const ResizeSerial = 4;
/** Canvas size in device pixels. */
export const CanvasWidth = 5;
export const CanvasHeight = 6;
/** Input ring: the index of the next event slot the page writes, counting up without wrapping. */
export const InputWrite = 7;
/**
 * The number of the frame the renderer drew last. The page writes it with each input event, so a
 * pointer event names the frame that was on screen when it came.
 */
export const FramePresented = 8;
/** Addresses of the two draw lists in engine memory, by frame parity. They never move. */
export const DrawListAddress0 = 9;
export const DrawListAddress1 = 10;
/** Words recorded into each draw list, by frame parity. */
export const DrawListWords0 = 11;
export const DrawListWords1 = 12;
/**
 * Incremented each time the page resumes the sketch or shows a hidden page again, so the sketch's
 * next step counts no time.
 */
export const Resumes = 13;
/**
 * Incremented by the thread that draws each time it replaces a GPU device that the browser took
 * away. The sketch thread then records a frame that creates every GPU object again.
 */
export const GpuEpoch = 14;
/**
 * The GPU epoch each frame parity's draw list was recorded for. A list from an older epoch names
 * GPU objects that the new device lacks, so the renderer takes that frame without drawing it.
 */
export const FrameEpoch0 = 15;
export const FrameEpoch1 = 16;
/** Nonzero while the user's system asks pages for less motion. */
export const ReducedMotion = 17;
/** Nonzero once the sketch thread has created the job system that the job workers serve. */
export const JobsReady = 18;
/** Input ring: the index of the next event the sketch reads, counting up as `InputWrite` does. */
export const InputRead = 19;
/** The canvas size in CSS pixels, as float bits: read them through `slotFloats`. */
export const CanvasCssWidth = 20;
export const CanvasCssHeight = 21;
/**
 * The display's refresh period in whole microseconds, as the page measures it from its own frame
 * callbacks, or 0 before the first measurement. A worker that draws holds its frames to it.
 */
export const DisplayInterval = 22;
/**
 * The images that the thread that draws received for texture uploads. The sketch thread sends
 * them in the order of their ids, which count from 1, so every id up to this count arrived.
 */
export const ImagesArrived = 23;
/**
 * The newest frame whose pipelines are all built, with those of every frame before it, as the
 * thread that draws reports it. `scene.warmUp` waits for it.
 */
export const PipelinesBuilt = 24;
/**
 * Device pixels per CSS pixel that the engine draws with, as float bits: the display's ratio,
 * capped by the `maxPixelRatio` quality setting, and lower on a canvas too large for the GPU.
 */
export const PixelRatio = 25;
/**
 * The first frame of a quality preset change, whose pipelines and targets may all be new. From
 * that frame on, the thread that draws holds each frame until its pipelines are built, as it does
 * the first frame, and the previous frame stays on screen meanwhile.
 */
export const PipelineHold = 26;
/**
 * The render scale of the newest frame that the sketch thread recorded, in thousandths of the
 * canvas's size, for the page's stats overlay.
 */
export const RenderScale = 27;
/**
 * The addresses in engine memory of the job system's wake word and of its stop flag, a byte, or 0
 * before the sketch thread has created the job system. The page stops the job workers through
 * them, at once, when the engine stops and when the page leaves.
 */
export const JobsWakeAddress = 28;
export const JobsStopAddress = 29;
/**
 * The job workers inside the job system's loop. A page that leaves waits until none is, because
 * the browser stops each worker as soon as the page has gone.
 */
export const JobsServing = 30;
/**
 * The template of the last joined shader of custom effects, a group's or a fold's, whose pipeline
 * failed to build, as the thread that draws reports it, or 0. The sketch thread takes it, and from
 * then on those effects draw one pass each.
 */
export const JoinFailed = 31;
