// The comparison scenes' particles in null3D: one sprite batch per system, which the engine culls,
// sorts and draws in one draw. A particle add-on can take this module's place behind the same
// interface (examples/lib/particles.ts).

import type { Scene, Textures } from '@null3d/engine';
import type { ParticleLook, ParticleMaker, ParticleRows, Particles } from './particles';

/** Makes a sketch's particle systems as sprite batches. */
export function null3dParticles(scene: Scene, textures: Textures): ParticleMaker {
	return async (look: ParticleLook): Promise<Particles> => {
		const map = textures.fromData({
			width: look.texture.size,
			height: look.texture.size,
			data: look.texture.data,
			colorSpace: look.texture.colorSpace,
			mipmaps: true,
		});
		const sprites = await scene.createSprites({
			count: look.capacity,
			map,
			blending: look.blending,
			depthWrite: false,
			fog: look.fog,
			dynamic: true,
		});
		sprites.setActiveCount(0);
		// One record whose arrays each frame refreshes, as the engine's memory can grow.
		const rows: ParticleRows = {
			positions: sprites.positions,
			sizes: sprites.sizes,
			colors: sprites.colors,
		};
		return {
			rows() {
				rows.positions = sprites.positions;
				rows.sizes = sprites.sizes;
				rows.colors = sprites.colors;
				return rows;
			},
			commit: (count) => sprites.setActiveCount(count),
		};
	};
}
