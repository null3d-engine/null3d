// Probe: the depth precision scene with only some tiles, and optionally only the farther or the
// nearer surfaces.
import { defineSketch } from '@null3d/engine';
import { PRECISION, precisionSurfaces } from '../../lib/depth-precision';

export function depthScene(
	tiles: readonly number[],
	which: 'both' | 'back' | 'front' = 'both',
	shape: 'box' | 'thick' | 'plane' = 'box',
) {
	return defineSketch(({ scene, materials, geometry, post }) => {
		post.set({ toneMapping: 'none' });
		scene.setBackground(PRECISION.background);
		const camera = scene.createPerspectiveCamera({
			fov: PRECISION.fovDegrees,
			near: PRECISION.near,
			far: PRECISION.far,
			position: [0, 0, 0],
			target: [0, 0, -1],
		});
		scene.setActiveCamera(camera);
		const surface =
			shape === 'plane'
				? geometry.plane({ width: 1, height: 1 })
				: geometry.box({ width: 1, height: 1, depth: shape === 'thick' ? 0.001 : 0 });
		const back = materials.unlit({ color: PRECISION.back });
		const front = materials.unlit({ color: PRECISION.front });
		for (const s of precisionSurfaces()) {
			if (!tiles.includes(s.tile)) continue;
			if (which === 'back' && !s.back) continue;
			if (which === 'front' && s.back) continue;
			scene.createMesh({
				mesh: surface,
				material: s.back ? back : front,
				position: s.position,
				rotation: s.rotation,
				scale: s.scale,
			});
		}
		return {};
	});
}
