// The three.js twin of the sprites' scene (bench/scenes/sprites.ts), which null3D's image tests
// draw. Each sprite is a `Sprite` with a `SpriteMaterial` of its own: a blended sprite's material
// takes a copy of the atlas whose offset and repeat pick its frame, and an opaque sprite's material
// keeps its size on screen with `sizeAttenuation: false`. It draws the scene once into an offscreen
// target of the image's size, and publishes the pixels as the hold pages do. `?renderer=webgl`
// draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { pictureUrl } from '../../../tests/pages/lib/picture';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	SCREEN_CENTER,
	SCREEN_SPRITES,
	SPRITE_ATLAS,
	SPRITE_BOXES,
	SPRITE_CAMERA,
	SPRITE_COUNT,
	SPRITE_IMAGE,
	spriteAtlasRows,
	threeScreenScale,
	WORLD_SPRITES,
} from '../../scenes/sprites';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);

	for (const { size, position, color } of SPRITE_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}

	const url = await pictureUrl(spriteAtlasRows());
	const atlas = await new three.TextureLoader().loadAsync(url);
	URL.revokeObjectURL(url);
	atlas.colorSpace = three.SRGBColorSpace;
	const { columns, rows } = SPRITE_ATLAS;
	for (const { position, size, rotation, color, alpha, frame } of WORLD_SPRITES) {
		// Frame 0 is the atlas's top left, and the texture's v grows upward.
		const map = atlas.clone();
		map.repeat.set(1 / columns, 1 / rows);
		map.offset.set((frame % columns) / columns, (rows - 1 - Math.floor(frame / columns)) / rows);
		const material = new three.SpriteMaterial({ map, color, opacity: alpha, rotation });
		const sprite = new three.Sprite(material);
		sprite.position.set(...position);
		sprite.scale.set(size[0], size[1], 1);
		scene.add(sprite);
	}

	const { width, height } = SPRITE_IMAGE;
	const { fov, near, far, position, target } = SPRITE_CAMERA;
	for (const { position: at, size, rotation, color } of SCREEN_SPRITES) {
		const material = new three.SpriteMaterial({
			color,
			rotation,
			sizeAttenuation: false,
			transparent: false,
		});
		const sprite = new three.Sprite(material);
		sprite.position.set(...at);
		sprite.center.set(...SCREEN_CENTER);
		const scale = (pixels: number) => threeScreenScale(pixels, height, fov);
		sprite.scale.set(scale(size[0]), scale(size[1]), 1);
		scene.add(sprite);
	}

	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'sprites',
		renderer: rendererName,
		n: SPRITE_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
