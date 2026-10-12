// A layer of particles in null3D: one sprite batch, which draws a scene's sprite rows
// (examples/lib/particles.ts) in one draw. The engine culls the sprites and sorts blended ones from
// back to front. When the particles add-on lands, a layer moves to it here, and the scenes keep
// their rows.

import type { SketchContext } from '@null3d/engine';
import type { SpriteLayer, SpriteRows } from './particles';

function copy(to: Float32Array | Uint32Array, from: Float32Array | Uint32Array, length: number) {
	for (let i = 0; i < length; i++) to[i] = from[i] as number;
}

/** A drawn layer: `draw` copies the rows' live sprites into the batch, each frame. */
export interface Null3dSprites {
	draw(rows: SpriteRows): void;
}

export async function null3dSprites(
	{ scene, textures }: Pick<SketchContext, 'scene' | 'textures'>,
	layer: SpriteLayer,
): Promise<Null3dSprites> {
	const { texture, columns, rows: atlasRows } = layer.atlas;
	const map = textures.fromData({
		width: texture.size,
		height: texture.size,
		data: texture.data,
		colorSpace: texture.colorSpace,
		mipmaps: true,
	});
	const batch = await scene.createSprites({
		count: layer.capacity,
		map,
		atlas: { columns, rows: atlasRows },
		blending: layer.blending,
		depthWrite: false,
		fog: layer.fog,
		dynamic: true,
	});
	batch.setActiveCount(0);
	return {
		draw(rows) {
			const count = Math.min(rows.count, layer.capacity);
			// The views are read each frame, as the engine's memory can grow. Plain loops copy the
			// live rows without making views of them.
			copy(batch.positions, rows.positions, count * 3);
			copy(batch.sizes, rows.sizes, count * 2);
			copy(batch.rotations, rows.rotations, count);
			copy(batch.colors, rows.colors, count * 4);
			copy(batch.frames, rows.frames, count);
			batch.setActiveCount(count);
		},
	};
}
