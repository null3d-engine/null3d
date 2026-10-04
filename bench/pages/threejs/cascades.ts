// The sun's shadows in cascades, for the twins of the scenes that run with null3D's quality preset:
// three.js's cascaded shadow addon, CSM for WebGLRenderer and CSMShadowNode for WebGPURenderer.
// The cascades end where null3D's shadows end, with the preset's cascade count and map size.
import type * as ThreeModule from 'three';
import type { SceneLights } from '../../scenes/spec';
import type { TwinSettings } from '../lib/preset';
import type { BuildContext, SceneSetup, Three } from './harness';

/** What the cascaded shadows need from the frame loop. */
export type Cascades = Required<Pick<SceneSetup, 'afterCamera' | 'onAspect'>>;

/**
 * Casts the sun's shadows in cascades that reach `distance` meters from the camera. On WebGL, CSM
 * makes a light of its own for each cascade, which replaces the harness's sun, and every material
 * needs its setup.
 */
export async function castCascadedShadows(
	three: Three,
	scene: ThreeModule.Scene,
	{ rendererName, renderer, camera, sun }: BuildContext,
	settings: TwinSettings,
	materials: readonly ThreeModule.Material[],
	{ sun: { direction, color, intensity } }: SceneLights,
	distance: number,
): Promise<Cascades> {
	renderer.shadowMap.enabled = true;
	if (rendererName === 'webgl') {
		const { CSM } = await import('three/addons/csm/CSM.js');
		const csm = new CSM({
			camera,
			parent: scene,
			cascades: settings.shadowCascades,
			maxFar: distance,
			mode: 'practical',
			shadowMapSize: settings.shadowMapSize,
			lightDirection: new three.Vector3(...direction).normalize(),
			lightIntensity: intensity,
		});
		for (const light of csm.lights) light.color.set(color);
		scene.remove(sun);
		for (const material of materials) csm.setupMaterial(material);
		return {
			afterCamera() {
				camera.updateMatrixWorld();
				csm.update();
			},
			onAspect: () => csm.updateFrustums(),
		};
	}
	const { CSMShadowNode } = await import('three/addons/csm/CSMShadowNode.js');
	sun.castShadow = true;
	sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
	const csm = new CSMShadowNode(sun as never, {
		cascades: settings.shadowCascades,
		maxFar: distance,
		mode: 'practical',
	});
	(sun.shadow as { shadowNode?: unknown }).shadowNode = csm;
	// The node finds the camera when it first draws; before then it has no frustums to update.
	return { afterCamera() {}, onAspect: () => csm.camera && csm.updateFrustums() };
}
