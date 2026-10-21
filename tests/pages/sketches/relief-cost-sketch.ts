// A hillside of relief for the page that measures what each relief feature costs
// (tests/pages/relief-cost.ts), from the relief demo's height maps (examples/relief/heights.ts):
// displaced terrain, 40 displaced boulders, brick walls with parallax, bump-mapped cap stones and
// a wireframe geodesic frame, under the sun's shadows, seen from a fixed place. ?feature= names
// the feature that the page's messages turn off and on: displacement (terrain and boulders draw
// their materials without the map), parallax (the quality setting, as the Low preset sets it),
// bump (cap stones without the map) or wireframe (the frame's triangles instead of its edges).
// The other features stay on.
import { defineSketch, type Material, type Mesh } from '@null3d/engine';
import { icosahedron } from '@null3d/geometry';
import { bricks, grain, hills, maps, rock } from '../../../examples/relief/heights';

const params = new URL(import.meta.url).searchParams;
const feature = params.get('feature') ?? 'displacement';
/** The hills' size and height range, in meters, as in the demo. */
const [WIDE, TALL] = [60, 8];
const ground = (x: number, z: number) => (hills(0.5 + x / WIDE, 0.5 - z / WIDE) - 0.5) * TALL;

export default defineSketch(({ scene, geometry, materials, textures, quality, page, time }) => {
	scene.setBackground('#9aa8b8');
	const camera = scene.createPerspectiveCamera({ fov: 50, far: 500 });
	camera.setPosition(0, ground(0, 14) + 5, 14);
	camera.lookAt(0, ground(0, -4), -4);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-0.9, -0.3, 0.3],
		color: '#ffd2a0',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 50 },
	});
	scene.createAmbientLight({ color: '#b8c8ff', intensity: 0.4 });
	const solid = { castShadows: true, receiveShadows: true };
	const texture = (data: Uint8Array) => {
		const size = Math.sqrt(data.length / 4);
		const look = { mipmaps: true, wrap: 'repeat', colorSpace: 'linear' } as const;
		return textures.fromData({ width: size, height: size, data, ...look });
	};
	// Each object's material with the feature and without it, which the messages swap.
	const twins: [Mesh, Material, Material][] = [];
	const add = (object: Mesh, on: Material, off: Material, switched: boolean) => {
		if (switched) twins.push([object, on, off]);
	};

	const [hillHeights] = maps(hills, undefined, 512);
	const terrain = { color: '#7d8a52', roughness: 0.95 };
	const displaced = materials.standard({
		...terrain,
		displacementMap: texture(hillHeights),
		displacementScale: TALL,
		displacementBias: -TALL / 2,
	});
	const plane = geometry.plane({
		width: WIDE,
		height: WIDE,
		widthSegments: 256,
		heightSegments: 256,
	});
	add(
		scene.createMesh({
			mesh: plane,
			material: displaced,
			rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
			...solid,
		}),
		displaced,
		materials.standard(terrain),
		feature === 'displacement',
	);

	const [rockHeights] = maps(rock(0));
	const stone = { color: '#8a837a', roughness: 0.8 };
	const cut = materials.standard({
		...stone,
		displacementMap: texture(rockHeights),
		displacementScale: 0.7,
		displacementBias: -0.3,
	});
	const smooth = materials.standard(stone);
	const boulder = geometry.sphere({ radius: 1, widthSegments: 160, heightSegments: 80 });
	for (let i = 0; i < 40; i++) {
		const [x, z] = [((i % 8) - 3.5) * 3.2, 6 - Math.floor(i / 8) * 4];
		const s = 0.5 + ((i * 7) % 5) * 0.12;
		const object = scene.createMesh({
			mesh: boulder,
			material: cut,
			position: [x, ground(x, z) + s * 0.25, z],
			scale: [s, s, s],
			...solid,
		});
		add(object, cut, smooth, feature === 'displacement');
	}

	const [brickHeights] = maps(bricks);
	const wall = materials.standard({
		color: '#a4583c',
		roughness: 0.85,
		displacementMap: texture(brickHeights),
		displacementScale: 0.04,
		parallax: true,
		uvTransform: { repeat: [4, 6] },
	});
	const [grainHeights] = maps(grain);
	const sandstone = { color: '#d2c09a', roughness: 0.9 };
	const grained = materials.standard({
		...sandstone,
		bumpMap: texture(grainHeights),
		bumpScale: 3,
	});
	const plain = materials.standard(sandstone);
	const bay = geometry.box({ width: 5.8, height: 3, depth: 0.3 });
	const cap = geometry.box({ width: 0.56, height: 0.09, depth: 0.42 });
	for (let k = 0; k < 4; k++) {
		const [x, z] = [(k - 1.5) * 6, -9];
		const top = ground(x, z) + 1.5;
		scene.createMesh({ mesh: bay, material: wall, position: [x, top - 1.5, z], ...solid });
		for (let i = 0; i < 10; i++) {
			const at: [number, number, number] = [x - 2.61 + i * 0.58, top + 0.045, z];
			const object = scene.createMesh({ mesh: cap, material: grained, position: at, ...solid });
			add(object, grained, plain, feature === 'bump');
		}
	}

	const brass = { color: '#e0c48a', metalness: 0.9, roughness: 0.35 };
	const lines = materials.standard({ ...brass, wireframe: true });
	add(
		scene.createMesh({
			mesh: geometry.fromArrays(icosahedron({ radius: 2.8, detail: 3 })),
			material: lines,
			position: [7, ground(7, -2) - 0.3, -2],
			castShadows: true,
		}),
		lines,
		materials.standard(brass),
		feature === 'wireframe',
	);

	const parallax = quality.settings.parallax;
	page.onMessage((message) => {
		if (message !== 'on' && message !== 'off') return;
		const on = message === 'on';
		if (feature === 'parallax') quality.set({ parallax: on && parallax });
		for (const [object, withIt, without] of twins) object.setMaterial(on ? withIt : without);
		const frame = time.frame;
		void scene.warmUp().then(() => page.post('settled', { frames: time.frame - frame }));
	});
});
