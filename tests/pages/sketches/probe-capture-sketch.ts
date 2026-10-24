// The sketch of the moving-object reflection test: a room whose walls glow a color each, a mirror
// floor, and a glowing sphere that the page moves in steps. The floor takes no light but the
// reflection probe's, and the probe captures once, so the floor shows the sphere where the probe
// last captured it. The page sends each move, with a flag that asks for a capture, and reads the
// floor back to find the side of the room that the sphere reflects on.
import { defineSketch, type Vec3 } from '@null3d/engine';

/** Half the room's width and depth, and its height. */
const HALF = 4;
const HEIGHT = 4;
/** The first place of the sphere, at the left of the floor's reflection. */
const START = -2.5;

/** A message from the page: where to put the sphere, and whether to capture the probe again. */
interface Move {
	x: number;
	capture: boolean;
}

export default defineSketch(({ scene, materials, geometry, page }) => {
	scene.setBackground('#000000');
	// The camera draws the room alone. The sphere stands on a layer of its own, which the probe
	// captures and the camera leaves out, so the only image of the sphere on the screen is its
	// reflection on the floor.
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 70,
			position: [0, 2.6, 3.4],
			target: [0, 0.4, -1.2],
			layers: 0b01,
		}),
	);
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
		material: materials.standard({ color: '#ffffff', metalness: 1, roughness: 0 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	// The object that moves, in a color that no wall or ceiling holds, so the test finds its
	// reflection among the walls'.
	const sphere = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.6, widthSegments: 48, heightSegments: 24 }),
		material: materials.standard({ color: '#000000', emissive: '#ff20ff', emissiveIntensity: 2 }),
		position: [START, 1.2, -1],
		layers: 0b10,
		dynamic: true,
	});
	const probe = scene.createReflectionProbe({
		box: { min: [-HALF, 0, -HALF], max: [HALF, HEIGHT, HALF] },
		position: [0, 1.5, 0],
		blend: 0,
		layers: 0b11,
	});
	page.onMessage((type, data) => {
		if (type !== 'move') return;
		const move = data as Move;
		sphere.setPosition(move.x, 1.2, -1);
		if (move.capture) probe.capture();
	});
	return {};
});
