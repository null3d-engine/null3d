// A still headlight in thick night fog: a ground plane and a spot light whose cone reaches away
// from the camera, lit by the volumetric fog. The camera and every light hold still, so any change
// between two frames comes from the engine's own temporal steps. ?volumetric=off keeps the plain
// fog with its sun glow, so the surfaces' light alone can be measured.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const VOLUMETRIC = params.get('volumetric') !== 'off';

export default defineSketch(({ scene, materials, geometry, quality }) => {
	// A fixed render scale keeps the governor from changing the image's size between the frames that
	// the test compares.
	quality.set({ fogSlices: 32, minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground('#05070b');
	scene.setFog({
		color: '#0b0f16',
		density: 0.02,
		height: 0,
		heightFalloff: 0.1,
		sunGlow: 0,
		...(VOLUMETRIC ? { volumetric: { intensity: 1.7, anisotropy: 0.42, distance: 70 } } : {}),
	});
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.08,
		far: 200,
		position: [6, 2.4, 8],
		target: [0, 0.6, -4],
	});
	scene.setActiveCamera(camera);
	const ground = materials.standard({ color: '#15171c', roughness: 0.85 });
	scene.createMesh({
		mesh: geometry.plane({ width: 120, height: 120 }),
		material: ground,
		position: [0, 0, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const body = materials.standard({ color: '#2a1013', metalness: 0.6, roughness: 0.3 });
	scene.createMesh({
		mesh: geometry.box({ width: 1.8, height: 0.7, depth: 4 }),
		material: body,
		position: [0, 0.6, 1],
	});
	// Two head lamps, as the showroom's car carries them.
	for (const side of [-1, 1]) {
		scene.createSpotLight({
			position: [0.9, 0.6, side * 0.55],
			direction: [1, -0.1, 0],
			angle: 0.5,
			penumbra: 0.55,
			range: 46,
			intensity: 52,
			color: '#eaf3ff',
		});
	}
	// The lamps' own glow, so the beam shows where it comes from.
	const lamp = (side: number) => {
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.09, widthSegments: 12, heightSegments: 8 }),
			material: materials.standard({
				color: '#000000',
				emissive: '#eaf3ff',
				emissiveIntensity: 6,
			}),
			position: [1.72, 0.6, side * 0.55],
		});
	};
	lamp(-1);
	lamp(1);
	return {};
});
