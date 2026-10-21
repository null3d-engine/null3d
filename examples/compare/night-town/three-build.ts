// Night town, the three.js half: the scene's build, which runs in the comparison's worker
// (three.ts) or on the page's own thread. It builds the town one of two ways, which the page's
// mode picks, as the null3D half does:
//
// - The scene graph, the default. Each part is a Mesh of its own, as three.js's docs build a
//   scene. Each moving car is a Mesh whose cabin, lamps, two SpotLights and tail PointLight hang
//   under it, so the code writes one position and one rotation per car. Every node keeps its local
//   matrix until a write changes it (matrixAutoUpdate off, then updateMatrix), the method three.js's
//   docs advise for objects that do not move in every frame. The scene holds only the blocks that
//   show.
// - Instanced: each kind of part is one InstancedMesh, the batch of copies that three.js's docs
//   advise for many copies of a mesh, with its copies in block order, so its count shows the blocks
//   in use. The cars' copies and lights take their places from the same closed form every frame.
//
// three.js's own techniques draw the look. On WebGPURenderer, ClusteredLighting shades the point
// lights through clusters of the view, and every spot light shades every pixel. WebGLRenderer
// shades every light in every pixel, in one shader per material, and a GPU holds only so many
// lights in one shader: the build finds the most blocks whose lights it can build here, and the
// page shows that limit. The moon casts shadows through three.js's cascaded shadows (CSM, or
// CSMShadowNode), a Reflector (or the reflector node) mirrors the town in the puddles, and an
// instanced quad that faces the camera draws each layer of particles. The worker (examples/lib/three-worker.ts) draws the sky, the fog and the post
// effects.

import type * as ThreeModule from 'three';
import {
	gradeTable,
	type MeshData,
	sampleCameraLoop,
	type TextureData,
} from '../../lib/compare-scene';
import { threeSprites } from '../../lib/particles-three';
import {
	type Three,
	type ThreeBuildContext,
	type ThreeSceneBuild,
	withCsmLightFix,
} from '../../lib/three-worker';
import {
	awningPlace,
	CAR_PAINTS,
	CARS_PER_BLOCK,
	carPose,
	createNightTown,
	drawNightSprites,
	FACADE_KINDS,
	FACADE_LIT_SHARE,
	FACADE_WINDOW,
	FLYER_COUNT,
	facadeMaps,
	flyerPose,
	groundSide,
	HEADLAMPS,
	HEADLIGHT_AIM,
	LAMP_LIGHT,
	LAMPS_PER_BLOCK,
	LIGHTS_PER_BLOCK,
	LOTS_PER_BLOCK,
	lampLight,
	lampPlace,
	lightsOf,
	lotPlace,
	makeNightSprites,
	NEON_COLORS,
	NIGHT_CAMERA,
	NIGHT_LOOK,
	type NightMesh,
	nightBlocks,
	nightMeshes,
	PARKED_PER_BLOCK,
	parkedPose,
	ROOM_DEPTH,
	SIDEWALK_TILE,
	SIGN,
	SIGNS_PER_BLOCK,
	SLAB_HEIGHT,
	setActiveBlocks,
	sidewalkMaps,
	signFlicker,
	signLight,
	signPlace,
	streetMaps,
	TAIL_LIGHT,
} from './scene';
import {
	awningMaterial,
	facadeMaterial,
	neonMaterial,
	type StreetReflection,
	skyMaterial,
	streetMaterial,
	type Timed,
} from './three-shaders';

/** The cascades and map size of null3D's High preset, which WebGL2's Medium shares. */
const CASCADES = 3;
const SHADOW_MAP = 2048;
/** How far each receiver moves along its normal before its shadow test: null3D's default. */
const NORMAL_BIAS = 0.02;

/** A BufferGeometry that holds the shared mesh data as it is. */
function toGeometry(three: Three, mesh: MeshData): ThreeModule.BufferGeometry {
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(mesh.position, 3));
	geometry.setAttribute('normal', new three.BufferAttribute(mesh.normal, 3));
	geometry.setAttribute('uv', new three.BufferAttribute(mesh.uv, 2));
	geometry.setIndex(new three.BufferAttribute(mesh.index, 1));
	geometry.computeBoundingSphere();
	return geometry;
}

/** A texture of the shared data: repeated, with mip levels, at the renderer's anisotropy. */
function toTexture(
	three: Three,
	{ size, data, colorSpace }: TextureData,
	anisotropy: number,
): ThreeModule.DataTexture {
	const texture = new three.DataTexture(data, size, size, three.RGBAFormat);
	texture.colorSpace = colorSpace === 'srgb' ? three.SRGBColorSpace : three.NoColorSpace;
	texture.wrapS = texture.wrapT = three.RepeatWrapping;
	texture.generateMipmaps = true;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.magFilter = three.LinearFilter;
	texture.anisotropy = anisotropy;
	texture.needsUpdate = true;
	return texture;
}

/** A linear color as three.js's Color. */
function linear(three: Three, rgb: readonly [number, number, number]): ThreeModule.Color {
	return new three.Color().setRGB(rgb[0], rgb[1], rgb[2], three.LinearSRGBColorSpace);
}

/**
 * The most blocks whose lights WebGLRenderer can build into one shader on this GPU, up to `most`:
 * it builds a standard material with each count of the block's lights and the moon's cascades, in
 * a binary search, and counts a shader that fails to build as too many.
 */
function webglBlockLimit(three: Three, renderer: ThreeModule.WebGLRenderer, most: number): number {
	const scene = new three.Scene();
	const camera = new three.PerspectiveCamera();
	const material = new three.MeshStandardMaterial();
	scene.add(new three.Mesh(new three.PlaneGeometry(), material));
	for (let k = 0; k < CASCADES; k++) {
		const moon = new three.DirectionalLight();
		moon.castShadow = true;
		moon.shadow.mapSize.set(4, 4);
		scene.add(moon);
	}
	const target = new three.WebGLRenderTarget(4, 4);
	let failed = false;
	const debug = renderer.debug as { onShaderError: unknown };
	const before = debug.onShaderError;
	debug.onShaderError = () => {
		failed = true;
	};
	const lights: ThreeModule.Light[] = [];
	const fits = (blocks: number) => {
		for (const light of lights) scene.remove(light);
		lights.length = 0;
		for (let b = 0; b < blocks; b++) {
			for (let k = 0; k < LIGHTS_PER_BLOCK - CARS_PER_BLOCK * 2; k++)
				lights.push(new three.PointLight('#ffffff', 1, 10));
			for (let k = 0; k < CARS_PER_BLOCK * 2; k++)
				lights.push(new three.SpotLight('#ffffff', 1, 10));
		}
		if (lights.length > 0) scene.add(...lights);
		failed = false;
		material.needsUpdate = true;
		renderer.setRenderTarget(target);
		renderer.render(scene, camera);
		renderer.setRenderTarget(null);
		return !failed;
	};
	let fit = 0;
	let over = most + 1;
	while (over - fit > 1) {
		const mid = Math.floor((fit + over) / 2);
		if (fits(mid)) fit = mid;
		else over = mid;
	}
	debug.onShaderError = before;
	target.dispose();
	material.dispose();
	renderer.renderLists.dispose();
	return fit;
}

/** Builds Night town's three.js half. */
export async function buildNightTown({
	three,
	options,
	anisotropy,
	renderer,
}: ThreeBuildContext): Promise<ThreeSceneBuild> {
	const kind = options.renderer;
	const { effects } = options;
	const look = NIGHT_LOOK;
	const capacity = nightBlocks(options.capacity);
	// WebGLRenderer holds only so many lights in a shader: the town stops at that many blocks.
	const limitBlocks = kind === 'webgl' ? webglBlockLimit(three, renderer, capacity) : capacity;
	if (limitBlocks < 1)
		throw new Error(
			"three.js's WebGLRenderer cannot build a shader with one block's lights on this GPU.",
		);
	const town = createNightTown(capacity);
	setActiveBlocks(town, Math.min(limitBlocks, nightBlocks(options.count)));
	const startBlocks = town.activeBlocks;

	const scene = new three.Scene();
	scene.background = new three.Color(look.background);
	const camera = new three.PerspectiveCamera(
		look.camera.fov,
		options.width / options.height,
		look.camera.near,
		look.camera.far,
	);
	scene.add(camera);
	if (kind === 'webgpu') {
		const { ClusteredLighting } = await import('three/addons/lighting/ClusteredLighting.js');
		(renderer as unknown as { lighting: unknown }).lighting = new ClusteredLighting();
	}

	// The moon and its cascaded shadows.
	const moon = new three.DirectionalLight(linear(three, look.moon.color), look.moon.intensity);
	const [dx, dy, dz] = look.moon.direction;
	moon.position.set(-dx * 100, -dy * 100, -dz * 100);
	scene.add(moon, moon.target);
	let setup: (material: ThreeModule.Material) => void = () => {};
	let updateShadows = () => {};
	if (effects.shadows) {
		if (kind === 'webgl') {
			const { CSM } = await import('three/addons/csm/CSM.js');
			const csm = withCsmLightFix(
				three,
				() =>
					new CSM({
						camera,
						parent: scene,
						cascades: CASCADES,
						maxFar: look.moon.shadowDistance,
						mode: 'practical',
						shadowMapSize: SHADOW_MAP,
						lightDirection: new three.Vector3(dx, dy, dz).normalize(),
						lightIntensity: look.moon.intensity,
					}),
			);
			for (const light of csm.lights) {
				light.color.copy(moon.color);
				light.shadow.normalBias = NORMAL_BIAS;
			}
			scene.remove(moon);
			setup = (material) => csm.setupMaterial(material);
			updateShadows = () => {
				camera.updateMatrixWorld();
				csm.update();
			};
		} else {
			const { CSMShadowNode } = await import('three/addons/csm/CSMShadowNode.js');
			moon.castShadow = true;
			moon.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
			moon.shadow.normalBias = NORMAL_BIAS;
			const csm = new CSMShadowNode(moon as never, {
				cascades: CASCADES,
				maxFar: look.moon.shadowDistance,
				mode: 'practical',
			});
			(moon.shadow as { shadowNode?: unknown }).shadowNode = csm;
		}
	}

	// Materials.
	const timed: Timed[] = [];
	const standard = (parameters: ThreeModule.MeshStandardMaterialParameters) => {
		const made = new three.MeshStandardMaterial(parameters);
		setup(made);
		return made;
	};
	const texture = (data: TextureData) => toTexture(three, data, anisotropy);
	const facades: ThreeModule.Material[] = [];
	for (const facade of FACADE_KINDS) {
		const maps = facadeMaps(facade);
		const made = await facadeMaterial(
			three,
			kind,
			{ color: texture(maps.color), orm: texture(maps.orm), normal: texture(maps.normal) },
			{
				litShare: FACADE_LIT_SHARE[facade],
				windowLight: look.windows.intensity,
				shopLight: look.windows.shops,
				neonLight: look.windows.neon,
				window: FACADE_WINDOW[facade],
				roomDepth: ROOM_DEPTH,
			},
			setup,
		);
		timed.push(made);
		facades.push(made.material);
	}
	const streetData = streetMaps();
	const side = groundSide(capacity);
	let reflection: StreetReflection | null = null;
	let updateReflection: (street: ThreeModule.Mesh) => void = () => {};
	if (effects.reflections) {
		if (kind === 'webgpu') {
			const tsl = await import('three/tsl');
			const node = tsl.reflector({ resolutionScale: 0.5 });
			node.target.rotateX(-Math.PI / 2);
			scene.add(node.target);
			reflection = { node };
		} else {
			const { Reflector } = await import('three/addons/objects/Reflector.js');
			const mirror = new Reflector(new three.PlaneGeometry(side, side), {
				textureWidth: Math.round(options.width * options.pixelRatio * 0.5),
				textureHeight: Math.round(options.height * options.pixelRatio * 0.5),
				clipBias: 0.003,
			});
			mirror.rotateX(-Math.PI / 2);
			mirror.updateMatrixWorld();
			const toLocal = mirror.matrixWorld.clone().invert();
			const reflectorMatrix = (mirror.material as ThreeModule.ShaderMaterial).uniforms.textureMatrix
				?.value as ThreeModule.Matrix4;
			const matrix = new three.Matrix4();
			reflection = { texture: mirror.getRenderTarget().texture, matrix };
			// The Reflector draws the mirrored view before each frame, with the street hidden so its
			// material never reads the texture it draws into.
			updateReflection = (street) => {
				street.visible = false;
				mirror.onBeforeRender(renderer, scene, camera, null as never, null as never, null as never);
				street.visible = true;
				matrix.multiplyMatrices(reflectorMatrix, toLocal);
			};
		}
	}
	const streetLook = await streetMaterial(
		three,
		kind,
		{
			color: texture(streetData.color),
			orm: texture(streetData.orm),
			normal: texture(streetData.normal),
			puddles: texture(streetData.puddles),
		},
		look.street,
		reflection,
		setup,
	);
	timed.push(streetLook);
	const neon: ThreeModule.Material[] = [];
	for (const color of NEON_COLORS) {
		const made = await neonMaterial(three, kind, color.linear, look.sign.tubes, setup);
		timed.push(made);
		neon.push(made.material);
	}
	const awnings: ThreeModule.Material[] = [];
	for (const stripe of look.awning.colors) {
		const made = await awningMaterial(three, kind, stripe, '#d9d2c3', setup);
		timed.push(made);
		awnings.push(made.material);
	}
	const sidewalk = sidewalkMaps();
	const slabMap = texture(sidewalk.color);
	const slabOrm = texture(sidewalk.orm);
	const slabNormal = texture(sidewalk.normal);
	for (const map of [slabMap, slabOrm, slabNormal])
		map.repeat.set(1 / SIDEWALK_TILE, 1 / SIDEWALK_TILE);
	const slab = standard({
		map: slabMap,
		roughnessMap: slabOrm,
		metalnessMap: slabOrm,
		normalMap: slabNormal,
		roughness: 1,
		metalness: 1,
	});
	const trim = standard({ color: '#57544e', roughness: 0.6, metalness: 0.1 });
	const darkMetal = standard({ color: '#1d2024', roughness: 0.4, metalness: 0.8 });
	const lens = standard({
		color: '#000000',
		emissive: LAMP_LIGHT.hex,
		emissiveIntensity: look.lamp.lens,
	});
	const paints = CAR_PAINTS.map((color) => standard({ color, roughness: 0.28, metalness: 0.55 }));
	const cabin = standard({ color: '#0b0d10', roughness: 0.12, metalness: 0.2 });
	const headlamp = standard({
		color: '#000000',
		emissive: look.headlight.color,
		emissiveIntensity: look.headlight.lens,
	});
	const tailLamp = standard({
		color: '#000000',
		emissive: look.tail.color,
		emissiveIntensity: look.tail.lens,
	});

	// Meshes.
	const data = nightMeshes(capacity, town.designs);
	const geometries = new Map<NightMesh, ThreeModule.BufferGeometry>();
	const geometry = (name: NightMesh) => {
		let made = geometries.get(name);
		if (!made) {
			made = toGeometry(three, data[name] as MeshData);
			geometries.set(name, made);
		}
		return made;
	};
	const shadows = <T extends ThreeModule.Object3D>(object: T, cast = true): T => {
		object.castShadow = effects.shadows && cast;
		object.receiveShadow = effects.shadows;
		return object;
	};
	/** A mesh that keeps its local matrix until a write calls updateMatrix. */
	const still = (
		name: NightMesh,
		material: ThreeModule.Material,
		parent: ThreeModule.Object3D,
		x: number,
		y: number,
		z: number,
		yaw: number,
		cast = true,
	) => {
		const mesh = shadows(new three.Mesh(geometry(name), material), cast);
		mesh.position.set(x, y, z);
		mesh.rotation.y = yaw;
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		parent.add(mesh);
		return mesh;
	};

	const street = still('ground', streetLook.material, scene, 0, 0, 0, 0, false);
	// The sky's dome, which the camera carries. It draws after the town, so the town's pixels
	// hide it before its shader runs.
	const skyLook = await skyMaterial(three, kind, {
		moon: [-look.moon.direction[0], -look.moon.direction[1], -look.moon.direction[2]],
		cover: look.dome.cover,
		brightness: look.dome.brightness,
	});
	timed.push(skyLook);
	const dome = new three.Mesh(geometry('skyDome'), skyLook.material);
	dome.renderOrder = 1;
	dome.frustumCulled = false;
	scene.add(dome);

	const headDirection = new three.Vector3(...HEADLIGHT_AIM).normalize();
	const at = new Float64Array(4);
	const lot = new Int32Array(2);

	interface BlockLights {
		lights: ThreeModule.Light[];
		signs: { light: ThreeModule.PointLight; lotX: number; lotZ: number }[];
	}
	const makeLights = (b: number, parent: ThreeModule.Object3D): BlockLights => {
		const lights: ThreeModule.Light[] = [];
		for (let k = 0; k < LAMPS_PER_BLOCK; k++) {
			lampLight(town, b, k, at);
			const light = new three.PointLight(
				LAMP_LIGHT.hex,
				look.lamp.intensity,
				look.lamp.range,
				look.lamp.decay,
			);
			light.position.set(at[0] as number, at[1] as number, at[2] as number);
			lights.push(light);
		}
		const signs: BlockLights['signs'] = [];
		for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
			signLight(town, b, s, at, lot);
			const color =
				NEON_COLORS[town.signColor[b * SIGNS_PER_BLOCK + s] as number] ?? NEON_COLORS[0];
			const light = new three.PointLight(
				color?.hex,
				look.sign.intensity,
				look.sign.range,
				look.sign.decay,
			);
			light.position.set(at[0] as number, at[1] as number, at[2] as number);
			lights.push(light);
			signs.push({ light, lotX: lot[0] as number, lotZ: lot[1] as number });
		}
		for (const light of lights) {
			light.matrixAutoUpdate = false;
			light.updateMatrix();
			parent.add(light);
		}
		return { lights, signs };
	};
	const makeShops = (b: number, parent: ThreeModule.Object3D) => {
		for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
			signPlace(town, b, s, at, lot);
			const x = at[0] as number;
			const z = at[1] as number;
			const yaw = at[2] as number;
			const shape = town.signShape[b * SIGNS_PER_BLOCK + s] as number;
			still('signBoard', darkMetal, parent, x, SLAB_HEIGHT + SIGN.bottom, z, yaw);
			still(
				`signTubes${shape}`,
				neon[town.signColor[b * SIGNS_PER_BLOCK + s] as number] as ThreeModule.Material,
				parent,
				x,
				SLAB_HEIGHT + SIGN.bottom,
				z,
				yaw,
				false,
			);
			awningPlace(town, b, s, at);
			const awning = still(
				'awning',
				awnings[(b + s) % awnings.length] as ThreeModule.Material,
				parent,
				at[0] as number,
				SLAB_HEIGHT,
				at[1] as number,
				at[2] as number,
			);
			awning.scale.set(at[3] as number, 1, 1);
			awning.updateMatrix();
		}
	};
	/** A moving car's headlights and tail light, under its body or in the scene. */
	const carLights = (parent: ThreeModule.Object3D) => {
		const heads = HEADLAMPS.map(([x, y, z]) => {
			const light = new three.SpotLight(
				look.headlight.color,
				look.headlight.intensity,
				look.headlight.range,
				look.headlight.angle,
				look.headlight.penumbra,
				look.headlight.decay,
			);
			light.position.set(x, y, z);
			light.target.position.set(
				x + headDirection.x * 10,
				y + headDirection.y * 10,
				z + headDirection.z * 10,
			);
			parent.add(light, light.target);
			return light;
		});
		const tail = new three.PointLight(
			look.tail.color,
			look.tail.intensity,
			look.tail.range,
			look.tail.decay,
		);
		tail.position.set(...TAIL_LIGHT);
		parent.add(tail);
		return { heads, tail };
	};
	const signLights: BlockLights['signs'][] = [];

	interface Blocks {
		show(blocks: number): void;
		pose(seconds: number): void;
	}

	/** The scene-graph mode: a group per block, added and removed with the count. */
	const sceneGraph = (): Blocks => {
		const groups: ThreeModule.Group[] = [];
		const cars: ThreeModule.Mesh[][] = [];
		const makeBlock = (b: number) => {
			const group = new three.Group();
			group.matrixAutoUpdate = false;
			const cx = town.center[b * 2] as number;
			const cz = town.center[b * 2 + 1] as number;
			still('slab', slab, group, cx, 0, cz, 0);
			for (let l = 0; l < LOTS_PER_BLOCK; l++) {
				lotPlace(town, b, l, at);
				const d = town.lotDesign[b * LOTS_PER_BLOCK + l] as number;
				const facade = FACADE_KINDS.indexOf(town.designs[d]?.facade ?? 'brick');
				still(
					`facade${d}`,
					facades[facade] as ThreeModule.Material,
					group,
					at[0] as number,
					SLAB_HEIGHT,
					at[1] as number,
					at[2] as number,
				);
				still(
					`trim${d}`,
					trim,
					group,
					at[0] as number,
					SLAB_HEIGHT,
					at[1] as number,
					at[2] as number,
				);
			}
			for (let k = 0; k < LAMPS_PER_BLOCK; k++) {
				lampPlace(town, b, k, at);
				still(
					'lampPost',
					darkMetal,
					group,
					at[0] as number,
					SLAB_HEIGHT,
					at[1] as number,
					at[2] as number,
				);
				still(
					'lampLens',
					lens,
					group,
					at[0] as number,
					SLAB_HEIGHT,
					at[1] as number,
					at[2] as number,
					false,
				);
			}
			makeShops(b, group);
			signLights[b] = makeLights(b, group).signs;
			const moving: ThreeModule.Mesh[] = [];
			for (let c = 0; c < CARS_PER_BLOCK; c++) {
				const body = shadows(
					new three.Mesh(
						geometry('carBody'),
						paints[town.carPaint[b * CARS_PER_BLOCK + c] as number] as ThreeModule.Material,
					),
				);
				body.matrixAutoUpdate = false;
				still('carCabin', cabin, body, 0, 0, 0, 0);
				still('headlamps', headlamp, body, 0, 0, 0, 0, false);
				still('tailLamps', tailLamp, body, 0, 0, 0, 0, false);
				const lights = carLights(body);
				for (const light of [...lights.heads, ...lights.heads.map((h) => h.target), lights.tail]) {
					light.matrixAutoUpdate = false;
					light.updateMatrix();
				}
				group.add(body);
				moving.push(body);
			}
			for (let p = 0; p < PARKED_PER_BLOCK; p++) {
				parkedPose(town, b, p, at);
				const paint = paints[
					town.parkedPaint[b * PARKED_PER_BLOCK + p] as number
				] as ThreeModule.Material;
				still('carBody', paint, group, at[0] as number, 0, at[1] as number, at[2] as number);
				still('carCabin', cabin, group, at[0] as number, 0, at[1] as number, at[2] as number);
			}
			groups.push(group);
			cars.push(moving);
			scene.add(group);
		};
		const show = (blocks: number) => {
			while (groups.length < blocks) makeBlock(groups.length);
			while (groups.length > blocks) {
				scene.remove(groups.pop() as ThreeModule.Group);
				cars.pop();
			}
		};
		show(startBlocks);
		return {
			show,
			pose(seconds) {
				for (let b = 0; b < cars.length; b++) {
					const moving = cars[b] as ThreeModule.Mesh[];
					for (let c = 0; c < CARS_PER_BLOCK; c++) {
						carPose(town, b, c, seconds, at);
						const body = moving[c] as ThreeModule.Mesh;
						body.position.set(at[0] as number, 0, at[1] as number);
						body.rotation.y = at[2] as number;
						body.updateMatrix();
					}
				}
			},
		};
	};

	const blocks = sceneGraph();

	// The flying cars cross the town's sky in both modes, as scenery of its own: their batches keep
	// the measured scene graph to the town's blocks.
	const flyerPaint = standard({ color: '#363c46', roughness: 0.3, metalness: 0.7 });
	const flyers = (
		[
			['flyerBody', flyerPaint],
			['flyerHead', headlamp],
			['flyerTail', tailLamp],
		] as const
	).map(([name, material]) => {
		const made = new three.InstancedMesh(toGeometry(three, data[name]), material, FLYER_COUNT);
		made.instanceMatrix.setUsage(three.DynamicDrawUsage);
		made.frustumCulled = false;
		scene.add(made);
		return made;
	});
	const flyerMatrix = new three.Matrix4();
	const flyerPosition = new three.Vector3();
	const flyerTurn = new three.Quaternion();
	const flyerUnit = new three.Vector3(1, 1, 1);
	const flyerUp = new three.Vector3(0, 1, 0);
	const flyerAt = new Float64Array(4);
	const poseFlyers = (seconds: number) => {
		for (let i = 0; i < FLYER_COUNT; i++) {
			flyerPose(seconds, i, flyerAt);
			flyerMatrix.compose(
				flyerPosition.set(flyerAt[0] as number, flyerAt[1] as number, flyerAt[2] as number),
				flyerTurn.setFromAxisAngle(flyerUp, flyerAt[3] as number),
				flyerUnit,
			);
			for (const batch of flyers) batch.setMatrixAt(i, flyerMatrix);
		}
		for (const batch of flyers) {
			batch.instanceMatrix.clearUpdateRanges();
			batch.instanceMatrix.addUpdateRange(0, FLYER_COUNT * 16);
			batch.instanceMatrix.needsUpdate = true;
		}
	};

	// Particles: an instanced quad for each layer of the town's sprite rows.
	const sprites = effects.particles
		? await makeNightSprites(capacity, async (layer) => {
				const made = await threeSprites(three, kind, layer);
				scene.add(made.object);
				return made;
			})
		: null;

	const cameraPosition = new Float64Array(3);
	const cameraTarget = new Float64Array(3);
	const lookAt = new three.Vector3();

	return {
		scene,
		camera,
		look: {
			exposure: look.exposure,
			environmentIntensity: look.skyIntensity,
			sky: { ...look.sky, shown: look.skyIntensity },
			fog: {
				color: look.fog.color,
				density: look.fog.density,
				height: look.fog.height,
				heightFalloff: look.fog.heightFalloff,
				glow: {
					amount: look.fog.sunGlow,
					exponent: look.fog.sunGlowExponent,
					direction: look.moon.direction,
					color: [
						look.moon.color[0] * look.moon.intensity,
						look.moon.color[1] * look.moon.intensity,
						look.moon.color[2] * look.moon.intensity,
					],
				},
			},
			bloom: look.bloom,
			ao: { radius: look.ao.radius, scale: look.ao.scale },
			grade: gradeTable(look.grade),
			lens: look.lens,
		},
		limit:
			limitBlocks < capacity
				? {
						count: lightsOf(limitBlocks),
						reason: `three.js's WebGLRenderer builds every light into each material's shader, and this GPU builds such a shader with at most ${lightsOf(limitBlocks).toLocaleString('en-US')} of the town's lights.`,
					}
				: undefined,
		setCount(count) {
			const next = Math.min(limitBlocks, nightBlocks(count));
			setActiveBlocks(town, next);
			blocks.show(next);
		},
		step() {},
		pose(seconds) {
			blocks.pose(seconds);
			poseFlyers(seconds);
			for (const material of timed) material.setTime(seconds);
			for (let b = 0; b < town.activeBlocks; b++)
				for (const sign of signLights[b] ?? [])
					sign.light.intensity = look.sign.intensity * signFlicker(seconds, sign.lotX, sign.lotZ);
			sampleCameraLoop(NIGHT_CAMERA, seconds, cameraPosition, cameraTarget);
			camera.position.set(
				cameraPosition[0] as number,
				cameraPosition[1] as number,
				cameraPosition[2] as number,
			);
			camera.lookAt(
				lookAt.set(cameraTarget[0] as number, cameraTarget[1] as number, cameraTarget[2] as number),
			);
			dome.position.copy(camera.position);
			if (sprites) drawNightSprites(town, seconds, cameraPosition, sprites);
			updateShadows();
			updateReflection(street);
		},
	};
}
