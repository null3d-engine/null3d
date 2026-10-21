// Contact shadows on the faces that the camera sees from the side away from the sun. Three upright
// green cards stand on a gray ground, lit from behind by a low sun. Their material lights both
// faces as an upper face, as grass often does, so the sun lights the face that the camera sees.
// The contact shadows' march starts from that face and runs through the card itself, so it must
// not darken the card. The ground in front of the cards keeps its contact shadows.
//
// ?off turns contact shadows off for the light.
import { defineSketch } from '@null3d/engine';

const OFF = new URL(import.meta.url).searchParams.has('off');

/** Lights both faces of the card as a face that looks up. */
const upward = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.normal = vec3f(0.0, 1.0, 0.0);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, quality }) => {
	quality.set({ governor: false, contactShadowSteps: 8 });
	scene.setBackground('#9fb4c8');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			position: [0, 0.9, 3],
			target: [0, 0.35, 0],
			near: 0.1,
			far: 100,
		}),
	);
	// The sun stands behind the cards, so the camera sees their faces away from it.
	scene.createDirectionalLight({
		direction: [0.25, -0.5, 0.83],
		color: '#fff1dc',
		intensity: 3,
		castShadows: true,
		shadow: { cascades: 1, mapSize: 1024, distance: 20, contactDistance: OFF ? 0 : 0.3 },
	});
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.5 });
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#9a9a9a', roughness: 0.95 }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	const card = materials.shader({
		wgsl: upward,
		color: '#30d030',
		roughness: 0.8,
		doubleSided: true,
	});
	const plane = geometry.plane({ width: 0.5, height: 0.7 });
	for (const x of [-0.7, 0, 0.7])
		scene.createMesh({
			mesh: plane,
			material: card,
			position: [x, 0.35, 0],
			castShadows: true,
			receiveShadows: true,
		});
});
