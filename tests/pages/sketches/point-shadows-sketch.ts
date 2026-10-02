// Point light shadows: a point light hangs low among casters, so their shadows fall away from it in
// every direction, across the six tiles of its cube. A wall behind receives shadows too. A box
// receives shadows but casts none, a post casts but receives none, and an unlit box shows no shadow
// on itself. The page's ?pointLightShadows switch turns point light shadows on, as the presets of
// some GPU tiers leave them off, and ?shadowTileSize= fixes the tile size.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 7, 10],
		target: [0, 0, -1],
		far: 100,
	});
	scene.setActiveCamera(camera);
	scene.createPointLight({
		position: [0, 1.8, -1],
		color: '#ffe2b8',
		intensity: 30,
		range: 14,
		castShadows: true,
	});
	scene.createAmbientLight({ intensity: 0.12 });

	const ground = materials.standard({ color: '#9aa0a8' });
	const red = materials.standard({ color: '#e8554e' });
	const yellow = materials.standard({ color: '#f2c14e' });
	const green = materials.standard({ color: '#5bc27a' });
	const blue = materials.standard({ color: '#4a8cff' });
	const unlit = materials.unlit({ color: '#b06ce0' });
	const box = geometry.box();
	const both = { castShadows: true, receiveShadows: true };

	scene.createMesh({
		mesh: geometry.box({ width: 30, height: 0.2, depth: 30 }),
		material: ground,
		position: [0, -0.1, -2],
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 5, depth: 0.2 }),
		material: ground,
		position: [0, 2.5, -6],
		receiveShadows: true,
	});
	// Casters on every side of the light.
	scene.createMesh({ mesh: box, material: red, position: [-2, 0.5, -1], ...both });
	scene.createMesh({ mesh: box, material: red, position: [2.2, 0.5, -0.6], ...both });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.6 }),
		material: yellow,
		position: [0.4, 0.6, -3],
		...both,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.3, height: 3, depth: 0.3 }),
		material: blue,
		position: [-0.8, 1.5, 0.8],
		castShadows: true,
	});
	scene.createMesh({
		mesh: box,
		material: green,
		position: [-1.2, 0.5, 2.5],
		receiveShadows: true,
	});
	scene.createMesh({ mesh: box, material: unlit, position: [3, 0.5, -3.5], ...both });
});
