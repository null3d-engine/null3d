// What the meshopt unit tests share: meshoptimizer's reference decoder, which follows the format's
// rules in plain JavaScript, and triangles in a form that the triangle mode keeps. That mode keeps
// each triangle and its winding, but may start it at another corner.
import { dirname, join } from 'node:path';
import type { GltfData, MeshoptDecode } from '../../packages/engine/src/scene/gltf-parse.ts';

/** meshoptimizer's reference decoder, from the package that the engine depends on. */
export async function referenceDecoder(): Promise<MeshoptDecode> {
	const engine = join(import.meta.dirname, '../../packages/engine');
	const module = join(
		dirname(Bun.resolveSync('meshoptimizer/decoder', engine)),
		'meshopt_decoder_reference.js',
	);
	return (await import(module)).MeshoptDecoder.decodeGltfBuffer;
}

/** Triangles with each one's smallest index first. */
export function rotated<T extends Uint16Array | Uint32Array | undefined>(indices: T): T {
	if (!indices) return indices;
	const out = indices.slice() as Uint16Array | Uint32Array;
	for (let i = 0; i < out.length; i += 3) {
		const [a, b, c] = [out[i] as number, out[i + 1] as number, out[i + 2] as number];
		if (b < a && b < c) out.set([b, c, a], i);
		else if (c < a && c < b) out.set([c, a, b], i);
	}
	return out as T;
}

/** A parsed file with every primitive's triangles in the form of `rotated`. */
export function withRotatedTriangles(data: GltfData): GltfData {
	for (const mesh of data.meshes)
		for (const primitive of mesh.primitives) primitive.indices = rotated(primitive.indices);
	return data;
}
