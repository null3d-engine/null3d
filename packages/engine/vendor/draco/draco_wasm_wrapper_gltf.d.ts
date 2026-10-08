// The parts of Draco's glTF decoder module that the engine uses. Draco's script is no ES module: a
// bundle wraps it as CommonJS, and its import then gives the module's factory as the default
// export. A browser that imports the file as it is, as the dev server serves it, gets no export,
// and the script hands the factory to an AMD `define` instead (scene/gltf-draco.ts).

/** An object of the module, which `destroy` frees. */
export interface DracoObject {
	readonly ptr: number;
}

/** The outcome of a decode. */
export interface DracoStatus extends DracoObject {
	ok(): boolean;
	error_msg(): string;
}

/** A decoded mesh. */
export interface DracoMesh extends DracoObject {
	num_points(): number;
	num_faces(): number;
}

/** An attribute of a decoded mesh. */
export interface DracoPointAttribute extends DracoObject {
	num_components(): number;
}

/** The decoder. */
export interface DracoDecoderObject extends DracoObject {
	GetEncodedGeometryType(bytes: Int8Array): number;
	DecodeArrayToMesh(bytes: Int8Array, byteLength: number, mesh: DracoMesh): DracoStatus;
	GetAttributeByUniqueId(mesh: DracoMesh, id: number): DracoPointAttribute;
	GetAttributeDataArrayForAllPoints(
		mesh: DracoMesh,
		attribute: DracoPointAttribute,
		dataType: number,
		byteLength: number,
		pointer: number,
	): boolean;
	GetTrianglesUInt16Array(mesh: DracoMesh, byteLength: number, pointer: number): boolean;
	GetTrianglesUInt32Array(mesh: DracoMesh, byteLength: number, pointer: number): boolean;
}

/** The decoder's module, once its WebAssembly module runs. */
export interface DracoModule {
	Decoder: new () => DracoDecoderObject;
	Mesh: new () => DracoMesh;
	destroy(object: DracoObject): void;
	getPointer(object: DracoObject): number;
	_malloc(bytes: number): number;
	_free(pointer: number): void;
	readonly HEAPU8: Uint8Array<ArrayBuffer>;
	readonly TRIANGULAR_MESH: number;
	readonly DT_INT8: number;
	readonly DT_UINT8: number;
	readonly DT_INT16: number;
	readonly DT_UINT16: number;
	readonly DT_UINT32: number;
	readonly DT_FLOAT32: number;
}

/** Starts the decoder with a WebAssembly instance that `instantiateWasm` makes. */
export type DracoFactory = (options: {
	instantiateWasm(
		imports: WebAssembly.Imports,
		receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
	): object;
}) => Promise<DracoModule>;

declare const factory: DracoFactory | undefined;
export default factory;
