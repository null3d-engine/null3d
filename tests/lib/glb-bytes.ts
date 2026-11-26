// Compares the GLB files that the asset tool writes with the ones that the repository holds, byte
// for byte apart from the name of the tool that wrote them. The tool names itself with its release
// version in each file's `asset.generator`. Without this, every release would change the bytes of
// every file that the repository holds, though nothing else in them changed.

/** The first word of a GLB file: "glTF". */
const GLB_MAGIC = 0x46546c67;
/** The type of a GLB file's first chunk, its JSON: "JSON". */
const JSON_CHUNK = 0x4e4f534a;
/** The generator that both files take before a comparison. */
const SHARED_GENERATOR = 'null3D asset tool';

/**
 * A GLB file's bytes with its asset's generator set to `generator`, and every other byte kept. Bytes
 * that hold no GLB file come back as they are.
 */
export function withGenerator(bytes: Uint8Array, generator: string): Buffer {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		bytes.byteLength < 20 ||
		view.getUint32(0, true) !== GLB_MAGIC ||
		view.getUint32(16, true) !== JSON_CHUNK
	)
		return Buffer.from(bytes);
	const jsonEnd = 20 + view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, jsonEnd)));
	json.asset.generator = generator;
	const text = new TextEncoder().encode(JSON.stringify(json));
	// A chunk's length is a multiple of 4 bytes, and the JSON chunk pads with spaces.
	const padded = Math.ceil(text.length / 4) * 4;
	const rest = bytes.subarray(jsonEnd);
	const out = Buffer.alloc(20 + padded + rest.length, 0x20);
	out.set(bytes.subarray(0, 12));
	out.writeUInt32LE(out.length, 8);
	out.writeUInt32LE(padded, 12);
	out.writeUInt32LE(JSON_CHUNK, 16);
	out.set(text, 20);
	out.set(rest, 20 + padded);
	return out;
}

/** True when two GLB files hold the same bytes, apart from the name of the tool that wrote them. */
export function sameModel(a: Uint8Array, b: Uint8Array): boolean {
	return withGenerator(a, SHARED_GENERATOR).equals(withGenerator(b, SHARED_GENERATOR));
}
