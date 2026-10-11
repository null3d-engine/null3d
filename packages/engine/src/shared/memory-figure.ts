// The memory figures that the engine's threads publish in the metrics buffer's header while the page
// samples, by name. The sketch thread publishes the figures of its scene, and the thread that draws
// publishes what its GPU backend holds. Each is a plain constant, which the bundler writes into the
// code as a number; an enum would ship as an object with every name, in every thread's file.

/** The GPU bytes that every texture takes, with the free layers of their texture arrays. */
export const TextureBytes = 0;
/** The GPU bytes that textures may take: the quality setting `textureMemoryMiB` in bytes. */
export const TextureBudgetBytes = 1;
/** The largest mip levels that the texture memory budget dropped, over every texture. */
export const DroppedLevels = 2;
/** The GPU bytes that every mesh takes: the shared vertex and index buffers and morph deltas. */
export const MeshBytes = 3;
/** The GPU bytes of every texture and renderbuffer that the GPU backend holds. */
export const GpuTextureBytes = 4;
/** The GPU bytes of every buffer and query set that the GPU backend holds. */
export const GpuBufferBytes = 5;
/** The number of figures. */
export const Count = 6;
