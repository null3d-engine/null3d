// The null3d version of S4, the phone scene: 5,000 still objects of the town in about 50 buckets,
// 200 vehicles that drive its streets, textured standard materials, a sun that casts shadows, 16
// street lights and fog. The engine runs it with the quality preset that it chooses.
//
// Some of the engine's features that S4 uses are not built yet. The sketch asks for each one in
// one place, marked "Feature:", and the scene shows it as soon as the engine draws it. The pull
// request that builds a feature makes S4's image references again.
import { defineSketch, type Material, type MeshGeometry, type Texture } from '@null3d/engine';
import {
	createS4,
	S4_ANISOTROPY,
	S4_FOG,
	S4_MATERIALS,
	S4_MESHES,
	S4_STREET_LIGHT,
	S4_TEXTURE_SIZE,
	S4_TEXTURES,
	S4_VIEW_LIGHTS,
	type S4Generator,
	type S4MaterialName,
	type S4MeshName,
	type S4MeshSpec,
	s4Camera,
	s4KindOf,
	s4ObjectAt,
	s4Texture,
	s4VehicleRotation,
	s4VehicleScale,
	s4VehiclesAt,
} from '../../scenes/spec';
import { followPath, readGovernor, setUpView, watchQuality } from './sketch-common';

export default defineSketch((context) => {
	const { scene, materials, geometry, textures, time } = context;
	// Feature: shadows. The sun, the still objects that stand up and the vehicles cast shadows, and
	// every object receives them. The quality preset sets their cascades and map size.
	// S4 measures how a preset holds its frame rate on phones with dynamic resolution, so it keeps
	// the preset's render scale range, and the quality governor lowers the render scale and then
	// the shadows when frames take too long. A comparison of two builds turns the governor off, so
	// that a step in one run cannot change what it draws.
	const moveCamera = followPath(
		setUpView(context, S4_VIEW_LIGHTS, S4_FOG.color, { dynamicResolution: true }),
		s4Camera,
	);
	context.quality.set({ governor: readGovernor(import.meta.url) });
	// The page's ?shadowFilter= switch tries another filter than the preset's.
	const filter = new URL(import.meta.url).searchParams.get('shadowFilter');
	if (filter) context.quality.set({ shadowFilter: Number(filter) as 3 | 5 });
	const reportQuality = watchQuality(context);

	scene.setFog({ type: 'linear', color: S4_FOG.color, near: S4_FOG.near, far: S4_FOG.far });

	const generators: Record<S4Generator, (options: object) => MeshGeometry> = {
		box: (options) => geometry.box(options),
		cylinder: (options) => geometry.cylinder(options),
		sphere: (options) => geometry.sphere(options),
		cone: (options) => geometry.cone(options),
		capsule: (options) => geometry.capsule(options),
		torus: (options) => geometry.torus(options),
		plane: (options) => geometry.plane(options),
		circle: (options) => geometry.circle(options),
		ring: (options) => geometry.ring(options),
	};
	const meshes = new Map<S4MeshName, MeshGeometry>();
	for (const [name, spec] of Object.entries(S4_MESHES) as [S4MeshName, S4MeshSpec][])
		meshes.set(name, generators[spec.generator](spec.options));

	const maps = new Map<string, Texture>();
	for (const name of S4_TEXTURES)
		maps.set(
			name,
			textures.fromData({
				width: S4_TEXTURE_SIZE,
				height: S4_TEXTURE_SIZE,
				data: s4Texture(name),
				colorSpace: 'srgb',
				wrap: 'repeat',
				mipmaps: true,
				anisotropy: S4_ANISOTROPY,
			}),
		);
	const looks = new Map<S4MaterialName, Material>();
	for (const [name, { color, texture, roughness, metalness }] of Object.entries(S4_MATERIALS) as [
		S4MaterialName,
		(typeof S4_MATERIALS)[S4MaterialName],
	][]) {
		looks.set(name, materials.standard({ color, roughness, metalness, map: maps.get(texture) }));
	}

	const data = createS4();
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const scale = new Float64Array(3);
	for (let i = 0; i < data.count; i++) {
		const { mesh, material } = s4KindOf(data.kind[i] as number);
		s4ObjectAt(data, i, position, rotation, scale);
		scene.createMesh({
			mesh: meshes.get(mesh) as MeshGeometry,
			material: looks.get(material) as Material,
			position: [position[0] as number, position[1] as number, position[2] as number],
			rotation: [
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			],
			scale: [scale[0] as number, scale[1] as number, scale[2] as number],
			// Marks that lie flat on the ground cast no shadow.
			castShadows: (S4_MESHES[mesh] as S4MeshSpec).flat !== true,
			receiveShadows: true,
		});
	}

	// Each vehicle's rotation and scale never change, so the sketch sets them once.
	const vehicles = Array.from({ length: data.vehicles }, (_, i) => {
		const { mesh, material } = s4KindOf(data.vehicleKind[i] as number);
		s4VehicleScale(data, i, scale);
		s4VehicleRotation(data, i, rotation);
		return scene.createMesh({
			mesh: meshes.get(mesh) as MeshGeometry,
			material: looks.get(material) as Material,
			rotation: [
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			],
			scale: [scale[0] as number, scale[1] as number, scale[2] as number],
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
	});

	// The street lights are point lights, which the engine shades through its grid of view
	// clusters.
	for (let i = 0; i < data.lights.length / 3; i++)
		scene.createPointLight({
			color: S4_STREET_LIGHT.color,
			intensity: S4_STREET_LIGHT.intensity,
			range: S4_STREET_LIGHT.range,
			decay: S4_STREET_LIGHT.decay,
			position: [
				data.lights[i * 3] as number,
				data.lights[i * 3 + 1] as number,
				data.lights[i * 3 + 2] as number,
			],
		});

	// The vehicles move in a function of their own that takes no fraction, so the browser
	// allocates nothing for its call whether it inlines it or not. The time reaches it in `clock`.
	const clock = new Float64Array(1);
	const vehiclePositions = new Float64Array(data.vehicles * 3);
	const moveVehicles = (): void => {
		s4VehiclesAt(data, clock, vehiclePositions);
		for (let i = 0; i < data.vehicles; i++)
			vehicles[i]?.setPosition(
				vehiclePositions[i * 3] as number,
				vehiclePositions[i * 3 + 1] as number,
				vehiclePositions[i * 3 + 2] as number,
			);
	};
	const pose = (t: number): void => {
		clock[0] = t;
		moveVehicles();
		moveCamera(t);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
			reportQuality();
		},
	};
});
