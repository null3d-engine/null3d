// The shadow-catcher scene (bench/scenes/shadow-catcher.ts), which the parity test also draws with
// three.js: a flat plane that shows only the main directional light's shadow, in the material's
// color, with boxes, a post and a ball above it that cast the shadows onto it. The background shows
// through where the light reaches the plane. ?tone=none turns off the engine's default of ACES, as
// the parity test asks: the three.js twin draws with no tone mapping, three.js's default.
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

/** A plane laid flat on the ground: a quarter turn about x. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

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
		shadow: { mapSize, distance },
	});
	scene.createAmbientLight({
		color: SHADOW_CATCHER_AMBIENT.color,
		intensity: SHADOW_CATCHER_AMBIENT.intensity,
	});

	const [width, height] = SHADOW_CATCHER.size;
	const plane = scene.createMesh({
		mesh: geometry.plane({ width, height }),
		material: materials.shadowCatcher({
			color: SHADOW_CATCHER.color,
			opacity: SHADOW_CATCHER.opacity,
		}),
		position: SHADOW_CATCHER.position,
		rotation: FLAT,
	});
	plane.setReceiveShadows(true);

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
