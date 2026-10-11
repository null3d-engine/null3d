// The three.js twin of S6, the city: the generated city from the same two optimized model files,
// under an evening sun that casts shadows, with 32 street lights, an environment, a sky, bloom and
// ambient occlusion, while the camera drives the streets.
//
// It gives three.js its best way to draw the scene with its core and addons:
// - GLTFLoader loads each file once, with KTX2Loader for its textures and MeshoptDecoder for its
//   compressed buffers. Each part of a kit model draws as one InstancedMesh with a row for each of
//   its copies, which three.js's docs advise for many copies of one mesh, and which casts and
//   receives shadows. The towers stay the Meshes that the loader made, one per material.
// - It streams in as null3D's page does: the kit's copies draw once the kit file is in, and the
//   towers join when theirs is. A timed run warms up once the city is whole.
// - PMREMGenerator prefilters the environment's HDR file, and the Sky addon draws the sky.
// - The sun's shadows come from three.js's cascaded shadow addon, as in S4's twin, with the preset's
//   cascades and map size. WebGPURenderer shades the street lights with its clustered lighting.
// - Post-processing: on WebGLRenderer, EffectComposer with GTAOPass at the preset's ambient
//   occlusion resolution (none on Low and Medium, as in null3D), UnrealBloomPass and OutputPass,
//   which applies the ACES curve. On WebGPURenderer, the same through its render pipeline's nodes.
//   Bloom and ambient occlusion are each engine's own technique; the summary notes the difference.
// - Clicks pick buildings with a Raycaster, sped up by three-mesh-bvh's trees, and CSS2DRenderer
//   draws the labels on the tallest towers and the picked building.
//
// Occlusion culling has no three.js counterpart in core or in its addons, so the twin draws what
// the camera's frustum holds.
import type * as ThreeModule from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { sampleUrl } from '../../../tools/lib/sample-url';
import {
	createS6,
	S6_AO,
	S6_BACKGROUND,
	S6_BLOOM,
	S6_BOX,
	S6_CAMERA,
	S6_ENVIRONMENT_INTENSITY,
	S6_LABEL_RISE,
	S6_PICK_RISE,
	S6_SHADOW_DISTANCE,
	S6_SKY,
	S6_SUN_POSITION,
	S6_VIEW_LIGHTS,
	type S6Data,
	type S6Layout,
	s6BuildingAt,
	s6Camera,
	s6PartTransform,
} from '../../scenes/s6';
import { chosenPreset, type TwinSettings, twinSettings } from '../lib/preset';
import { loadedBytes, S6_KIT_URL, S6_TOWERS_URL } from '../lib/s6-city';
import { labelLayer, labelTag, pickedText } from '../lib/s6-labels';
import { castCascadedShadows } from './cascades';
import { type BuildContext, runThreePage, type Three } from './harness';

/** UnrealBloomPass's spread, its default. null3D's mip-chain bloom has no radius. */
const BLOOM_RADIUS = 0.4;

runThreePage(
	's6',
	async (three, scene, options, context) => {
		const started = performance.now();
		const seconds = () => (performance.now() - started) / 1000;
		const { rendererName, renderer, camera } = context;
		const tier = rendererName === 'webgl' ? 'webgl2' : 'webgpu';
		const preset = chosenPreset(tier, context.params);
		const settings = twinSettings(preset);
		camera.near = S6_CAMERA.near;
		camera.far = S6_CAMERA.far;
		camera.fov = S6_CAMERA.fov;
		camera.updateProjectionMatrix();
		(renderer as unknown as { toneMapping: number }).toneMapping = three.ACESFilmicToneMapping;

		// Every file starts at once; the stages wait only for what they need.
		const ktx2 = new KTX2Loader();
		if (rendererName === 'webgpu') await ktx2.detectSupportAsync(renderer as never);
		else ktx2.detectSupport(renderer as never);
		const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
		const layoutLoad = fetch(sampleUrl('sources/city/layout/layout.json')).then(
			(r) => r.json() as Promise<S6Layout>,
		);
		const kitLoad = gltf.loadAsync(S6_KIT_URL);
		const towersLoad = gltf.loadAsync(S6_TOWERS_URL);
		const environmentLoad = new HDRLoader().loadAsync(
			sampleUrl(
				'sources/hdri/polyhaven/kloofendal_48d_partly_cloudy_puresky/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
			),
		);

		const data = createS6(await layoutLoad, options.count ?? undefined);
		for (const { position, color, intensity, range } of data.lights) {
			const light = new three.PointLight(new three.Color().setRGB(...color), intensity, range, 2);
			light.position.set(...position);
			scene.add(light);
		}
		await addSky(rendererName, scene);
		const kit = await kitLoad;
		const kitSeconds = seconds();
		const pickable: ThreeModule.Object3D[] = [];
		const kitMeshes = instanceKit(three, kit.scene, data, pickable);
		for (const mesh of kitMeshes) scene.add(mesh);

		const shadows = await castCascadedShadows(
			three,
			scene,
			context,
			settings,
			kitMeshes.map((m) => m.material as ThreeModule.Material),
			S6_VIEW_LIGHTS,
			S6_SHADOW_DISTANCE,
		);
		const { setupMaterial, ...cascades } = shadows;

		// Labels and picking.
		const labels = new CSS2DRenderer();
		const layer = labelLayer(renderer.domElement);
		labels.domElement.style.cssText = 'position: absolute; inset: 0; pointer-events: none';
		layer.append(labels.domElement);
		const pickedLabel = new CSS2DObject(labelTag(layer, ''));
		pickedLabel.visible = false;
		scene.add(pickedLabel);
		const picker = pickingOf(three, camera, pickable, data, (building, point) => {
			pickedLabel.position.copy(point).setY(point.y + S6_PICK_RISE);
			pickedLabel.visible = true;
			pickedLabel.element.textContent = pickedText(building);
		});
		renderer.domElement.addEventListener('click', picker);

		// The towers join when their file is in, and the city is whole with its environment too.
		const whole = Promise.all([towersLoad, environmentLoad]).then(([towers, hdr]) => {
			const towersSeconds = seconds();
			const created = new Set(data.towerOrder);
			const meshes: ThreeModule.Mesh[] = [];
			towers.scene.traverse((node) => {
				const mesh = node as ThreeModule.Mesh;
				if (!mesh.isMesh) return;
				const material = Number(mesh.name.slice(1));
				if (!created.has(material)) return;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				mesh.userData.material = material;
				meshes.push(mesh);
			});
			for (const mesh of meshes) {
				setupMaterial?.(mesh.material as ThreeModule.Material);
				mesh.geometry.computeBoundsTree = computeBoundsTree;
				mesh.geometry.computeBoundsTree();
				mesh.raycast = acceleratedRaycast;
				pickable.push(mesh);
				scene.add(mesh);
			}
			for (const label of data.labels) {
				const k = label.row * 3;
				const tag = new CSS2DObject(labelTag(layer, label.text));
				tag.position.set(
					data.position[k] as number,
					(data.position[k + 1] as number) + label.height + S6_LABEL_RISE,
					data.position[k + 2] as number,
				);
				scene.add(tag);
			}
			// Each build has a PMREMGenerator of its own, for its renderer.
			const { PMREMGenerator } = three as unknown as {
				PMREMGenerator: new (
					renderer: unknown,
				) => {
					fromEquirectangular(t: ThreeModule.Texture): ThreeModule.WebGLRenderTarget;
					dispose(): void;
				};
			};
			const pmrem = new PMREMGenerator(renderer);
			scene.environment = pmrem.fromEquirectangular(hdr).texture;
			scene.environmentIntensity = S6_ENVIRONMENT_INTENSITY;
			hdr.dispose();
			pmrem.dispose();
			ktx2.dispose();
			return {
				sketch: {
					kit: kitSeconds,
					towers: towersSeconds,
					whole: seconds(),
					objects: data.count,
					bytes: loadedBytes(),
				},
			};
		});
		if (options.hold !== null) await whole;

		const post = await postProcessing(three, scene, context, settings);
		// The post-processing and the labels follow the canvas's size, which the harness sets.
		const canvas = renderer.domElement;
		let width = 0;
		let height = 0;
		return {
			n: data.count,
			camera: (t, position, target) => s6Camera(data, t, position, target),
			...cascades,
			render() {
				if (canvas.width !== width || canvas.height !== height) {
					width = canvas.width;
					height = canvas.height;
					post.resize(width, height);
					labels.setSize(canvas.clientWidth, canvas.clientHeight);
				}
				post.draw();
				labels.render(scene, camera);
			},
			whole,
			maxPixelRatio: settings.maxPixelRatio,
			report: { preset, settings },
		};
	},
	{
		lights: S6_VIEW_LIGHTS,
		background: S6_BACKGROUND,
		fillWindow: true,
		trace: true,
		clusteredLighting: true,
	},
);

/**
 * One InstancedMesh for each part of each kit model that the city uses, with a row for each copy:
 * the row's place composed with the part's place in its model. Each mesh's rows remember their
 * buildings, for picking, and its geometry gets three-mesh-bvh's tree.
 */
function instanceKit(
	three: Three,
	kit: ThreeModule.Object3D,
	data: S6Data,
	pickable: ThreeModule.Object3D[],
): ThreeModule.InstancedMesh[] {
	const rowsOf = new Map<number, number[]>();
	for (const row of data.kitOrder) {
		const model = data.model[row] as number;
		if (model === S6_BOX) continue;
		const rows = rowsOf.get(model);
		if (rows) rows.push(row);
		else rowsOf.set(model, [row]);
	}
	const meshes: ThreeModule.InstancedMesh[] = [];
	const position = [0, 0, 0];
	const rotation = [0, 0, 0, 1];
	const scale = [1, 1, 1];
	const matrix = new three.Matrix4();
	const p = new three.Vector3();
	const q = new three.Quaternion();
	const s = new three.Vector3();
	for (const [model, rows] of rowsOf) {
		for (let k = 0; ; k++) {
			const part = kit.getObjectByName(`k${model}-${k}`) as ThreeModule.Mesh | undefined;
			if (!part) {
				if (k === 0) throw new Error(`S6's kit file has no parts of model ${model}`);
				break;
			}
			const mesh = new three.InstancedMesh(part.geometry, part.material, rows.length);
			rows.forEach((row, i) => {
				s6PartTransform(
					data,
					row,
					part.position.toArray(),
					part.quaternion.toArray(),
					part.scale.toArray(),
					position,
					rotation,
					scale,
				);
				matrix.compose(p.fromArray(position), q.fromArray(rotation), s.fromArray(scale));
				mesh.setMatrixAt(i, matrix);
			});
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.computeBoundingSphere();
			mesh.userData.buildings = rows.map((row) => data.building[row]);
			part.geometry.computeBoundsTree = computeBoundsTree;
			part.geometry.computeBoundsTree();
			mesh.raycast = acceleratedRaycast;
			meshes.push(mesh);
			pickable.push(mesh);
		}
	}
	return meshes;
}

/**
 * A click handler that casts a ray from the camera through the click and calls `picked` with the
 * building that it hits first and the hit point.
 */
function pickingOf(
	three: Three,
	camera: ThreeModule.PerspectiveCamera,
	pickable: readonly ThreeModule.Object3D[],
	data: S6Data,
	picked: (building: number, point: ThreeModule.Vector3) => void,
): (event: MouseEvent) => void {
	const raycaster = new three.Raycaster();
	(raycaster as { firstHitOnly?: boolean }).firstHitOnly = true;
	const pointer = new three.Vector2();
	return (event) => {
		const canvas = event.currentTarget as HTMLCanvasElement;
		const rect = canvas.getBoundingClientRect();
		pointer.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1,
		);
		raycaster.setFromCamera(pointer, camera);
		const [hit] = raycaster.intersectObjects(pickable as ThreeModule.Object3D[], false);
		if (!hit) return;
		const { userData } = hit.object;
		const building =
			hit.instanceId === undefined
				? s6BuildingAt(data, userData.material as number, hit.point.toArray())
				: (userData.buildings as number[])[hit.instanceId];
		if (building !== undefined && building >= 0) picked(building, hit.point);
	};
}

/** The sky addon of the renderer's build, behind the city, with its sun where the light comes from. */
async function addSky(
	rendererName: BuildContext['rendererName'],
	scene: ThreeModule.Scene,
): Promise<void> {
	const size = S6_CAMERA.far * 0.9;
	if (rendererName === 'webgpu') {
		const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');
		const sky = new SkyMesh();
		sky.scale.setScalar(size);
		sky.turbidity.value = S6_SKY.turbidity;
		sky.rayleigh.value = S6_SKY.rayleigh;
		sky.mieCoefficient.value = S6_SKY.mieCoefficient;
		sky.mieDirectionalG.value = S6_SKY.mieDirectionalG;
		sky.sunPosition.value.set(...S6_SUN_POSITION);
		scene.add(sky);
		return;
	}
	const { Sky } = await import('three/addons/objects/Sky.js');
	const sky = new Sky();
	sky.scale.setScalar(size);
	const uniforms = sky.material.uniforms as Record<string, { value: unknown }>;
	(uniforms.turbidity as { value: number }).value = S6_SKY.turbidity;
	(uniforms.rayleigh as { value: number }).value = S6_SKY.rayleigh;
	(uniforms.mieCoefficient as { value: number }).value = S6_SKY.mieCoefficient;
	(uniforms.mieDirectionalG as { value: number }).value = S6_SKY.mieDirectionalG;
	(uniforms.sunPosition as { value: ThreeModule.Vector3 }).value.set(...S6_SUN_POSITION);
	scene.add(sky);
}

/** What the frame loop needs from the post-processing: a draw, and a resize to the canvas's pixels. */
interface Post {
	draw(): void;
	resize(width: number, height: number): void;
}

/**
 * The post-processing of the renderer's build: ambient occlusion at the preset's scale, when it
 * has one, bloom, and the output pass that applies the ACES curve and sRGB.
 */
async function postProcessing(
	three: Three,
	scene: ThreeModule.Scene,
	{ rendererName, renderer, camera }: BuildContext,
	settings: TwinSettings,
): Promise<Post> {
	const { width, height } = renderer.domElement;
	if (rendererName === 'webgpu') {
		const webgpu = await import('three/webgpu');
		const tsl = await import('three/tsl');
		const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
		// GTAONode reads depth with textureGather, which takes no multisampled texture, so the pass
		// draws without MSAA when it feeds ambient occlusion.
		const scenePass = tsl.pass(scene, camera, settings.aoScale > 0 ? { samples: 0 } : {});
		let color = scenePass.getTextureNode('output');
		if (settings.aoScale > 0) {
			const { ao } = await import('three/addons/tsl/display/GTAONode.js');
			scenePass.setMRT(tsl.mrt({ output: tsl.output, normal: tsl.normalView }));
			const occlusion = ao(
				scenePass.getTextureNode('depth'),
				scenePass.getTextureNode('normal'),
				camera,
			);
			occlusion.resolutionScale = settings.aoScale;
			occlusion.radius.value = S6_AO.radius;
			color = tsl.vec4(color.rgb.mul(occlusion.getTextureNode().r), color.a) as never;
		}
		const glow = bloom(color, S6_BLOOM.intensity, BLOOM_RADIUS, S6_BLOOM.threshold);
		const pipeline = new webgpu.RenderPipeline(renderer as never);
		pipeline.outputNode = color.add(glow);
		return { draw: () => pipeline.render(), resize() {} };
	}
	const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
	const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
	const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
	const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
	const gl = renderer as unknown as ThreeModule.WebGLRenderer;
	const composer = new EffectComposer(gl);
	composer.addPass(new RenderPass(scene, camera));
	if (settings.aoScale > 0) {
		const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
		const scale = settings.aoScale;
		const gtao = new GTAOPass(scene, camera, width * scale, height * scale);
		gtao.updateGtaoMaterial({ radius: S6_AO.radius });
		// The pass draws its occlusion at the preset's share of the canvas, as null3D does.
		const resize = gtao.setSize.bind(gtao);
		gtao.setSize = (w: number, h: number) => resize(w * scale, h * scale);
		composer.addPass(gtao);
	}
	composer.addPass(
		new UnrealBloomPass(
			new three.Vector2(width, height),
			S6_BLOOM.intensity,
			BLOOM_RADIUS,
			S6_BLOOM.threshold,
		),
	);
	composer.addPass(new OutputPass());
	return {
		draw: () => composer.render(),
		resize(w, h) {
			composer.setPixelRatio(1);
			composer.setSize(w, h);
		},
	};
}
