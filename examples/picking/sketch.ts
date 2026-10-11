// Picking with labels: six polished pieces stand on pedestals on a turning plinth in a dark gallery,
// each with an HTML label that follows it. Three spotlights light them, and the pieces reflect the
// built-in room environment. The pointer lights up the piece under it, and a click selects that
// piece: an outline marks it, its label says so, and a dot marks the point that the click's ray
// hit. object.on finds the piece under the pointer with no raycast in the sketch. ui.trackLabel
// tracks each label, and the examples page binds an element to it when the sketch posts the label's
// text. The plinth and the pieces turn by the sketch's time, so a held frame is the same each run.
import { defineSketch, mat4, math, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The ring's radius, in meters, and the height of the plinth's top. */
const RING = 2.2;
const TOP = -0.8;
/** The spotlights: a warm key and a light from above cast shadows, and a cool light rims. */
const SPOTS = [
	{ position: [3, 6, 5], color: '#ffe2c4', intensity: 200, castShadows: true },
	{ position: [0, 8, 0], color: '#fff4e8', intensity: 110, castShadows: true },
	{ position: [-4, 4, -6], color: '#8fb4ff', intensity: 150, castShadows: false },
] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, ui, page, time } = ctx;
	scene.setBackground('#060709');
	scene.setFog({ color: '#060709', density: 0.05 });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.25 });
	post.set({
		bloom: { intensity: 0.2, threshold: 1 },
		ao: { radius: 0.4 },
		outline: { color: '#ffffff', hiddenColor: '#7f8a99', width: 3 },
		vignette: { intensity: 0.9 },
	});
	const camera = scene.createPerspectiveCamera({ fov: 45, position: [0, 4.2, 6] });
	camera.lookAt(0, 0.3, 0);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.3, 0] });
	scene.createAmbientLight({ color: '#8090b0', intensity: 0.05 });
	for (const spot of SPOTS)
		scene.createSpotLight({ ...spot, target: [0, TOP, 0], range: 20, angle: 0.5, penumbra: 0.6 });

	// Stone floor slabs with dark joints, and a little grain in each texel.
	math.seed(5);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let i = 0; i < 64 * 64; i++) {
		const joint = i % 32 === 0 || (i >> 6) % 32 === 0;
		data.fill(joint ? 40 : math.randFloat(120, 135), i * 4, i * 4 + 3);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	scene.createMesh({
		mesh: geometry.circle({ radius: 60, segments: 64 }),
		material: materials.standard({
			map: textures.fromData({ width: 64, height: 64, data, ...look }),
			color: '#3a3836',
			roughness: 0.3,
			doubleSided: true,
			uvTransform: { repeat: [30, 30] },
		}),
		position: [0, TOP - 0.3, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The plinth turns, and carries a pedestal under each piece.
	const table = scene.createGroup({ name: 'table', dynamic: true });
	const solid = { parent: table, castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 3.2, radiusBottom: 3.3, height: 0.3, radialSegments: 64 }),
		material: materials.standard({ color: '#6e6a64', roughness: 0.2 }),
		position: [0, TOP - 0.15, 0],
		...solid,
	});
	const pedestal = geometry.box({ width: 0.8, height: 0.3, depth: 0.8 });
	const dark = materials.standard({ color: '#202226', roughness: 0.4 });
	// Each piece: glazed, chrome, gold, lacquer, satin and gloss.
	const rod = { radiusTop: 0.4, radiusBottom: 0.4, height: 1 };
	const pill = { radius: 0.3, height: 0.6, radialSegments: 24 };
	const pieces = [
		{ name: 'Box', mesh: geometry.box({ width: 0.9, height: 0.9, depth: 0.9 }), color: '#e8554e' },
		{ name: 'Sphere', mesh: geometry.sphere({ radius: 0.55 }), color: '#e8e8e8' },
		{ name: 'Torus', mesh: geometry.torus({ radius: 0.45, tube: 0.18 }), color: '#f2c14e' },
		{ name: 'Cone', mesh: geometry.cone({ radius: 0.5, height: 1 }), color: '#5bc27a' },
		{ name: 'Cylinder', mesh: geometry.cylinder(rod), color: '#3fb8af' },
		{ name: 'Capsule', mesh: geometry.capsule(pill), color: '#d65db1' },
	];
	const roughnesses = [0.2, 0.05, 0.25, 0.12, 0.4, 0.1];
	const metals = [0, 1, 1, 0, 0, 0];
	const items = pieces.map(({ name, mesh, color }, k) => {
		const angle = (k / pieces.length) * Math.PI * 2;
		const [x, z] = [Math.sin(angle) * RING, Math.cos(angle) * RING];
		scene.createMesh({ mesh: pedestal, material: dark, position: [x, TOP + 0.15, z], ...solid });
		const [roughness, metalness] = [roughnesses[k], metals[k]];
		const glow = { emissive: color, emissiveIntensity: 0, doubleSided: true };
		const material = materials.standard({ color, roughness, metalness, ...glow });
		const at = { position: [x, 0, z] as const, dynamic: true };
		const object = scene.createMesh({ name, mesh, material, ...at, ...solid });
		ui.trackLabel(object, name, { offset: [0, 0.9, 0] });
		return { name, object, material };
	});

	// A dot where the last click's ray hit. It rides the shape it marks, hidden until the first click.
	const dot = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.06 }),
		material: materials.unlit({ color: '#ffffff' }),
		dynamic: true,
	});
	dot.setVisible(false);
	const world = mat4.create();
	const local = vec3.create();

	const label = (item: (typeof items)[number], active: boolean) =>
		page.post('label', {
			id: item.name,
			text: active ? `${item.name}: selected` : item.name,
			active,
		});
	let selected = items[0];
	const select = (item: (typeof items)[number]) => {
		selected.object.setOutlined(false);
		label(selected, false);
		selected = item;
		item.object.setOutlined(true);
		label(item, true);
	};
	for (const item of items) {
		label(item, false);
		item.object.on('pointerenter', () => item.material.set({ emissiveIntensity: 0.35 }));
		item.object.on('pointerleave', () => item.material.set({ emissiveIntensity: 0 }));
		item.object.on('click', (event) => {
			// The hit point in the shape's own space, so the dot turns with the shape.
			item.object.getWorldMatrix(world);
			mat4.invert(world, world);
			vec3.transformMat4(local, event.point, world);
			dot.setParent(item.object);
			dot.setPosition(local[0], local[1], local[2]);
			dot.setVisible(true);
			if (item !== selected) select(item);
		});
	}
	select(items[0]);

	return {
		onUpdate(dt) {
			table.setRotationEuler(0, 0.15 * time.now, 0);
			for (const { object } of items) object.setRotationEuler(0, 0.8 * time.now, 0);
			view.update(dt);
		},
	};
});
