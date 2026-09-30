// The fog's scene (bench/scenes/fog.ts), which the parity test also draws with three.js: towers on
// a floor that runs away from the camera, in linear fog with ?fog=linear or exponential squared fog
// with ?fog=exp2. Two towers have materials with fog off, and keep their colors far away.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	FOG_BOXES,
	FOG_CAMERA,
	FOG_COLOR,
	FOG_SETTINGS,
	type FogName,
	SUN,
} from '../../../bench/scenes/fog';

const params = new URL(import.meta.url).searchParams;
const fogName = (params.get('fog') ?? 'linear') as FogName;

export default defineSketch(({ scene, materials, geometry }) => {
	const fog = FOG_SETTINGS[fogName];
	if (!fog) throw new Error('?fog= must be linear or exp2');
	scene.setBackground(FOG_COLOR);
	scene.setFog(fog);
	scene.createDirectionalLight({
		direction: SUN.direction,
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
