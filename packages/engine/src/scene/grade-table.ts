// The built-in grading table's texture, which `post.set`'s grading values bake into. The bake runs
// in a job worker, and its texels go into one 3D texture here, so a change of the values costs the
// frames nothing but an upload of that texture.

import type { Texture, Textures } from './textures';

/** The texture store's grading table: one texture of the bake's texels a side. */
export class GradeTable {
	private texture: Texture | undefined;

	constructor(private readonly textures: Textures) {}

	/** Writes the table's texels, makes the texture the first time, and returns its handle. */
	write(texels: Float32Array): number {
		// The bake writes four numbers per texel of a table that is as long as it is wide.
		const side = Math.round((texels.length / 4) ** (1 / 3));
		if (!this.texture) {
			this.texture = this.textures.fromVolumeData(
				side,
				side,
				side,
				'rgba16float',
				texels,
				'post.set',
			);
		} else {
			this.textures.setData(this.texture, texels, 'post.set');
		}
		return this.texture.handle;
	}
}
