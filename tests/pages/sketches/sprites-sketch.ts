// The sprites' scene (bench/scenes/sprites.ts), which the parity test also draws with three.js:
// blended sprites that show frames of an atlas at several sizes, rotations, colors and depths, and
// opaque sprites that keep their size in pixels and stand on their positions. The three.js twin
// draws with no tone mapping, three.js's default, so the sketch turns off the engine's ACES.
import { color, defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	SCREEN_CENTER,
	SCREEN_SPRITES,
	SPRITE_ATLAS,
	SPRITE_BOXES,
	SPRITE_CAMERA,
	type SpriteSpec,
	SUN,
	spriteAtlasRows,
	WORLD_SPRITES,
} from '../../../bench/scenes/sprites';
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
	const { fov, near, far, position, target } = SPRITE_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));
	for (const { size, position: center, color: paint } of SPRITE_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color: paint }),
			position: center,
		});
	}

	const url = await pictureUrl(spriteAtlasRows());
	const map = await assets.loadTexture(url);
	URL.revokeObjectURL(url);
	const { columns, rows } = SPRITE_ATLAS;
	const world = scene.createSprites({ count: WORLD_SPRITES.length, map, atlas: { columns, rows } });
	const onScreen = scene.createSprites({
		count: SCREEN_SPRITES.length,
		alphaMode: 'opaque',
		sizeAttenuation: false,
		center: SCREEN_CENTER,
	});
	const linear = [0, 0, 0];
	for (const [batch, specs] of [
		[world, WORLD_SPRITES],
		[onScreen, SCREEN_SPRITES],
	] as const) {
		specs.forEach((spec: SpriteSpec, k: number) => {
			batch.positions.set(spec.position, k * 3);
			batch.sizes.set(spec.size, k * 2);
			batch.rotations[k] = spec.rotation;
			color.fromHex(linear, spec.color);
			batch.colors.set([linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0, spec.alpha], k * 4);
			batch.frames[k] = spec.frame;
		});
	}
});
