// The three.js twin of S7, the reflection: one paved surface under a sky, with a fixed camera that
// looks along the ground. The sky is three.js's own model, and the map that lights the surface's
// reflection is three.js's filter of that sky. The twin draws no sky layer, because a sky layer
// belongs to null3D's sky templates, so the parity check leaves S7 out on every tier.
import type * as ThreeModule from 'three';
import {
	S7_AMBIENT,
	S7_CAMERA,
	S7_COUNT,
	S7_PAVING,
	S7_PLANE,
	S7_SKY,
	S7_SUN,
	S7_SURFACE,
	s7Camera,
	s7Paving,
} from '../../scenes/s7';
import { runThreePage, type Three } from './harness';

/** The box that the sky's shader draws around the camera, in meters. */
const SKY_SCALE = 450_000;
/** The sky's other values, which three.js's own sky model takes. */
const SKY_SETTINGS = { turbidity: 2, rayleigh: 1, mieDirectionalG: 0.8, showSunDisc: 0 };

/**
 * A sky mesh of three.js's model with the scene's sun: `SkyMesh` for the node materials of the
 * WebGPU renderer, and `Sky` for WebGLRenderer's shaders.
 */
async function makeSky(rendererName: 'webgl' | 'webgpu'): Promise<ThreeModule.Mesh> {
	if (rendererName === 'webgpu') {
		const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');
		const sky = new SkyMesh();
		sky.scale.setScalar(SKY_SCALE);
		const values = { ...SKY_SETTINGS, mieCoefficient: S7_SKY.mieCoefficient };
		for (const [name, value] of Object.entries(values))
			(sky[name as keyof typeof values] as { value: number }).value = value;
		sky.sunPosition.value.set(...S7_SKY.sunPosition);
		return sky as unknown as ThreeModule.Mesh;
	}
	const { Sky } = await import('three/addons/objects/Sky.js');
	const sky = new Sky();
	sky.scale.setScalar(SKY_SCALE);
	const uniforms = (sky.material as ThreeModule.ShaderMaterial).uniforms as Record<
		string,
		{ value: unknown }
	>;
	for (const [name, value] of Object.entries({
		...SKY_SETTINGS,
		mieCoefficient: S7_SKY.mieCoefficient,
	}))
		(uniforms[name] as { value: number }).value = value;
	(uniforms.sunPosition as { value: ThreeModule.Vector3 }).value.set(...S7_SKY.sunPosition);
	return sky as unknown as ThreeModule.Mesh;
}

/**
 * The paving texture, from the same texels that the engine's sketch makes, so both engines draw the
 * same surface.
 */
function pavingTexture(three: Three): ThreeModule.DataTexture {
	const { width, height, data } = s7Paving();
	const texture = new three.DataTexture(data, width, height);
	texture.colorSpace = three.SRGBColorSpace;
	texture.wrapS = texture.wrapT = three.RepeatWrapping;
	texture.repeat.set(S7_PAVING.repeat, S7_PAVING.repeat);
	texture.anisotropy = 8;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.magFilter = three.LinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}

runThreePage(
	's7',
	async (three, scene, _options, { rendererName, renderer, camera }) => {
		// The harness's camera carries the scene's own field of view and far plane, as null3D's does.
		Object.assign(camera, {
			fov: S7_CAMERA.fov,
			near: S7_CAMERA.near,
			far: S7_CAMERA.far,
		});
		camera.updateProjectionMatrix();
		// Each renderer takes PMREMGenerator from its own build, which the harness loaded already.
		const build = (
			rendererName === 'webgpu' ? await import('three/webgpu') : await import('three')
		) as typeof ThreeModule;
		const sky = await makeSky(rendererName);
		// The filter draws the sky alone, as the engine fills its map from the sky and the layer.
		const skyScene = new three.Scene();
		skyScene.add(sky);
		const pmrem = new build.PMREMGenerator(renderer as unknown as ThreeModule.WebGLRenderer);
		scene.environment = pmrem.fromScene(skyScene).texture;
		scene.add(sky);
		const surface = new three.MeshStandardMaterial({ ...S7_SURFACE, map: pavingTexture(three) });
		const ground = new three.Mesh(
			new three.PlaneGeometry(S7_PLANE.width, S7_PLANE.height),
			surface,
		);
		ground.rotation.x = -Math.PI / 2;
		scene.add(ground);
		return { n: S7_COUNT, camera: s7Camera };
	},
	{ lights: { sun: S7_SUN, ambient: S7_AMBIENT } },
);
