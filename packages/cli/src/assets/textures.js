// The tool's step for textures: each PNG and JPEG image of a model becomes a KTX2 file beside the
// model, encoded for what the materials read from it. The files take their names from their
// contents, so models that share a texture share its file, and a host may keep them for good.
import { createHash } from 'node:crypto';
import { encodeOnce } from './encoder-pool.js';

/** @import { Document, Texture } from '@gltf-transform/core' */
/** @import { Codec, EncodedTexture, TextureKind } from './encoder.js' */

/** The folder of the texture files, beside the models, unless a command names another. */
export const TEXTURE_FOLDER = 'textures';

/** Material slots whose textures hold sRGB colors. Every other slot holds linear values. */
const COLOR_SLOTS = new Set([
	'baseColorTexture',
	'emissiveTexture',
	'sheenColorTexture',
	'specularColorTexture',
	'diffuseTexture',
	'specularGlossinessTexture',
]);

/** Images that the encoder reads. */
const ENCODED_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * How the tool chooses texture formats: `size` encodes color and data maps in ETC1S, and `high`
 * in UASTC. Normal maps take UASTC either way, since ETC1S blurs their detail.
 *
 * @typedef {'size' | 'high'} TextureQuality
 */

/**
 * A texture as the tool wrote it.
 *
 * @typedef {object} TextureRecord
 * @property {string} name The texture's name in the model, or its image's address.
 * @property {string} uri The file's address from the model.
 * @property {TextureKind | 'kept'} kind What the texture holds, or `kept` for a KTX2 image that
 *   the model had already.
 * @property {Codec} codec The format: for a kept image, `etc1s` when it has BasisLZ
 *   supercompression, as ETC1S data does, and `uastc` otherwise.
 * @property {number} width
 * @property {number} height
 * @property {number} sourceWidth
 * @property {number} sourceHeight
 * @property {boolean} alpha
 * @property {number} bytes The file's size.
 * @property {number} ms The encode's time, or 0 for a texture that took none.
 */

/**
 * The slot kind of each place that reads a texture.
 *
 * @param {Document} doc
 * @param {Texture} texture
 * @returns {{ parent: import('@gltf-transform/core').Property, kind: TextureKind }[]}
 */
function usesOf(doc, texture) {
	return doc
		.getGraph()
		.listParentEdges(texture)
		.filter((edge) => edge.getName() !== 'textures')
		.map((edge) => {
			const slot = edge.getName();
			/** @type {TextureKind} */
			const kind = /normal/i.test(slot) ? 'normal' : COLOR_SLOTS.has(slot) ? 'color' : 'data';
			return { parent: edge.getParent(), kind };
		});
}

/**
 * Gives each texture one kind. A texture that slots of two kinds read, such as a base color map
 * that a material also reads as its occlusion map, gets a copy for each other kind, which the
 * materials of that kind then read. A material that reads one image in two kinds keeps it in the
 * first kind.
 *
 * @param {Document} doc
 * @returns {Map<Texture, TextureKind>}
 */
export function textureKinds(doc) {
	/** @type {Map<Texture, TextureKind>} */
	const kinds = new Map();
	const order = /** @type {TextureKind[]} */ (['normal', 'color', 'data']);
	for (const texture of doc.getRoot().listTextures()) {
		const uses = usesOf(doc, texture);
		const found = order.filter((kind) => uses.some((use) => use.kind === kind));
		const [first, ...rest] = found.length > 0 ? found : /** @type {TextureKind[]} */ (['data']);
		kinds.set(texture, /** @type {TextureKind} */ (first));
		for (const kind of rest) {
			const parents = new Set(
				uses
					.filter((use) => use.kind === kind)
					.map((use) => use.parent)
					.filter((parent) => uses.every((use) => use.parent !== parent || use.kind === kind)),
			);
			if (parents.size === 0) continue;
			const copy = texture.clone();
			for (const parent of parents) parent.swap(texture, copy);
			kinds.set(copy, kind);
		}
	}
	return kinds;
}

/**
 * The codec of a texture of a kind.
 *
 * @param {TextureKind} kind
 * @param {TextureQuality} quality
 * @returns {Codec}
 */
export const codecFor = (kind, quality) =>
	kind === 'normal' || quality === 'high' ? 'uastc' : 'etc1s';

/**
 * The file name of a texture: its content's hash, so equal files share a name.
 *
 * @param {Uint8Array} bytes
 */
const fileName = (bytes) => `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.ktx2`;

/**
 * Encodes every PNG and JPEG texture of a model as a KTX2 file, and gives the model each file's
 * address in place of its image. KTX2 images that the model had move to files too. Other images
 * stay as they are. The same image read in the same way encodes once.
 *
 * @param {Document} doc
 * @param {object} options
 * @param {(job: import('./encoder.js').TextureJob) => Promise<EncodedTexture>} options.encode
 * @param {number} options.maxSide
 * @param {string} options.folder The texture folder's address from the model, such as `textures`.
 * @param {TextureQuality} options.quality
 * @returns {Promise<{ files: Map<string, Uint8Array>, records: TextureRecord[], uris: Map<Texture, string> }>}
 *   The texture files by name, a record of each texture, and each texture's file address.
 */
export async function encodeTextures(doc, { encode, maxSide, quality, folder }) {
	const kinds = textureKinds(doc);
	const encodeImage = encodeOnce(encode);
	const results = await Promise.all(
		[...kinds].map(async ([texture, kind]) => {
			const image = texture.getImage();
			const mimeType = texture.getMimeType();
			if (!image) return undefined;
			const name = texture.getName() || texture.getURI();
			if (mimeType === 'image/ktx2')
				return { texture, record: keptRecord(name, image), ktx2: image };
			if (!ENCODED_TYPES.has(mimeType)) return undefined;
			const codec = codecFor(kind, quality);
			const encoded = await encodeImage({ bytes: image, mimeType, kind, codec, maxSide });
			/** @type {TextureRecord} */
			const record = {
				name,
				uri: '',
				kind,
				codec,
				width: encoded.width,
				height: encoded.height,
				sourceWidth: encoded.sourceWidth,
				sourceHeight: encoded.sourceHeight,
				alpha: encoded.alpha,
				bytes: encoded.ktx2.byteLength,
				ms: encoded.ms,
			};
			return { texture, record, ktx2: encoded.ktx2 };
		}),
	);
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	/** @type {Map<Texture, string>} */
	const uris = new Map();
	/** @type {TextureRecord[]} */
	const records = [];
	for (const result of results) {
		if (!result) continue;
		const name = fileName(result.ktx2);
		const uri = `${folder}/${name}`;
		files.set(name, result.ktx2);
		uris.set(result.texture, uri);
		result.texture
			.setMimeType('image/ktx2')
			.setURI(uri)
			.setImage(/** @type {any} */ (null));
		records.push({ ...result.record, uri });
	}
	return { files, records, uris };
}

/** The bytes of a KTX2 file's header, up to its supercompression scheme. */
const KTX2_HEADER_BYTES = 48;

/**
 * The record of a KTX2 image that the model had, with its size and format from the file's header.
 *
 * @param {string} name
 * @param {Uint8Array} ktx2
 * @returns {TextureRecord}
 */
function keptRecord(name, ktx2) {
	const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
	const header = ktx2.byteLength >= KTX2_HEADER_BYTES;
	const width = header ? view.getUint32(20, true) : 0;
	const height = header ? view.getUint32(24, true) : 0;
	const basisLz = header && view.getUint32(44, true) === 1;
	return {
		name,
		uri: '',
		kind: 'kept',
		codec: basisLz ? 'etc1s' : 'uastc',
		width,
		height,
		sourceWidth: width,
		sourceHeight: height,
		alpha: false,
		bytes: ktx2.byteLength,
		ms: 0,
	};
}
