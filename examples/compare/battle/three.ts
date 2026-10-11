// Battle, the three.js half, which runs in its worker. Both armies' soldiers and mechs are the same
// two model files that null3D loads, read by GLTFLoader. The page's mode picks how they are built:
//
// - The scene graph, the default: each unit is its own copy of the model (SkeletonUtils.clone),
//   with its own bones and AnimationMixer, as three.js's animation examples build characters. Each
//   frame the unit's mixer takes the clips' times and weights from the shared simulation and
//   poses its bones, and the renderer skins the unit as it draws it. Each tank is a tree of three
//   meshes: the hull, the turret on it and the barrel on the turret.
// - Instanced: three.js's documented crowd route (battle-crowd.ts): one mixer per model poses each
//   unit in turn, and one draw per model skins every unit from a table of bone matrices. Each tank
//   part is one InstancedMesh, posed in closed form.
//
// Tracers, shells and particles are batches in both modes. The worker
// (examples/lib/three-worker.ts) draws the sky, the sun's cascaded shadows, the fog and the effects.

import type * as ThreeModule from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import {
	gradeTable,
	type MeshData,
	type SurfaceKind,
	sampleCameraLoop,
	surfaceMaps,
} from '../../lib/compare-scene';
import { createSpriteRows, fireAtlas, smokeAtlas } from '../../lib/particles';
import { threeSprites } from '../../lib/particles-three';
import { sampleUrl } from '../../lib/samples';
import { runThreeWorker, type Three } from '../../lib/three-worker';
import {
	ARMIES,
	activeTanks,
	BATTLE_CAMERA,
	BATTLE_LOOK,
	BATTLE_MATERIALS,
	BATTLE_SEED,
	type BattleMaterial,
	barrelRecoil,
	battleMeshes,
	battleUnits,
	CLIP_NAMES,
	createBattle,
	FIRE_LIGHT,
	FLAG_POLE_HEIGHT,
	FLAGS,
	flightTransform,
	GRASS,
	LIGHT_COUNT,
	MODELS,
	type ModelName,
	type Placed,
	particleCapacity,
	ROCKS,
	RUINS,
	SURFACE_SIZE,
	setActiveUnits,
	stepBattle,
	TANK_BARREL_PIVOT,
	TANK_TRAPS,
	TANK_TURRET_HEIGHT,
	TOWER,
	TREES,
	UnitKind,
	unitKindOf,
	WIND,
	WRECK_LIGHT,
	WRECK_LOOK,
	WRECKS,
	writeLights,
	writeParticles,
} from './scene';
import { DrawCrowd } from './three-crowd';
import { type ClipPoser, poseUnitMixer, unitActions } from './three-pose';
import { battleShaders, GRASS_PHASE, grassPhase } from './three-shaders';

/** A BufferGeometry that holds the shared mesh data as it is. */
function toGeometry(three: Three, mesh: MeshData): ThreeModule.BufferGeometry {
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(mesh.position, 3));
	geometry.setAttribute('normal', new three.BufferAttribute(mesh.normal, 3));
	geometry.setAttribute('uv', new three.BufferAttribute(mesh.uv, 2));
	if (mesh.color) geometry.setAttribute('color', new three.BufferAttribute(mesh.color, 3));
	geometry.setIndex(new three.BufferAttribute(mesh.index, 1));
	geometry.computeBoundingSphere();
	return geometry;
}

/** Uploads only the copies in use: the first `count` matrices. */
function uploadCopies(batch: ThreeModule.InstancedMesh, count: number): void {
	const matrices = batch.instanceMatrix;
	matrices.clearUpdateRanges();
	matrices.addUpdateRange(0, Math.max(1, count) * 16);
	matrices.needsUpdate = true;
}

/** Writes a world matrix of a turn about +Y and a place, column-major, at `offset`. */
function writeYawMatrix(
	out: Float32Array,
	offset: number,
	yaw: number,
	x: number,
	y: number,
	z: number,
) {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	out[offset] = c;
	out[offset + 1] = 0;
	out[offset + 2] = -s;
	out[offset + 3] = 0;
	out[offset + 4] = 0;
	out[offset + 5] = 1;
	out[offset + 6] = 0;
	out[offset + 7] = 0;
	out[offset + 8] = s;
	out[offset + 9] = 0;
	out[offset + 10] = c;
	out[offset + 11] = 0;
	out[offset + 12] = x;
	out[offset + 13] = y;
	out[offset + 14] = z;
	out[offset + 15] = 1;
}

/** The units: shows a count of them and poses them each frame. */
interface Units {
	show(count: number): void;
	pose(): void;
}

runThreeWorker(async ({ three, options, anisotropy }) => {
	const capacity = battleUnits(options.capacity);
	const state = createBattle(capacity);
	const data = battleMeshes();
	const { effects } = options;
	const look = BATTLE_LOOK;
	const renderer = options.renderer;
	const scene = new three.Scene();
	scene.add(
		new three.HemisphereLight(
			look.hemisphere.sky,
			look.hemisphere.ground,
			look.hemisphere.intensity,
		),
	);
	const shaders = await battleShaders(three, renderer);
	const M = BATTLE_MATERIALS;

	// Surfaces: each kind's maps are made once; a material with another repeat takes copies of the
	// textures that share their texels.
	const made = new Map<SurfaceKind, ThreeModule.DataTexture[]>();
	const surface = (kind: SurfaceKind, repeat: number) => {
		let maps = made.get(kind);
		if (!maps) {
			const texels = surfaceMaps(kind, SURFACE_SIZE, BATTLE_SEED);
			maps = [texels.color, texels.orm, texels.normal].map(({ size, data: bytes, colorSpace }) => {
				const texture = new three.DataTexture(bytes, size, size, three.RGBAFormat);
				texture.colorSpace = colorSpace === 'srgb' ? three.SRGBColorSpace : three.NoColorSpace;
				texture.wrapS = texture.wrapT = three.RepeatWrapping;
				texture.generateMipmaps = true;
				texture.minFilter = three.LinearMipmapLinearFilter;
				texture.magFilter = three.LinearFilter;
				texture.anisotropy = anisotropy;
				texture.needsUpdate = true;
				return texture;
			});
			made.set(kind, maps);
		}
		if (repeat === 1) return maps;
		return maps.map((texture) => {
			const copy = texture.clone();
			copy.repeat.set(repeat, repeat);
			return copy;
		});
	};
	const material = (spec: BattleMaterial): ThreeModule.MeshStandardMaterial => {
		const common = {
			color: spec.color,
			vertexColors: spec.vertexColors === true,
			side: spec.doubleSided ? three.DoubleSide : three.FrontSide,
		};
		if (spec.surface) {
			const [map, orm, normalMap] = surface(
				spec.surface,
				spec.repeat ?? 1,
			) as ThreeModule.Texture[];
			return new three.MeshStandardMaterial({
				...common,
				// The maps alone set roughness and metalness, as glTF's factors of 1 do.
				roughness: 1,
				metalness: 1,
				map,
				roughnessMap: orm,
				metalnessMap: orm,
				normalMap,
			});
		}
		return new three.MeshStandardMaterial({
			...common,
			roughness: spec.roughness,
			metalness: spec.metalness,
			emissive: spec.emissive ?? '#000000',
			emissiveIntensity: spec.emissiveIntensity ?? 1,
		});
	};
	const withShadows = <T extends ThreeModule.Object3D>(object: T, spec: BattleMaterial): T => {
		object.castShadow = effects.shadows && spec.noShadow !== true;
		object.receiveShadow = effects.shadows;
		return object;
	};
	/** A mesh that keeps its matrix: the scenery stands still. */
	const still = (object: ThreeModule.Object3D) => {
		object.updateMatrix();
		object.matrixAutoUpdate = false;
		scene.add(object);
		return object;
	};

	// The ground.
	const ground = material(M.ground);
	still(withShadows(new three.Mesh(toGeometry(three, data.single.field), ground), M.ground));
	const land = new three.Mesh(toGeometry(three, data.single.land), ground);
	land.receiveShadow = effects.shadows;
	still(land);

	/** A still batch of placed copies of one mesh. */
	const scatter = (
		geometry: ThreeModule.BufferGeometry,
		list: readonly Placed[],
		made: ThreeModule.Material,
		spec: BattleMaterial,
		lift = 0,
	) => {
		const batch = new three.InstancedMesh(geometry, made, Math.max(1, list.length));
		const matrix = new three.Matrix4();
		const position = new three.Vector3();
		const rotation = new three.Quaternion();
		const scale = new three.Vector3();
		const up = new three.Vector3(0, 1, 0);
		list.forEach((p, i) => {
			position.set(p.x, p.y + lift * p.scale, p.z);
			rotation.setFromAxisAngle(up, p.yaw);
			scale.setScalar(p.scale);
			batch.setMatrixAt(i, matrix.compose(position, rotation, scale));
		});
		batch.count = list.length;
		batch.computeBoundingSphere();
		return still(withShadows(batch, spec));
	};
	const rock = material(M.rock);
	data.rocks.forEach((mesh, v) => {
		scatter(
			toGeometry(three, mesh),
			ROCKS.filter((p) => p.variant === v),
			rock,
			M.rock,
			-0.1,
		);
	});
	const tree = material(M.tree);
	data.trees.forEach((mesh, v) => {
		scatter(
			toGeometry(three, mesh),
			TREES.filter((p) => p.variant === v),
			tree,
			M.tree,
		);
	});
	scatter(toGeometry(three, data.single.trap), TANK_TRAPS, material(M.trap), M.trap);
	const grass = shaders.grass({
		color: M.grass.color,
		roughness: M.grass.roughness,
		...WIND.grass,
	});
	data.grass.forEach((mesh, v) => {
		const list = GRASS.filter((p) => p.variant === v);
		const geometry = toGeometry(three, mesh);
		const phase = new Float32Array(Math.max(1, list.length));
		list.forEach((p, i) => {
			phase[i] = grassPhase(p.x, p.z);
		});
		geometry.setAttribute(GRASS_PHASE, new three.InstancedBufferAttribute(phase, 1));
		scatter(geometry, list, grass, M.grass);
	});
	const wall = material(M.wall);
	const up = new three.Vector3(0, 1, 0);
	RUINS.forEach((ruin, k) => {
		const mesh = withShadows(
			new three.Mesh(toGeometry(three, data.walls[k] as MeshData), wall),
			M.wall,
		);
		mesh.position.set(ruin.x, ruin.y - 0.2, ruin.z);
		mesh.quaternion.setFromAxisAngle(up, ruin.yaw);
		still(mesh);
	});
	const tower = withShadows(new three.Mesh(toGeometry(three, data.single.tower), wall), M.wall);
	tower.position.set(TOWER.x, TOWER.y - 0.3, TOWER.z);
	tower.quaternion.setFromAxisAngle(up, TOWER.yaw);
	still(tower);
	const charred = shaders.embers({
		color: WRECK_LOOK.color,
		roughness: WRECK_LOOK.roughness,
		metalness: WRECK_LOOK.metalness,
		ember: WRECK_LOOK.ember,
		glow: WRECK_LOOK.emberIntensity,
	});
	const wreckGeometry = toGeometry(three, data.single.wreck);
	for (const wreck of WRECKS) {
		const mesh = new three.Mesh(wreckGeometry, charred);
		mesh.castShadow = mesh.receiveShadow = effects.shadows;
		mesh.position.set(wreck.x, wreck.y - 0.35, wreck.z);
		mesh.rotation.set(0, wreck.yaw, wreck.tilt, 'XYZ');
		still(mesh);
	}
	const poleGeometry = toGeometry(three, data.single.pole);
	const poleMaterial = material(M.pole);
	const cloth = toGeometry(three, data.single.flag);
	const flagMaterials = ARMIES.map((army) =>
		shaders.flag({ color: army.flag, roughness: M.flag.roughness, ...WIND.flag }),
	);
	for (const flag of FLAGS) {
		const pole = withShadows(new three.Mesh(poleGeometry, poleMaterial), M.pole);
		pole.position.set(flag.x, flag.y, flag.z);
		still(pole);
		const banner = withShadows(new three.Mesh(cloth, flagMaterials[flag.army]), M.flag);
		banner.position.set(flag.x, flag.y + FLAG_POLE_HEIGHT - 1.75, flag.z);
		banner.quaternion.setFromAxisAngle(up, flag.yaw);
		// The cloth swings out of its geometry's sphere, so it never culls.
		banner.frustumCulled = false;
		still(banner);
	}

	// The armies, from the two model files.
	const loader = new GLTFLoader();
	const [soldier, mech] = await Promise.all([
		loader.loadAsync(sampleUrl('sources/characters/battle-soldier/soldier.glb')),
		loader.loadAsync(sampleUrl('sources/characters/quaternius-mech/mech.glb')),
	]);
	const models = { soldier, mech };
	const uniforms = ARMIES.map(
		(army) =>
			new three.MeshStandardMaterial({
				color: army.tint,
				vertexColors: true,
				roughness: 0.8,
				metalness: 0,
			}),
	);

	/** The scene-graph mode: a copy of the model per unit, with its own mixer. */
	const sceneGraphUnits = (): Units => {
		interface Unit {
			root: ThreeModule.Object3D;
			mixer: ThreeModule.AnimationMixer;
			poser: ClipPoser;
		}
		const units: Unit[] = [];
		const group = new three.Group();
		scene.add(group);
		// One sphere per model, around the rest pose with room for any pose, so three.js culls a
		// unit without measuring its posed vertices.
		const spheres = new Map<ModelName, ThreeModule.Sphere>();
		const makeUnit = (i: number) => {
			const name: ModelName = unitKindOf(i) === UnitKind.mech ? 'mech' : 'soldier';
			const model = models[name];
			const root = cloneModel(model.scene);
			root.traverse((object) => {
				const mesh = object as ThreeModule.SkinnedMesh;
				if (!mesh.isMesh) return;
				mesh.castShadow = mesh.receiveShadow = effects.shadows;
				if (!mesh.isSkinnedMesh) return;
				if (mesh.name === MODELS[name].mesh)
					mesh.material = uniforms[i & 1] as ThreeModule.Material;
				let sphere = spheres.get(name);
				if (!sphere) {
					mesh.geometry.computeBoundingSphere();
					sphere = (mesh.geometry.boundingSphere as ThreeModule.Sphere).clone();
					sphere.radius *= 1.6;
					spheres.set(name, sphere);
				}
				mesh.boundingSphere = sphere;
			});
			root.scale.setScalar(MODELS[name].scale);
			const mixer = new three.AnimationMixer(root);
			units.push({ root, mixer, poser: unitActions(mixer, model.animations, CLIP_NAMES) });
			group.add(root);
		};
		let shown = 0;
		return {
			show(count) {
				while (units.length < count) makeUnit(units.length);
				for (let i = 0; i < units.length; i++) (units[i] as Unit).root.visible = i < count;
				shown = count;
			},
			pose() {
				for (let i = 0; i < shown; i++) {
					const unit = units[i] as Unit;
					unit.root.position.set(state.x[i] as number, state.y[i] as number, state.z[i] as number);
					unit.root.rotation.y = state.heading[i] as number;
					poseUnitMixer(state, i, unit.mixer, unit.poser);
				}
			},
		};
	};

	/** The instanced mode: three.js's crowd route, one draw per model. */
	const instancedUnits = async (): Promise<Units> => {
		const crowds = await Promise.all(
			(['soldier', 'mech'] as const).map((name) =>
				DrawCrowd.create(three, models[name], {
					name,
					capacity: capacity,
					uniforms: uniforms as ThreeModule.MeshStandardMaterial[],
					shadows: effects.shadows,
					textures: options.forceWebGL === true,
				}),
			),
		);
		for (const crowd of crowds) scene.add(crowd.object);
		let shown = 0;
		return {
			show(count) {
				shown = count;
			},
			pose() {
				for (const crowd of crowds) crowd.pose(state, shown);
			},
		};
	};

	const units = options.mode === 'instanced' ? await instancedUnits() : sceneGraphUnits();

	// Tanks: a tree per tank, or a batch per part in closed form.
	const paint = ARMIES.map((army) => material({ color: army.tank, surface: 'camo', repeat: 0.5 }));
	const tankGeometry = {
		hull: toGeometry(three, data.single.hull),
		turret: toGeometry(three, data.single.turret),
		barrel: toGeometry(three, data.single.barrel),
	};
	const tankCapacity = state.tankCapacity * 2;
	const tankShadows = <T extends ThreeModule.Object3D>(object: T) => withShadows(object, M.trap);
	let poseTanks: () => void;
	if (options.mode === 'instanced') {
		const batches = ARMIES.map((_, army) => {
			const make = (geometry: ThreeModule.BufferGeometry) => {
				const batch = new three.InstancedMesh(geometry, paint[army], Math.ceil(tankCapacity / 2));
				batch.instanceMatrix.setUsage(three.DynamicDrawUsage);
				batch.frustumCulled = false;
				scene.add(tankShadows(batch));
				return batch;
			};
			return {
				hull: make(tankGeometry.hull),
				turret: make(tankGeometry.turret),
				barrel: make(tankGeometry.barrel),
			};
		});
		const [px, py, pz] = TANK_BARREL_PIVOT;
		poseTanks = () => {
			const tanks = activeTanks(state) * 2;
			for (let army = 0; army < 2; army++) {
				const { hull, turret, barrel } = batches[army] as (typeof batches)[number];
				const hm = hull.instanceMatrix.array as Float32Array;
				const tm = turret.instanceMatrix.array as Float32Array;
				const bm = barrel.instanceMatrix.array as Float32Array;
				let row = 0;
				for (let t = army; t < tanks; t += 2, row++) {
					const x = state.tankX[t] as number;
					const y = state.tankY[t] as number;
					const z = state.tankZ[t] as number;
					const heading = state.tankHeading[t] as number;
					const aim = heading + (state.tankTurret[t] as number);
					const along = pz + barrelRecoil(state, t);
					const c = Math.cos(aim);
					const s = Math.sin(aim);
					writeYawMatrix(hm, row * 16, heading, x, y, z);
					writeYawMatrix(tm, row * 16, aim, x, y + TANK_TURRET_HEIGHT, z);
					writeYawMatrix(
						bm,
						row * 16,
						aim,
						x + c * px + s * along,
						y + TANK_TURRET_HEIGHT + py,
						z - s * px + c * along,
					);
				}
				for (const batch of [hull, turret, barrel]) {
					batch.count = row;
					uploadCopies(batch, row);
				}
			}
		};
	} else {
		const hulls: ThreeModule.Mesh[] = [];
		const turrets: ThreeModule.Mesh[] = [];
		const barrels: ThreeModule.Mesh[] = [];
		for (let t = 0; t < tankCapacity; t++) {
			const hull = tankShadows(new three.Mesh(tankGeometry.hull, paint[t & 1]));
			const turret = tankShadows(new three.Mesh(tankGeometry.turret, paint[t & 1]));
			const barrel = tankShadows(new three.Mesh(tankGeometry.barrel, paint[t & 1]));
			turret.position.y = TANK_TURRET_HEIGHT;
			barrel.position.set(...TANK_BARREL_PIVOT);
			hull.add(turret);
			turret.add(barrel);
			scene.add(hull);
			hulls.push(hull);
			turrets.push(turret);
			barrels.push(barrel);
		}
		poseTanks = () => {
			const tanks = activeTanks(state) * 2;
			for (let t = 0; t < tankCapacity; t++) {
				const hull = hulls[t] as ThreeModule.Mesh;
				hull.visible = t < tanks;
				if (!hull.visible) continue;
				hull.position.set(
					state.tankX[t] as number,
					state.tankY[t] as number,
					state.tankZ[t] as number,
				);
				hull.rotation.y = state.tankHeading[t] as number;
				(turrets[t] as ThreeModule.Mesh).rotation.y = state.tankTurret[t] as number;
				(barrels[t] as ThreeModule.Mesh).position.z = TANK_BARREL_PIVOT[2] + barrelRecoil(state, t);
			}
		};
	}

	// Tracers and shells: the flights in use, packed to the front of their batches each frame.
	const flightBatch = (mesh: MeshData, spec: BattleMaterial) => {
		const batch = new three.InstancedMesh(toGeometry(three, mesh), material(spec), state.flights);
		batch.instanceMatrix.setUsage(three.DynamicDrawUsage);
		batch.frustumCulled = false;
		batch.count = 0;
		scene.add(batch);
		return batch;
	};
	const tracers = flightBatch(data.single.tracer, M.tracer);
	const shells = flightBatch(data.single.shell, M.shell);
	const flightMatrix = new three.Matrix4();
	const flightPosition = new three.Vector3();
	const flightQuaternion = new three.Quaternion();
	const unitScale = new three.Vector3(1, 1, 1);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const poseFlights = (batch: ThreeModule.InstancedMesh, kind: number) => {
		let row = 0;
		for (let f = 0; f < state.flights; f++) {
			if (state.flightActive[f] === 0 || state.flightKind[f] !== kind) continue;
			flightTransform(state, f, position, rotation);
			flightPosition.set(position[0] as number, position[1] as number, position[2] as number);
			flightQuaternion.set(
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			);
			flightMatrix.compose(flightPosition, flightQuaternion, unitScale);
			flightMatrix.toArray(batch.instanceMatrix.array, row * 16);
			row++;
		}
		batch.count = row;
		uploadCopies(batch, row);
	};

	// Particles.
	const pools = particleCapacity(state);
	const fireRows = createSpriteRows(pools.fire);
	const smokeRows = createSpriteRows(pools.smoke);
	const [fire, smoke] = await Promise.all([
		threeSprites(three, renderer, {
			capacity: pools.fire,
			blending: 'additive',
			atlas: fireAtlas(),
			fog: false,
		}),
		threeSprites(three, renderer, {
			capacity: pools.smoke,
			blending: 'normal',
			atlas: smokeAtlas(),
			fog: true,
		}),
	]);
	scene.add(smoke.object, fire.object);

	// The fire lights: the blasts' pool and the wrecks.
	const lights = Array.from({ length: LIGHT_COUNT }, (_, k) => {
		const spec = k < LIGHT_COUNT - WRECKS.length ? FIRE_LIGHT : WRECK_LIGHT;
		const light = new three.PointLight(spec.color, 0, spec.range, spec.decay);
		scene.add(light);
		return light;
	});
	const lightValues = new Float32Array(LIGHT_COUNT * 4);

	const setCount = (count: number) => {
		setActiveUnits(state, Math.min(capacity, count));
		units.show(state.active);
	};
	setCount(options.count);

	const camera = new three.PerspectiveCamera(
		look.camera.fov,
		16 / 9,
		look.camera.near,
		look.camera.far,
	);
	const cameraPosition = new Float64Array(3);
	const cameraTarget = new Float64Array(3);

	return {
		scene,
		camera,
		look: {
			exposure: look.exposure,
			environmentIntensity: look.environmentIntensity,
			sky: look.sky,
			sun: look.sun,
			fog: look.fog,
			bloom: look.bloom,
			ao: look.ao,
			grade: gradeTable(look.grade),
		},
		setCount,
		step: () => stepBattle(state),
		pose(seconds) {
			units.pose();
			poseTanks();
			poseFlights(tracers, 0);
			poseFlights(shells, 1);
			writeParticles(state, seconds, fireRows, smokeRows);
			fire.draw(fireRows);
			smoke.draw(smokeRows);
			writeLights(state, seconds, lightValues);
			for (let k = 0; k < LIGHT_COUNT; k++) {
				const light = lights[k] as ThreeModule.PointLight;
				light.position.set(
					lightValues[k * 4] as number,
					lightValues[k * 4 + 1] as number,
					lightValues[k * 4 + 2] as number,
				);
				light.intensity = lightValues[k * 4 + 3] as number;
			}
			shaders.setTime(seconds);
			sampleCameraLoop(BATTLE_CAMERA, seconds, cameraPosition, cameraTarget);
			camera.position.set(
				cameraPosition[0] as number,
				cameraPosition[1] as number,
				cameraPosition[2] as number,
			);
			camera.lookAt(
				cameraTarget[0] as number,
				cameraTarget[1] as number,
				cameraTarget[2] as number,
			);
		},
	};
});
