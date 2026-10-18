// Reflection probes in a closed room, 8 m wide and deep and 4 m tall. Each wall glows a color of
// its own: red at +X, green at -X, blue at +Z behind the camera, and yellow at -Z ahead of it. The
// ceiling glows white. The floor is a smooth metal mirror, and a chrome ball floats in the middle,
// on a layer that the camera draws and the probe leaves out, so the ball does not fill its capture.
// A probe fills the room, so the floor and the ball reflect each wall on its own side, where the
// wall stands: the probe spec checks the colors there. The scene has no environment, so a surface
// that the probe does not light reflects black. ?rough makes the floor rough, which blurs its
// reflections. ?flat turns box projection off. ?two splits the room into two probes along x, a
// wider one in the west at priority 0 and the east one with a blend of 1 m. ?always captures in
// every frame. ?none draws the room without a probe.
import { defineSketch, type Vec3 } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** Half the room's width and depth, and its height. */
const HALF = 4;
const HEIGHT = 4;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 70,
		position: [0, 2.6, 3.4],
		target: [0, 0.4, -1.2],
		layers: 0b11,
	});
	scene.setActiveCamera(camera);
	const glow = (color: string) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: 1 });
	const wall = (center: Vec3, size: Vec3, color: string) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: glow(color),
			position: center,
		});
	wall([HALF + 0.1, HEIGHT / 2, 0], [0.2, HEIGHT, 2 * HALF], '#ff2020');
	wall([-HALF - 0.1, HEIGHT / 2, 0], [0.2, HEIGHT, 2 * HALF], '#20ff20');
	wall([0, HEIGHT / 2, HALF + 0.1], [2 * HALF, HEIGHT, 0.2], '#2040ff');
	wall([0, HEIGHT / 2, -HALF - 0.1], [2 * HALF, HEIGHT, 0.2], '#ffd020');
	wall([0, HEIGHT + 0.1, 0], [2 * HALF, 0.2, 2 * HALF], '#ffffff');
	scene.createMesh({
		mesh: geometry.plane({ width: 2 * HALF, height: 2 * HALF }),
		material: materials.standard({
			color: '#ffffff',
			metalness: 1,
			roughness: params.has('rough') ? 0.45 : 0,
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.6, widthSegments: 48, heightSegments: 24 }),
		material: materials.standard({ color: '#ffffff', metalness: 1, roughness: 0.05 }),
		position: [0, 1.2, -1],
		layers: 0b10,
	});
	if (params.has('none')) return {};
	const refresh = params.has('always') ? 'always' : 'once';
	const boxProjection = !params.has('flat');
	if (params.has('two')) {
		scene.createReflectionProbe({
			box: { min: [-HALF, 0, -HALF], max: [1, HEIGHT, HALF] },
			position: [-1.5, 1.5, 0],
			refresh,
			boxProjection,
		});
		scene.createReflectionProbe({
			box: { min: [0, 0, -HALF], max: [HALF, HEIGHT, HALF] },
			position: [2, 1.5, 0],
			blend: 1,
			refresh,
			boxProjection,
		});
	} else
		scene.createReflectionProbe({
			box: { min: [-HALF, 0, -HALF], max: [HALF, HEIGHT, HALF] },
			position: [0, 1.5, 0],
			blend: 0,
			refresh,
			boxProjection,
		});
	return {};
});
