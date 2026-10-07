// The parts of the Basis Universal transcoder's module that the engine uses.

/** A KTX2 file open in the transcoder. */
export interface BasisKtx2File {
	isValid(): boolean;
	startTranscoding(): boolean;
	getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
	transcodeImage(
		target: Uint8Array,
		level: number,
		layer: number,
		face: number,
		format: number,
		getAlphaForOpaqueFormats: number,
		channel0: number,
		channel1: number,
	): boolean;
	close(): void;
	delete(): void;
}

/** The transcoder, once its WebAssembly module runs. */
export interface BasisModule {
	initializeBasis(): void;
	KTX2File: new (bytes: Uint8Array) => BasisKtx2File;
	transcoder_texture_format: Record<string, { value: number }>;
}

/** Starts the transcoder with a WebAssembly instance that `instantiateWasm` makes. */
declare const BASIS: (options: {
	instantiateWasm(
		imports: WebAssembly.Imports,
		receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
	): object;
}) => Promise<BasisModule>;
export default BASIS;
