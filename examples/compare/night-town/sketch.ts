// Night town, the null3D half. Each block's parts are objects of their own: the slab, each
// building's walls and trim, each lamp's post and lens, each shop's sign and awning, and each car
// as a tree. A moving car's body is a dynamic object, and its cabin, lamps, two headlights and tail
// light hang under it, so the sketch writes one position and one rotation per car and the engine
// moves the rest. Only the blocks that show are in the scene: it makes blocks as the count rises,
// and destroys them as it falls.
//
// Every effect is null3D's own technique for the look that the scene describes: the moonlit sky
// and its environment, the moon's cascaded shadows, clustered point and spot lights, height fog
// with the moon's glow, a reflection pass that the wet street's puddles show, the mip-chain bloom,
// ambient occlusion, the AgX curve, a grading table, and sprite batches for the rain, steam,
// exhaust and the glows around the lights. The facades, the street, the neon and the awnings are
// custom materials (shaders.ts).
import {
	defineSketch,
	type Material,
	type Mesh,
	type MeshGeometry,
	type PointLight,
	quat,
	type SpotLight,
} from '@null3d/engine';
import {
	effectsFromText,
	gradeTable,
	type MeshData,
	SIM_STEP,
	sampleCameraLoop,
	type TextureData,
} from '../../lib/compare-scene';
import { LENS_WGSL } from '../../lib/lens';
import { null3dSprites } from '../../lib/particles-null3d';
import { SIGNATURE_MESSAGE } from '../scene-signature';
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
	HEADLAMPS,
	HEADLIGHT_AIM,
	LAMP_LIGHT,
	LAMPS_PER_BLOCK,
	LOTS_PER_BLOCK,
	lampLight,
	lampPlace,
	lotPlace,
	makeNightSprites,
	NEON_COLORS,
	NIGHT_CAMERA,
	NIGHT_HOLD,
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
import { AWNING_WGSL, FACADE_WGSL, NEON_WGSL, SKY_WGSL, STREET_WGSL } from './shaders';

/** The blocks that each frame makes or destroys, within the engine's queue of changes. */
const BLOCKS_PER_FRAME = 40;

/** The page's message that sets the lights to draw. */
export const COUNT_MESSAGE = 'count';

/** A turn about +Y as a quaternion's four numbers. */
function yawQuat(yaw: number): [number, number, number, number] {
	return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Writes a place on the ground and a turn about +Y into a batch's rows at row i. */
function _writeRow(
	positions: Float32Array,
	rotations: Float32Array,
	i: number,
	x: number,
	z: number,
	yaw: number,
): void {
	positions[i * 3] = x;
	positions[i * 3 + 1] = 0;
	positions[i * 3 + 2] = z;
	writeYaw(rotations, i, yaw);
}

/** Writes a turn about +Y into a batch's rotations at row i. */
function writeYaw(rotations: Float32Array, i: number, yaw: number): void {
	rotations[i * 4] = 0;
	rotations[i * 4 + 1] = Math.sin(yaw / 2);
	rotations[i * 4 + 2] = 0;
	rotations[i * 4 + 3] = Math.cos(yaw / 2);
}

/** One way of building the blocks: it shows a count of blocks and poses their cars each frame. */
interface Blocks {
	show(blocks: number): void;
	/** Writes what moves at simulation time `seconds`, before the engine updates the scene. */
	pose(seconds: number): void;
}

export default defineSketch(
	async ({ scene, geometry, materials, textures, assets, post, quality, page, render }) => {
		const params = new URL(import.meta.url).searchParams;
		const capacity = nightBlocks(Number(params.get('capacity') ?? NIGHT_HOLD.count));
		const effects = effectsFromText(params.get('effects'));
		const town = createNightTown(capacity);
		const startBlocks = Math.min(
			capacity,
			nightBlocks(Number(params.get('count') ?? capacity * 12)),
		);
		setActiveBlocks(town, startBlocks);
		const look = NIGHT_LOOK;

		// The comparison's fixed settings: no governor, every pixel drawn, and ambient occlusion at
		// half the render size in each direction, as the three.js half draws it.
		quality.set({
			governor: false,
			minRenderScale: 1,
			maxRenderScale: 1,
			aoScale: effects.ao ? look.ao.scale : 0,
		});
		post.set({
			toneMapping: 'agx',
			exposure: look.exposure,
			bloom: effects.bloom && { ...look.bloomChain, threshold: look.bloom.threshold, blend: 'add' },
			ao: effects.ao && { radius: look.ao.radius, intensity: look.ao.intensity },
		});
		if (effects.lens) post.addEffect({ wgsl: LENS_WGSL, uniforms: look.lens });
		if (effects.grade) {
			const table = gradeTable(look.grade);
			const data = Float32Array.from(
				{ length: table.size ** 3 * 3 },
				(_, i) => (table.data[Math.floor(i / 3) * 4 + (i % 3)] as number) / 255,
			);
			post.set({ lut: await assets.lutFromData({ size: table.size, data }) });
		}

		// The moonlit sky's light, the moon and the haze. The sky dome hides the sky's background.
		scene.setBackground({ sky: { ...look.sky, time: 0 } }, { intensity: look.skyIntensity });
		scene.setEnvironment(await assets.skyEnvironment(), { intensity: look.skyIntensity });
		if (effects.fog) scene.setFog({ curve: 'exponential', ...look.fog });
		scene.createDirectionalLight({
			direction: [...look.moon.direction],
			color: [...look.moon.color],
			intensity: look.moon.intensity,
			castShadows: effects.shadows,
			shadow: { distance: look.moon.shadowDistance },
		});

		// Textures made in code.
		const upload = ({ size, data, colorSpace }: TextureData, wrap: 'repeat' | 'clamp' = 'repeat') =>
			textures.fromData({
				width: size,
				height: size,
				data,
				colorSpace,
				wrap,
				mipmaps: true,
				anisotropy: 8,
			});
		const street = streetMaps();
		const sidewalk = sidewalkMaps();

		// Materials.
		const timed: Material[] = [];
		const facades = FACADE_KINDS.map((kind) => {
			const maps = facadeMaps(kind);
			const material = materials.shader({
				wgsl: FACADE_WGSL,
				roughness: 1,
				metalness: 1,
				uniforms: {
					time: 0,
					litShare: FACADE_LIT_SHARE[kind],
					windowLight: look.windows.intensity,
					shopLight: look.windows.shops,
					neonLight: look.windows.neon,
					winU0: FACADE_WINDOW[kind][0],
					winU1: FACADE_WINDOW[kind][1],
					winV0: FACADE_WINDOW[kind][2],
					winV1: FACADE_WINDOW[kind][3],
					roomDepth: ROOM_DEPTH,
				},
				textures: {
					colorMap: upload(maps.color),
					ormMap: upload(maps.orm),
					normalMap: upload(maps.normal),
				},
			});
			timed.push(material);
			return material;
		});
		const reflection = effects.reflections
			? render.addPass({
					kind: 'reflection',
					writes: 'street',
					plane: { point: [0, 0, 0] },
					scale: 0.5,
				})
			: null;
		const black = textures.fromData({
			width: 1,
			height: 1,
			data: new Uint8Array([0, 0, 0, 255]),
			colorSpace: 'linear',
		});
		const streetMaterial = materials.shader({
			wgsl: STREET_WGSL,
			uniforms: {
				time: 0,
				puddleShare: look.street.puddleShare,
				wetDarken: look.street.wetDarken,
				mirrorShare: reflection ? 1 : 0,
				wetMirror: look.street.wetMirror,
			},
			textures: {
				colorMap: upload(street.color),
				ormMap: upload(street.orm),
				normalMap: upload(street.normal),
				puddleMap: upload(street.puddles),
				mirror: reflection ? textures.fromPass(reflection) : black,
			},
		});
		timed.push(streetMaterial);
		const neon = NEON_COLORS.map((color) => {
			const material = materials.shader({
				wgsl: NEON_WGSL,
				uniforms: { glow: color.linear, time: 0, strength: look.sign.tubes },
			});
			timed.push(material);
			return material;
		});
		const sky = materials.shader({
			wgsl: SKY_WGSL,
			fog: false,
			uniforms: {
				moon: [-look.moon.direction[0], -look.moon.direction[1], -look.moon.direction[2]],
				time: 0,
				cover: look.dome.cover,
				brightness: look.dome.brightness,
			},
		});
		timed.push(sky);
		const awnings = look.awning.colors.map((stripe) => {
			const material = materials.shader({
				wgsl: AWNING_WGSL,
				doubleSided: true,
				uniforms: { stripeA: stripe, time: 0, stripeB: '#d9d2c3' },
			});
			timed.push(material);
			return material;
		});
		const slab = materials.standard({
			map: upload(sidewalk.color),
			metalnessRoughnessMap: upload(sidewalk.orm),
			normalMap: upload(sidewalk.normal),
			roughness: 1,
			metalness: 1,
			uvTransform: { repeat: [1 / SIDEWALK_TILE, 1 / SIDEWALK_TILE] },
		});
		const trim = materials.standard({ color: '#57544e', roughness: 0.6, metalness: 0.1 });
		const darkMetal = materials.standard({ color: '#1d2024', roughness: 0.4, metalness: 0.8 });
		const lens = materials.standard({
			color: '#000000',
			emissive: LAMP_LIGHT.hex,
			emissiveIntensity: look.lamp.lens,
		});
		const paints = CAR_PAINTS.map((color) =>
			materials.standard({ color, roughness: 0.28, metalness: 0.55 }),
		);
		const _whitePaint = materials.standard({ color: '#ffffff', roughness: 0.28, metalness: 0.55 });
		const flyerPaint = materials.standard({ color: '#363c46', roughness: 0.3, metalness: 0.7 });
		const cabin = materials.standard({ color: '#0b0d10', roughness: 0.12, metalness: 0.2 });
		const headlamp = materials.standard({
			color: '#000000',
			emissive: look.headlight.color,
			emissiveIntensity: look.headlight.lens,
		});
		const tailLamp = materials.standard({
			color: '#000000',
			emissive: look.tail.color,
			emissiveIntensity: look.tail.lens,
		});

		// Meshes, from the shared description.
		const data = nightMeshes(capacity, town.designs);
		const meshes = new Map<NightMesh, MeshGeometry>();
		const mesh = (name: NightMesh) => {
			let made = meshes.get(name);
			if (!made) {
				const m = data[name] as MeshData;
				made = geometry.fromArrays({
					positions: m.position,
					normals: m.normal,
					uvs: m.uv,
					indices: m.index,
				});
				meshes.set(name, made);
			}
			return made;
		};
		const casts = { castShadows: effects.shadows, receiveShadows: effects.shadows };

		scene.createMesh({
			mesh: mesh('ground'),
			material: streetMaterial,
			receiveShadows: effects.shadows,
		});
		const dome = scene.createMesh({ mesh: mesh('skyDome'), material: sky, dynamic: true });

		const position = new Float64Array(4);
		const carAt = new Float64Array(3);
		const lot = new Int32Array(2);
		const headDirection = (() => {
			const [x, y, z] = HEADLIGHT_AIM;
			const length = Math.hypot(x, y, z);
			return [x / length, y / length, z / length] as [number, number, number];
		})();

		// The lights of every block, which the sketch makes and destroys with the blocks.
		interface BlockLights {
			lamps: PointLight[];
			signs: PointLight[];
			signLots: Int32Array;
		}
		const makeLights = (b: number): BlockLights => {
			const lamps: PointLight[] = [];
			for (let k = 0; k < LAMPS_PER_BLOCK; k++) {
				lampLight(town, b, k, position);
				lamps.push(
					scene.createPointLight({
						position: [position[0] as number, position[1] as number, position[2] as number],
						color: LAMP_LIGHT.hex,
						intensity: look.lamp.intensity,
						range: look.lamp.range,
						decay: look.lamp.decay,
					}),
				);
			}
			const signs: PointLight[] = [];
			const signLots = new Int32Array(SIGNS_PER_BLOCK * 2);
			for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
				signLight(town, b, s, position, lot);
				signLots[s * 2] = lot[0] as number;
				signLots[s * 2 + 1] = lot[1] as number;
				signs.push(
					scene.createPointLight({
						position: [position[0] as number, position[1] as number, position[2] as number],
						color: (
							NEON_COLORS[town.signColor[b * SIGNS_PER_BLOCK + s] as number] ?? NEON_COLORS[0]
						)?.hex,
						intensity: look.sign.intensity,
						range: look.sign.range,
						decay: look.sign.decay,
					}),
				);
			}
			return { lamps, signs, signLots };
		};

		/** The shops' signs and awnings, two of each a block. */
		const makeShops = (b: number): Mesh[] => {
			const made: Mesh[] = [];
			for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
				signPlace(town, b, s, position, lot);
				const at: [number, number, number] = [
					position[0] as number,
					SLAB_HEIGHT + SIGN.bottom,
					position[1] as number,
				];
				const rotation = yawQuat(position[2] as number);
				const shape = town.signShape[b * SIGNS_PER_BLOCK + s] as number;
				made.push(
					scene.createMesh({
						mesh: mesh('signBoard'),
						material: darkMetal,
						position: at,
						rotation,
						...casts,
					}),
				);
				made.push(
					scene.createMesh({
						mesh: mesh(`signTubes${shape}`),
						material: neon[town.signColor[b * SIGNS_PER_BLOCK + s] as number] as Material,
						position: at,
						rotation,
					}),
				);
				awningPlace(town, b, s, position);
				made.push(
					scene.createMesh({
						mesh: mesh('awning'),
						material: awnings[(b + s) % awnings.length] as Material,
						position: [position[0] as number, SLAB_HEIGHT, position[1] as number],
						rotation: yawQuat(position[2] as number),
						scale: [position[3] as number, 1, 1],
						...casts,
					}),
				);
			}
			return made;
		};

		const carLights = (parent: Mesh | null): { heads: SpotLight[]; tail: PointLight } => ({
			heads: HEADLAMPS.map(([x, y, z]) =>
				scene.createSpotLight({
					parent,
					position: [x, y, z],
					direction: headDirection,
					color: look.headlight.color,
					intensity: look.headlight.intensity,
					range: look.headlight.range,
					decay: look.headlight.decay,
					angle: look.headlight.angle,
					penumbra: look.headlight.penumbra,
					dynamic: parent === null,
				}),
			),
			tail: scene.createPointLight({
				parent,
				position: [...TAIL_LIGHT],
				color: look.tail.color,
				intensity: look.tail.intensity,
				range: look.tail.range,
				decay: look.tail.decay,
				dynamic: parent === null,
			}),
		});

		const signLights: { light: PointLight; lotX: number; lotZ: number }[][] = [];
		const keepSignLights = (b: number, lights: BlockLights) => {
			signLights[b] = lights.signs.map((light, s) => ({
				light,
				lotX: lights.signLots[s * 2] as number,
				lotZ: lights.signLots[s * 2 + 1] as number,
			}));
		};

		/** A tree of objects per part, made and destroyed with the blocks. */
		const buildBlocks = (): Blocks => {
			interface Block {
				objects: { destroy(): void }[];
				cars: Mesh[];
			}
			const made: Block[] = [];
			let wanted = startBlocks;
			const createBlock = (b: number) => {
				const objects: { destroy(): void }[] = [];
				const cars: Mesh[] = [];
				const cx = town.center[b * 2] as number;
				const cz = town.center[b * 2 + 1] as number;
				objects.push(
					scene.createMesh({ mesh: mesh('slab'), material: slab, position: [cx, 0, cz], ...casts }),
				);
				for (let l = 0; l < LOTS_PER_BLOCK; l++) {
					lotPlace(town, b, l, position);
					const d = town.lotDesign[b * LOTS_PER_BLOCK + l] as number;
					const design = town.designs[d];
					const at: [number, number, number] = [
						position[0] as number,
						SLAB_HEIGHT,
						position[1] as number,
					];
					const rotation = yawQuat(position[2] as number);
					const kind = FACADE_KINDS.indexOf(design?.facade ?? 'brick');
					objects.push(
						scene.createMesh({
							mesh: mesh(`facade${d}`),
							material: facades[kind] as Material,
							position: at,
							rotation,
							...casts,
						}),
					);
					objects.push(
						scene.createMesh({
							mesh: mesh(`trim${d}`),
							material: trim,
							position: at,
							rotation,
							...casts,
						}),
					);
				}
				for (let k = 0; k < LAMPS_PER_BLOCK; k++) {
					lampPlace(town, b, k, position);
					const at: [number, number, number] = [
						position[0] as number,
						SLAB_HEIGHT,
						position[1] as number,
					];
					const rotation = yawQuat(position[2] as number);
					objects.push(
						scene.createMesh({
							mesh: mesh('lampPost'),
							material: darkMetal,
							position: at,
							rotation,
							...casts,
						}),
					);
					objects.push(
						scene.createMesh({ mesh: mesh('lampLens'), material: lens, position: at, rotation }),
					);
				}
				objects.push(...makeShops(b));
				const lights = makeLights(b);
				objects.push(...lights.lamps, ...lights.signs);
				keepSignLights(b, lights);
				for (let c = 0; c < CARS_PER_BLOCK; c++) {
					const body = scene.createMesh({
						mesh: mesh('carBody'),
						material: paints[town.carPaint[b * CARS_PER_BLOCK + c] as number] as Material,
						dynamic: true,
						...casts,
					});
					objects.push(body, ...placeCarParts(body));
					const { heads, tail } = carLights(body);
					objects.push(...heads, tail);
					cars.push(body);
				}
				for (let p = 0; p < PARKED_PER_BLOCK; p++) {
					parkedPose(town, b, p, carAt);
					const at: [number, number, number] = [carAt[0] as number, 0, carAt[1] as number];
					const rotation = yawQuat(carAt[2] as number);
					objects.push(
						scene.createMesh({
							mesh: mesh('carBody'),
							material: paints[town.parkedPaint[b * PARKED_PER_BLOCK + p] as number] as Material,
							position: at,
							rotation,
							...casts,
						}),
						scene.createMesh({
							mesh: mesh('carCabin'),
							material: cabin,
							position: at,
							rotation,
							...casts,
						}),
					);
				}
				made.push({ objects, cars });
			};
			const placeCarParts = (body: Mesh) => [
				scene.createMesh({ mesh: mesh('carCabin'), material: cabin, parent: body, ...casts }),
				scene.createMesh({ mesh: mesh('headlamps'), material: headlamp, parent: body }),
				scene.createMesh({ mesh: mesh('tailLamps'), material: tailLamp, parent: body }),
			];
			const fit = () => {
				if (made.length < wanted) {
					const until = Math.min(wanted, made.length + BLOCKS_PER_FRAME);
					while (made.length < until) createBlock(made.length);
				} else if (made.length > wanted) {
					const until = Math.max(wanted, made.length - BLOCKS_PER_FRAME);
					while (made.length > until)
						for (const object of made.pop()?.objects ?? []) object.destroy();
				}
			};
			fit();
			return {
				show(blocks) {
					wanted = blocks;
				},
				pose(seconds) {
					fit();
					for (let b = 0; b < made.length; b++) {
						const cars = (made[b] as Block).cars;
						for (let c = 0; c < CARS_PER_BLOCK; c++) {
							carPose(town, b, c, seconds, carAt);
							const yaw = carAt[2] as number;
							const car = cars[c] as Mesh;
							car.setPosition(carAt[0] as number, 0, carAt[1] as number);
							car.setRotation(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
						}
					}
				},
			};
		};
		const blocks = buildBlocks();

		// The flying cars cross the town's sky as scenery of its own: their batches keep the measured
		// scene graph to the town's blocks.
		const flyers = (
			[
				['flyerBody', flyerPaint],
				['flyerHead', headlamp],
				['flyerTail', tailLamp],
			] as const
		).map(([name, material]) =>
			scene.createInstances(mesh(name), FLYER_COUNT, { material, dynamic: true }),
		);
		const flyerAt = new Float64Array(4);

		// Particles: a sprite batch for each layer of the town's sprite rows.
		const sprites = effects.particles
			? await makeNightSprites(capacity, (layer) => null3dSprites({ scene, textures }, layer))
			: null;

		const camera = scene.createPerspectiveCamera(look.camera);
		scene.setActiveCamera(camera);

		page.onMessage((type, value) => {
			if (type === COUNT_MESSAGE) {
				const next = Math.min(capacity, nightBlocks(value as number));
				setActiveBlocks(town, next);
				blocks.show(next);
			} else if (type === SIGNATURE_MESSAGE) {
				// The ramp's browser test asks where the camera is now: a frozen scene answers the same.
				page.post(SIGNATURE_MESSAGE, {
					token: value,
					camera: [cameraPosition[0], cameraPosition[2]],
				});
			}
		});

		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const cameraRotation = quat.create();
		const time = { time: 0 };
		let steps = 0;

		const pose = () => {
			const seconds = steps * SIM_STEP;
			blocks.pose(seconds);
			for (let i = 0; i < FLYER_COUNT; i++) {
				flyerPose(seconds, i, flyerAt);
				for (const batch of flyers) {
					batch.positions[i * 3] = flyerAt[0] as number;
					batch.positions[i * 3 + 1] = flyerAt[1] as number;
					batch.positions[i * 3 + 2] = flyerAt[2] as number;
					writeYaw(batch.rotations, i, flyerAt[3] as number);
				}
			}
			for (const batch of flyers) batch.markDirty();
			time.time = seconds;
			for (const material of timed) material.set(time as never);
			for (let b = 0; b < town.activeBlocks; b++)
				for (const sign of signLights[b] ?? [])
					sign.light.setIntensity(look.sign.intensity * signFlicker(seconds, sign.lotX, sign.lotZ));
			sampleCameraLoop(NIGHT_CAMERA, seconds, cameraPosition, cameraTarget);
			if (sprites) drawNightSprites(town, seconds, cameraPosition, sprites);
			quat.lookAt(cameraRotation, cameraTarget, cameraPosition);
			dome.setPosition(
				cameraPosition[0] as number,
				cameraPosition[1] as number,
				cameraPosition[2] as number,
			);
			camera.setPosition(
				cameraPosition[0] as number,
				cameraPosition[1] as number,
				cameraPosition[2] as number,
			);
			camera.setRotation(
				cameraRotation[0] as number,
				cameraRotation[1] as number,
				cameraRotation[2] as number,
				cameraRotation[3] as number,
			);
		};
		pose();

		return {
			onFixedUpdate() {
				steps++;
			},
			onUpdate: pose,
		};
	},
	{ fixedRate: 1 / SIM_STEP, maxFixedSteps: 8 },
);
