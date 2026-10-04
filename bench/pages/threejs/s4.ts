// The three.js twin of S4, the phone scene: the town's still objects, the vehicles that drive its
// streets, textured standard materials, a sun that casts shadows, 16 street lights and fog.
//
// It gives three.js its best way to draw the scene:
// - The still objects share one BatchedMesh per material, with an instance of one of the scene's
//   meshes per object. BatchedMesh culls and sorts its instances one by one, so it draws only the
//   objects in view, in one draw call per material.
// - The vehicles draw as one InstancedMesh per kind, whose matrices change every frame, as S1's
//   twin moves its boxes.
// - The sun's shadows come from three.js's cascaded shadow addon: CSM for WebGLRenderer, and
//   CSMShadowNode for WebGPURenderer. Its cascades end at the distance where null3D's shadows end.
// - The 16 street lights are PointLights with a distance and a decay. three.js shades them in every
//   fragment, which suits so few lights.
// - The cascade count, the shadow map size, the pixel ratio and the anisotropy cap are the settings
//   of the quality preset that null3D chooses on this device for the renderer's GPU path, or the
//   preset that `?preset=` names.
import type * as ThreeModule from 'three';
import {
	createS4,
	S4_ANISOTROPY,
	S4_EMISSIVES,
	S4_FOG,
	S4_MATERIALS,
	S4_MESHES,
	S4_SHADOW_DISTANCE,
	S4_STREET_LIGHT,
	S4_TEXTURE_SIZE,
	S4_TEXTURES,
	S4_VIEW_LIGHTS,
	type S4MaterialName,
	type S4MeshName,
	type S4MeshSpec,
	type S4TextureName,
	s4Camera,
	s4KindOf,
	s4ObjectAt,
	s4Texture,
	s4VehicleRotation,
	s4VehicleScale,
	s4VehiclesAt,
} from '../../scenes/spec';
import { chosenPreset, twinSettings } from '../lib/preset';
import { castCascadedShadows } from './cascades';
import { runThreePage, type Three } from './harness';

/** A mesh of the scene, made with three.js's geometry class of the generator's name. */
function geometryOf(
	three: Three,
	{ generator, options: o }: S4MeshSpec,
): ThreeModule.BufferGeometry {
	switch (generator) {
		case 'box':
			return new three.BoxGeometry(o.width ?? 1, o.height ?? 1, o.depth ?? 1);
		case 'cylinder':
			return new three.CylinderGeometry(o.radiusTop, o.radiusBottom, o.height, o.radialSegments);
		case 'sphere':
			return new three.SphereGeometry(o.radius, o.widthSegments, o.heightSegments);
		case 'cone':
			return new three.ConeGeometry(o.radius, o.height, o.radialSegments);
		case 'capsule':
			return new three.CapsuleGeometry(o.radius, o.height, o.capSegments, o.radialSegments);
		case 'torus':
			return new three.TorusGeometry(o.radius, o.tube, o.radialSegments, o.tubularSegments);
		case 'plane':
			return new three.PlaneGeometry(o.width ?? 1, o.height ?? 1);
		case 'circle':
			return new three.CircleGeometry(o.radius, o.segments);
		case 'ring':
			return new three.RingGeometry(o.innerRadius, o.outerRadius, o.thetaSegments);
	}
}

/** A texture of the scene: sRGB, repeated, with mip levels, sampled up to the preset's anisotropy. */
function textureOf(three: Three, name: S4TextureName, maxAnisotropy: number): ThreeModule.Texture {
	const texture = new three.DataTexture(s4Texture(name), S4_TEXTURE_SIZE, S4_TEXTURE_SIZE);
	texture.colorSpace = three.SRGBColorSpace;
	texture.wrapS = three.RepeatWrapping;
	texture.wrapT = three.RepeatWrapping;
	texture.magFilter = three.LinearFilter;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = Math.min(S4_ANISOTROPY, maxAnisotropy);
	texture.needsUpdate = true;
	return texture;
}

runThreePage(
	's4',
	async (three, scene, _options, context) => {
		const tier = context.rendererName === 'webgl' ? 'webgl2' : 'webgpu';
		const preset = chosenPreset(tier, context.params);
		const settings = twinSettings(preset);
		const data = createS4();
		scene.fog = new three.Fog(S4_FOG.color, S4_FOG.near, S4_FOG.far);

		const textures = new Map(
			S4_TEXTURES.map((name) => [name, textureOf(three, name, settings.maxAnisotropy)]),
		);
		const materials = new Map(
			(Object.keys(S4_MATERIALS) as S4MaterialName[]).map((name) => {
				const { color, texture, roughness, metalness } = S4_MATERIALS[name];
				const map = textures.get(texture) ?? null;
				// Prototype P2: ?emissive gives some materials emissive light.
				const glow = context.params.has('emissive') ? S4_EMISSIVES[name] : undefined;
				return [
					name,
					new three.MeshStandardMaterial({
						color,
						roughness,
						metalness,
						map,
						...(glow && { emissive: glow.emissive, emissiveIntensity: glow.intensity }),
					}),
				];
			}),
		);
		const geometries = new Map(
			(Object.keys(S4_MESHES) as S4MeshName[]).map((name) => [
				name,
				geometryOf(three, S4_MESHES[name]),
			]),
		);
		const shadows = await castCascadedShadows(
			three,
			scene,
			context,
			settings,
			[...materials.values()],
			S4_VIEW_LIGHTS,
			S4_SHADOW_DISTANCE,
		);

		const position = new three.Vector3();
		const rotation = new three.Quaternion();
		const scale = new three.Vector3();
		const matrix = new three.Matrix4();
		const out = { position: [0, 0, 0], rotation: [0, 0, 0, 0], scale: [0, 0, 0] };
		const compose = () =>
			matrix.compose(
				position.fromArray(out.position),
				rotation.fromArray(out.rotation),
				scale.fromArray(out.scale),
			);

		const kindOf = (i: number) => s4KindOf(data.kind[i] as number);
		// One BatchedMesh per material, sized for the meshes and the objects that use it.
		for (const [name, material] of materials) {
			const objects: number[] = [];
			for (let i = 0; i < data.count; i++) if (kindOf(i).material === name) objects.push(i);
			if (objects.length === 0) continue;
			const meshes = [...new Set(objects.map((i) => kindOf(i).mesh))];
			const used = meshes.map((mesh) => geometries.get(mesh) as ThreeModule.BufferGeometry);
			const vertices = used.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
			const indices = used.reduce((sum, g) => sum + (g.index?.count ?? 0), 0);
			const batch = new three.BatchedMesh(objects.length, vertices, indices, material);
			const ids = new Map(meshes.map((mesh, k) => [mesh, batch.addGeometry(used[k] as never)]));
			for (const i of objects) {
				s4ObjectAt(data, i, out.position, out.rotation, out.scale);
				const id = batch.addInstance(ids.get(kindOf(i).mesh) as number);
				batch.setMatrixAt(id, compose());
			}
			batch.castShadow = true;
			batch.receiveShadow = true;
			scene.add(batch);
		}

		// One InstancedMesh per vehicle kind. The vehicles cover the whole town, so none is culled.
		const perKind = new Map<number, number>();
		for (const kind of data.vehicleKind) perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
		const vehicleMeshes = new Map<number, ThreeModule.InstancedMesh>();
		for (const [kind, count] of perKind) {
			const { mesh: meshName, material } = s4KindOf(kind);
			const mesh = new three.InstancedMesh(
				geometries.get(meshName) as ThreeModule.BufferGeometry,
				materials.get(material) as ThreeModule.Material,
				count,
			);
			mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.count = 0;
			vehicleMeshes.set(kind, mesh);
			scene.add(mesh);
		}
		// Each vehicle's mesh, its slot in that mesh, and its scale and rotation, which never change.
		const meshOf: ThreeModule.InstancedMesh[] = [];
		const slot = new Int32Array(data.vehicles);
		const scales = new Float64Array(data.vehicles * 3);
		const rotations = new Float64Array(data.vehicles * 4);
		for (let i = 0; i < data.vehicles; i++) {
			const mesh = vehicleMeshes.get(data.vehicleKind[i] as number) as ThreeModule.InstancedMesh;
			meshOf.push(mesh);
			slot[i] = mesh.count++;
			s4VehicleScale(data, i, out.scale);
			scales.set(out.scale, i * 3);
			s4VehicleRotation(data, i, out.rotation);
			rotations.set(out.rotation, i * 4);
		}

		for (let i = 0; i < data.lights.length / 3; i++) {
			const { color, intensity, range, decay } = S4_STREET_LIGHT;
			const light = new three.PointLight(color, intensity, range, decay);
			light.position.fromArray(data.lights, i * 3);
			scene.add(light);
		}

		const clock = new Float64Array(1);
		const vehiclePositions = new Float64Array(data.vehicles * 3);
		return {
			n: data.count,
			update(t) {
				clock[0] = t;
				s4VehiclesAt(data, clock, vehiclePositions);
				for (let i = 0; i < data.vehicles; i++) {
					matrix.compose(
						position.fromArray(vehiclePositions, i * 3),
						rotation.fromArray(rotations, i * 4),
						scale.fromArray(scales, i * 3),
					);
					meshOf[i]?.setMatrixAt(slot[i] as number, matrix);
				}
				for (const mesh of vehicleMeshes.values()) mesh.instanceMatrix.needsUpdate = true;
			},
			camera: s4Camera,
			...shadows,
			maxPixelRatio: settings.maxPixelRatio,
			report: { preset, settings },
		};
	},
	{ lights: S4_VIEW_LIGHTS, background: S4_FOG.color, fillWindow: true, trace: true },
);
