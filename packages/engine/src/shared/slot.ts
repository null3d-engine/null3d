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
 * The newest id of an image that the thread that draws received for texture uploads, or 0 before
 * the first. The sketch thread sends images in the order of their ids, which step and compare as
 * frame numbers do, so every id up to this one arrived.
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
/**
 * The milliseconds that the thread that draws waits before it replays each frame's list, from the
 * ?replay-delay= test switch, or 0. The sketch thread then steps the next frame before the replay
 * reads the engine memory that the list points at.
 */
export const ReplayDelayMs = 32;
/**
 * In hold mode, the first frame that the thread that draws draws, up to the frame published. The
 * sketch thread records the held frame twice when a feature draws with what the frame before it
 * drew, as screen-space reflections read the frame before's color and a reflection probe that
 * captures in one frame lights surfaces from then on, so the held frame has it.
 */
export const HeldFrom = 35;
/**
 * The address in engine memory of the job system's yield word, or 0 before the sketch thread has
 * created the job system. While the browser measures the page's memory, the page adds one to it,
 * so idle job workers let their threads run the measurement instead of blocking.
 */
export const JobsYieldAddress = 36;
/**
 * Nonzero while the thread that draws must take a frame without drawing it, by frame parity: a still
 * view that has accumulated enough frames rests until the scene changes. The thread that draws
 * takes the frame anyway, so the sketch keeps stepping and can see the change that ends the rest.
 */
export const FrameRest0 = 33;
export const FrameRest1 = 34;
/**
 * Nonzero where the page turns the still-camera accumulation off, such as in hold mode, a replay
 * and the image tests: a still view then draws every frame as it moves.
 */
export const StillOff = 57;
/**
 * The ranges of cluster-tree patches that the camera view drew in the frame the sketch recorded
 * last, 0 where it drew the trees' whole levels, or a negative value where the GPU path picks the
 * patches itself. The sketch thread writes it, for a page that reports which path a frame took.
 */
export const ClusterPatches = 58;
/** The frame that `ClusterPatches` belongs to. The sketch thread writes it with the count. */
export const ClusterPatchFrame = 59;
/**
 * The programs that may still be compiling in the background on WebGL2, as the thread that draws
 * found them at its last frame, for the development probe of the two-step pass.
 */
export const WebglCompiling = 41;
/**
 * Nonzero when the WebGL2 context that the engine draws with has `KHR_parallel_shader_compile`, for
 * the development probe of the two-step pass.
 */
export const WebglParallel = 42;
/**
 * The two-step pass's answers for the last recorded frame, for the development probe: whether the
 * frame wanted the pass, declared it, had its second step built and drew it, and its render scale in
 * thousandths. The thread that runs the sketch writes them while the probe is on.
 */
export const TwoStepWanted = 43;
export const TwoStepDeclared = 44;
export const TwoStepBuilt = 45;
export const TwoStepRuns = 46;
export const TwoStepScale = 47;
/**
 * Each read of GPU picking's ring: the thread that draws adds one once the read's bytes are in
 * engine memory. The sketch takes a read's answer when its slot is not 0.
 */
/**
 * The generation of the newest plan's texture list, as the sketch thread recorded it. A capture
 * replays a list long after its frame was recorded, so it draws only a list recorded under this
 * generation: an older list names textures that the newer plan replaced. The frame loop draws its
 * frames in the order they were recorded, and each list carries the textures that it makes and
 * releases, so a later plan does not make an earlier frame unsafe.
 */
export const PlanEpoch = 48;
/** The plan generation each frame parity's draw list was recorded under. */
export const FramePlan0 = 49;
export const FramePlan1 = 50;
/**
 * Each capture of a sky map's light: the thread that draws adds one once the coefficients of the
 * map's light are in engine memory at the address that the core gave the capture. The core takes
 * them by comparing the words that landed with the ones before, so nothing reads this slot.
 */
export const SkyLight = 51;
/**
 * The frames that the thread that draws took and drew none of, because each was recorded for a GPU
 * device that the browser took away. A skipped list never draws again, so the work that only it
 * records, such as a probe's capture, is lost. A page reports the count around a change, so a lost
 * result names a skip as its cause.
 */
export const FramesSkipped = 56;
export const PickRead0 = 37;
export const PickRead1 = 38;
export const PickRead2 = 39;
export const PickRead3 = 40;
/**
 * Each read of a compute pass's region: the thread that draws adds one once the read's bytes are
 * in engine memory. The sketch takes a read's answer when its slot is not 0.
 */
export const PassRead0 = 52;
export const PassRead1 = 53;
export const PassRead2 = 54;
export const PassRead3 = 55;
