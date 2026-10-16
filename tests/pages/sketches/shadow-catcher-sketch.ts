// The shadow-catcher scene (bench/scenes/shadow-catcher.ts), which the parity test also draws with
// three.js: a large ground that shows only the main directional light's shadow, in the material's
// color, with boxes, a post and a ball on it that cast the shadows. The background shows through
// where the light reaches the ground. ?tone=none turns off the engine's default of ACES, as the
// parity test asks: the three.js twin draws with no tone mapping, three.js's default.
import { defineSketch } from '@null3d/engine';
import {
	SHADOW_CATCHER,
	SHADOW_CATCHER_AMBIENT,
	SHADOW_CATCHER_BACKGROUND,
	SHADOW_CATCHER_CAMERA,
	SHADOW_CATCHER_CASTERS,
	SHADOW_CATCHER_SUN,
} from '../../../bench/scenes/shadow-catcher';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	scene.setBackground(SHADOW_CATCHER_BACKGROUND);
	const { fov, position, target, near, far } = SHADOW_CATCHER_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, position, target, near, far }));
	const { direction, color, intensity, mapSize, distance } = SHADOW_CATCHER_SUN;
	scene.createDirectionalLight({
		direction,
		color,
		intensity,
		castShadows: true,
		shadow: { cascades: 3, mapSize, distance },
	});
	scene.createAmbientLight({
		color: SHADOW_CATCHER_AMBIENT.color,
		intensity: SHADOW_CATCHER_AMBIENT.intensity,
	});

	const [width, depth] = SHADOW_CATCHER.size;
	scene.createMesh({
		mesh: geometry.box({ width, height: 0.2, depth }),
		// The scene's ground is black, the catcher's default, so the sketch leaves the color out and
		// the image test covers the default.
		material: materials.shadowCatcher({ opacity: SHADOW_CATCHER.opacity }),
		position: SHADOW_CATCHER.position,
		receiveShadows: true,
	});

	const stone = materials.standard({ color: '#8d94a0', roughness: 0.7 });
	for (const caster of SHADOW_CATCHER_CASTERS) {
		const mesh =
			caster.kind === 'ball'
				? geometry.sphere({ radius: caster.radius })
				: geometry.box({
						width: caster.size[0],
						height: caster.size[1],
						depth: caster.size[2],
					});
		const object = scene.createMesh({ mesh, material: stone, position: caster.position });
		object.setCastShadows(true);
	}
});
