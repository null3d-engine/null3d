// The points' scene (bench/scenes/points.ts), which the parity test also draws with three.js:
// opaque squares sized in world units at several depths, cut-out and see-through discs of a map,
// and squares sized in pixels near the floor. The three.js twin draws with no tone mapping, three.js's
// default, so the sketch turns off the engine's default curve.
import { color, defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	discRows,
	POINT_BOXES,
	POINT_CAMERA,
	POINT_CLOUDS,
	SUN,
} from '../../../bench/scenes/points';
import { pictureUrl } from '../lib/picture';

export default defineSketch(async ({ scene, materials, geometry, assets, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = POINT_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));
	for (const { size, position: center, color: paint } of POINT_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color: paint }),
			position: center,
		});
	}

	const url = await pictureUrl(discRows());
	const disc = await assets.loadTexture(url);
	URL.revokeObjectURL(url);
	const linear = [0, 0, 0];
	for (const cloud of POINT_CLOUDS) {
		const colors = cloud.colors.flatMap((hex) => color.fromHex(linear, hex).slice());
		await scene.createPoints({
			positions: cloud.positions.flat(),
			colors,
			size: cloud.size,
			sizeAttenuation: !cloud.pixels,
			map: cloud.map ? disc : undefined,
			alphaMode: cloud.alphaMode,
			opacity: cloud.opacity,
		});
	}
});
