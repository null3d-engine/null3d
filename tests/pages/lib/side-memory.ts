// The memory figures of one side of a cost page's turns, which the engine's stats overlay gives and
// both the page and the specs that read its result share. Plain data, with no imports, so a program
// of either kind may use it.
export interface SideMemory {
	/** True once the overlay showed a count, so its memory figures had been sampled. */
	ready: boolean;
	/** The engine's tables, which the overlay counts without the GPU's. */
	engineBytes: number | null;
	gpuTextureBytes: number | null;
	gpuBufferBytes: number | null;
	jsHeapBytes: number | null;
	totalBytes: number | null;
	/** The shared WebAssembly memory, which the overlay does not show. */
	wasmBytes: number | null;
}
