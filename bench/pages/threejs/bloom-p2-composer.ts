// Prototype P2: draws a twin page's hold frame through a bloom composer, for side-by-side images
// with null3D's mip chain. `mode` is unreal-soft or unreal-strong (UnrealBloomPass with the bloom
// scene's settings), pmndrs (BloomEffect with its defaults) or none, each ending with ACES and the
// sRGB output. The composers' targets have no MSAA, so null3D's page draws with ?antialias=none.
// It draws into the canvas and reads the canvas back, top row first.
import type * as ThreeModule from 'three';
import { BLOOM_SETTINGS } from '../../scenes/bloom';
import { packRows } from '../lib/pixels';

export async function drawWithBloom(
	three: typeof ThreeModule,
	renderer: ThreeModule.WebGLRenderer,
	scene: ThreeModule.Scene,
	camera: ThreeModule.Camera,
	width: number,
	height: number,
	mode: string,
): Promise<Uint8Array> {
	document.body.append(renderer.domElement);
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	if (mode === 'pmndrs') {
		const pp = await import('postprocessing');
		renderer.toneMapping = three.NoToneMapping;
		const composer = new pp.EffectComposer(renderer, { frameBufferType: three.HalfFloatType });
		composer.setSize(width, height);
		composer.addPass(new pp.RenderPass(scene, camera));
		const tone = new pp.ToneMappingEffect({ mode: pp.ToneMappingMode.ACES_FILMIC });
		composer.addPass(new pp.EffectPass(camera, new pp.BloomEffect({ mipmapBlur: true }), tone));
		composer.render();
	} else {
		const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
		const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
		const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
		const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
		renderer.toneMapping = three.ACESFilmicToneMapping;
		const composer = new EffectComposer(renderer);
		composer.setPixelRatio(1);
		composer.setSize(width, height);
		composer.addPass(new RenderPass(scene, camera));
		if (mode === 'unreal-soft' || mode === 'unreal-strong') {
			const { strength, radius, threshold } =
				BLOOM_SETTINGS[mode === 'unreal-soft' ? 'soft' : 'strong'];
			composer.addPass(
				new UnrealBloomPass(new three.Vector2(width, height), strength, radius, threshold),
			);
		}
		composer.addPass(new OutputPass());
		composer.render();
	}
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	return packRows(bottomFirst, width, height, width * 4, true);
}
