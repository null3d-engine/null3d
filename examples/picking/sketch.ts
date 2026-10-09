// Picking with labels: six shapes turn on a table, each with an HTML label that follows it. The
// pointer lights up the shape under it, and a click selects that shape: an outline marks it, its
// label says so, and a dot marks the point that the click's ray hit. object.on finds the shape under
// the pointer with no raycast in the sketch. ui.trackLabel tracks each label, and the examples page
// binds an element to it when the sketch posts the label's text.
import { defineSketch, mat4, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

const COLORS = ['#e8554e', '#f2c14e', '#5bc27a', '#3fb8af', '#4a8cff', '#d65db1'];
/** The ring's radius, in meters. */
const RING = 2.2;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, post, ui, page } = ctx;
	scene.setBackground('#151a22');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 4.2, 6],
		target: [0, 0.3, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.3, 0] });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });
	post.set({ outline: { color: '#ffffff', hiddenColor: '#7f8a99', width: 3 } });

	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 3.2, radiusBottom: 3.2, height: 0.2, radialSegments: 64 }),
		material: materials.standard({ color: '#39424f' }),
		position: [0, -0.6, 0],
	});
	const shapes = [
		{ name: 'Box', mesh: geometry.box({ width: 0.9, height: 0.9, depth: 0.9 }) },
		{
			name: 'Sphere',
			mesh: geometry.sphere({ radius: 0.55, widthSegments: 32, heightSegments: 16 }),
		},
		{ name: 'Torus', mesh: geometry.torus({ radius: 0.45, tube: 0.18, tubularSegments: 48 }) },
		{ name: 'Cone', mesh: geometry.cone({ radius: 0.5, height: 1, radialSegments: 32 }) },
		{ name: 'Cylinder', mesh: geometry.cylinder({ radiusTop: 0.4, radiusBottom: 0.4, height: 1 }) },
		{
			name: 'Capsule',
			mesh: geometry.capsule({ radius: 0.3, height: 0.6, capSegments: 8, radialSegments: 24 }),
		},
	];
	const table = scene.createGroup({ name: 'table', dynamic: true });
	const items = shapes.map(({ name, mesh }, k) => {
		const angle = (k / shapes.length) * Math.PI * 2;
		const material = materials.standard({
			color: COLORS[k],
			emissive: COLORS[k],
			emissiveIntensity: 0,
			roughness: 0.5,
			doubleSided: true,
		});
		const object = scene.createMesh({
			name,
			mesh,
			material,
			parent: table,
			position: [Math.sin(angle) * RING, 0, Math.cos(angle) * RING],
			dynamic: true,
		});
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
			table.rotateY(0.15 * dt);
			for (const { object } of items) object.rotateY(0.8 * dt);
			view.update(dt);
		},
	};
});
