// The fog's scene (bench/scenes/fog.ts): towers on a floor that runs away from the camera, in the
// fog that ?fog= names. The parity test also draws the linear and exponential squared fogs with
// three.js. Two towers have materials with fog off, and keep their colors far away.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	FOG_BOXES,
	FOG_CAMERA,
	FOG_COLOR,
	FOG_SETTINGS,
	FOG_SUN_DIRECTION,
	type FogName,
	SUN,
} from '../../../bench/scenes/fog';

const params = new URL(import.meta.url).searchParams;
const fogName = (params.get('fog') ?? 'linear') as FogName;

export default defineSketch(({ scene, materials, geometry, post }) => {
	const fog = FOG_SETTINGS[fogName];
	if (!fog) throw new Error(`?fog= must be one of ${Object.keys(FOG_SETTINGS).join(', ')}`);
	// The three.js twin draws with no tone mapping, three.js's default.
	post.set({ toneMapping: 'none' });
	scene.setBackground(FOG_COLOR);
	scene.setFog(fog);
	scene.createDirectionalLight({
		direction: fogName === 'sun' ? FOG_SUN_DIRECTION : SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	scene.setActiveCamera(scene.createPerspectiveCamera(FOG_CAMERA));

	for (const { size, position, color, lit, fog: takesFog } of FOG_BOXES) {
		const [width, height, depth] = size;
		const options = { color, fog: takesFog };
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: lit ? materials.standard(options) : materials.unlit(options),
			position,
		});
	}
	return {};
});
