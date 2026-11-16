// KTX2 files from the tool's texels, through the asset tool's encoder: the official Basis Universal
// 2.50 build, single-threaded, so every machine writes the same bytes. Every file is ETC1S with
// every mip level, flipped so that its first row is the picture's bottom row: the engine reads a
// KTX2 file's first row at v = 0, so v runs up the picture.
import { loadEncoder } from '../../packages/cli/src/assets/encoder.js';

/** What the texels hold: sRGB colour (with coverage in alpha where it has any) or a normal map. */
export type TexelKind = 'color' | 'normal';

/** One file to write. */
export interface KtxJob {
	/** One RGBA8 image per layer, all one size, rows top first. */
	readonly layers: readonly Uint8Array[];
	readonly size: number;
	readonly kind: TexelKind;
	/** A texture array, even of one layer, or a 2D texture. */
	readonly array: boolean;
	/** True for a tile, whose mip levels then filter across its edges. */
	readonly tile: boolean;
	/** ETC1S quality from 1 to 255. */
	readonly quality: number;
}

/** ETC1S's effort, from 0 to 6: the default of the basisu command, as the asset tool uses. */
export const ETC1S_EFFORT = 2;

/** The encoder's name and settings, as the manifest records them. */
export const ENCODER = `Basis Universal 2.50, ETC1S, effort ${ETC1S_EFFORT}`;

/** The byte of a KTX2 header that holds the layer count. */
const LAYER_COUNT = 32;

/** Encodes one file. */
export async function encodeKtx2(job: KtxJob): Promise<Uint8Array> {
	const basis = await loadEncoder();
	const encoder = new basis.BasisEncoder();
	try {
		encoder.setCreateKTX2File(true);
		encoder.setDebug(false);
		encoder.setTexType(
			job.array
				? basis.basis_texture_type.cBASISTexType2DArray.value
				: basis.basis_texture_type.cBASISTexType2D.value,
		);
		encoder.setFormatMode(basis.basis_tex_format.cETC1S.value);
		encoder.setQualityLevel(job.quality);
		encoder.setETC1SCompressionLevel(ETC1S_EFFORT);
		if (job.kind === 'normal') {
			encoder.setNormalMapPreset();
			encoder.setRenormalize(true);
			encoder.setMipRenormalize(true);
		} else encoder.setSRGBOptions(true);
		encoder.setMipGen(true);
		encoder.setMipWrapping(job.tile);
		encoder.setCheckForAlpha(true);
		encoder.setYFlip(true);
		job.layers.forEach((texels, layer) => {
			encoder.setSliceSourceImage(
				layer,
				texels,
				job.size,
				job.size,
				basis.ldr_image_type.cRGBA32.value,
			);
		});
		const out = new Uint8Array(job.size * job.size * 4 * job.layers.length + 65536);
		const length = encoder.encode(out);
		if (!length) throw new Error('the Basis Universal encoder could not encode the texture');
		const file = out.slice(0, length);
		// The encoder writes an array of one layer as a 2D texture. A layer count of 1 says that the
		// file is an array, which the KTX2 format allows and every reader takes.
		if (job.array) new DataView(file.buffer).setUint32(LAYER_COUNT, job.layers.length, true);
		return file;
	} finally {
		encoder.delete();
	}
}
