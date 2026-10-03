// The glTF worker: parses glTF files off the sketch's frames, for the glTF loader (scene/gltf.ts),
// which starts it with the first file. Each file arrives as bytes. The worker reads its container
// and JSON, and asks for the buffers that the file names by address, which the loader downloads.
// Then it parses the file, decodes the PNG, JPEG and WebP images that the file holds with
// createImageBitmap, once for each way a material uses them, and hands everything back in one
// message that moves the arrays and images rather than copying them. A file it refuses comes back
// as an error with the engine's code, so no load ever waits for an answer that does not come.

import {
	type GltfContainer,
	type GltfData,
	GltfError,
	parseGltf,
	readContainer,
} from '../scene/gltf-parse';

/** A request of the loader: a new file, or the buffers that a file asked for. */
export type GltfRequest =
	| { id: number; file: ArrayBuffer; url: string }
	| { id: number; buffers: [number, ArrayBuffer][] };

/** An answer: the buffers a file needs, the parsed file, or why it failed. */
export type GltfAnswer =
	| { id: number; needs: [number, string][] }
	| { id: number; data: GltfData; bitmaps: (ImageBitmap | undefined)[] }
	| { id: number; error: { code: string; message: string } };

/** The identifier that starts every KTX2 file. */
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** Files that wait for their buffers, by request. */
const waiting = new Map<number, { container: GltfContainer; url: string }>();

self.onmessage = (event: MessageEvent<GltfRequest>) => {
	const request = event.data;
	const { id } = request;
	try {
		if ('file' in request) {
			const container = readContainer(new Uint8Array(request.file), request.url);
			if (container.external.size > 0) {
				waiting.set(id, { container, url: request.url });
				answer({ id, needs: [...container.external] });
				return;
			}
			finish(id, container, new Map(), request.url);
			return;
		}
		const file = waiting.get(id);
		waiting.delete(id);
		if (!file) return;
		const buffers = new Map(request.buffers.map(([k, bytes]) => [k, new Uint8Array(bytes)]));
		finish(id, file.container, buffers, file.url);
	} catch (error) {
		fail(id, error);
	}
};

/** Parses a file whose buffers are all here, decodes its images, and answers with the result. */
function finish(
	id: number,
	container: GltfContainer,
	buffers: Map<number, Uint8Array>,
	url: string,
): void {
	const data = parseGltf(container, buffers, url);
	Promise.all(data.textures.map((use) => decode(data, use.image, use.colorSpace))).then(
		(bitmaps) => {
			const transfer = new Set<Transferable>();
			for (const bitmap of bitmaps) if (bitmap) transfer.add(bitmap);
			for (const mesh of data.meshes)
				for (const p of mesh.primitives)
					for (const array of [
						p.positions,
						p.normals,
						p.uvs,
						p.uvs1,
						p.colors,
						p.tangents,
						p.joints,
						p.weights,
					])
						if (array) transfer.add(array.array.buffer as ArrayBuffer);
			for (const mesh of data.meshes)
				for (const p of mesh.primitives)
					if (p.indices) transfer.add(p.indices.buffer as ArrayBuffer);
			for (const node of data.nodes)
				if (node.instancing)
					for (const array of [
						node.instancing.positions,
						node.instancing.rotations,
						node.instancing.scales,
					])
						transfer.add(array.buffer as ArrayBuffer);
			// Images that the worker decoded go back as bitmaps alone.
			data.images.forEach((image, k) => {
				if (image.bytes && !isKtx2(image.bytes) && data.textures.some((u) => u.image === k))
					image.bytes = undefined;
				else if (image.bytes) transfer.add(image.bytes.buffer as ArrayBuffer);
			});
			answer({ id, data, bitmaps }, [...transfer]);
		},
		(error) => fail(id, error),
	);
}

/**
 * The bitmap of an image that the file holds, decoded for one color space, or undefined for an
 * image that the file names by address or that holds KTX2 data, which the loader handles.
 */
async function decode(
	data: GltfData,
	k: number,
	colorSpace: 'srgb' | 'linear',
): Promise<ImageBitmap | undefined> {
	const image = data.images[k];
	if (!image?.bytes || isKtx2(image.bytes)) return undefined;
	const blob = new Blob([image.bytes as Uint8Array<ArrayBuffer>], {
		type: image.mimeType ?? '',
	});
	try {
		return await createImageBitmap(blob, {
			premultiplyAlpha: 'none',
			colorSpaceConversion: colorSpace === 'linear' ? 'none' : 'default',
		});
	} catch (error) {
		throw new GltfError(
			'E1416',
			`image ${k} (${image.mimeType ?? 'no media type'}) does not decode: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function isKtx2(bytes: Uint8Array): boolean {
	return KTX2_IDENTIFIER.every((byte, k) => bytes[k] === byte);
}

function fail(id: number, error: unknown): void {
	waiting.delete(id);
	const code = error instanceof GltfError ? error.code : 'E1416';
	const message = error instanceof Error ? error.message : String(error);
	answer({ id, error: { code, message } });
}

function answer(message: GltfAnswer, transfer: Transferable[] = []): void {
	(self as unknown as Worker).postMessage(message, transfer);
}
