// The null3d version of S4, the phone scene: 5,000 still objects of the town in about 50 buckets,
// 200 vehicles that drive its streets, textured standard materials, a sun that casts shadows, 16
// street lights and fog. The engine runs it with the quality preset that it chooses.
//
// Some of the engine's features that S4 uses are not built yet. The sketch asks for each one in
// one place, marked "Feature:", and the scene shows it as soon as the engine draws it. The pull
// request that builds a feature makes S4's image references again.
import {
	defineSketch,
	type Material,
	type MeshGeometry,
	type StandardOptions,
	type Texture,
} from '@null3d/engine';
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
	s4VehicleAt,
	s4VehicleScale,
} from '../../scenes/spec';
import { followPath, setUpView, watchQuality } from './sketch-common';

export default defineSketch((context) => {
	const { scene, materials, geometry, textures, time } = context;
	// Feature: shadows. The sun, the still objects that stand up and the vehicles cast shadows, and
	// every object receives them. The engine stores these settings, and draws the shadows once it
	// has shadow maps on the GPU path. The quality preset sets their cascades and map size.
	const moveCamera = followPath(setUpView(context, S4_VIEW_LIGHTS, S4_FOG.color), s4Camera);
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
		// Feature: texture maps. Standard materials take `map` once the engine has maps; until then
		// the engine ignores it, and each material shows its color alone.
		const options = { color, roughness, metalness, map: maps.get(texture) } as StandardOptions;
		looks.set(name, materials.standard(options));
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

	const vehicles = Array.from({ length: data.vehicles }, (_, i) => {
		const { mesh, material } = s4KindOf(data.vehicleKind[i] as number);
		s4VehicleScale(data, i, scale);
		return scene.createMesh({
			mesh: meshes.get(mesh) as MeshGeometry,
			material: looks.get(material) as Material,
			scale: [scale[0] as number, scale[1] as number, scale[2] as number],
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
	});

	// Feature: clustered lighting. The street lights are scene objects; they light surfaces once
	// the engine shades point lights through its grid of view clusters.
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

	const pose = (t: number): void => {
		for (let i = 0; i < data.vehicles; i++) {
			s4VehicleAt(data, i, t, position, rotation);
			const vehicle = vehicles[i];
			vehicle?.setPosition(position[0] as number, position[1] as number, position[2] as number);
			vehicle?.setRotation(
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			);
		}
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
