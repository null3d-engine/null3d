// Battle, the null3D half. Both armies' soldiers and mechs are copies of two models from files:
// each copy is a group with its skinned body and its rifle, and an animator that the engine runs on
// its job workers. The sketch writes each unit's place and turn, and starts a clip when the
// simulation changes it. The page's mode picks how the tanks are built:
//
// - The scene graph, the default: each tank is a tree of three objects, the hull, the turret on it
//   and the barrel on the turret. The sketch writes the hull's place and each joint's turn, and the
//   engine works out the world transforms on its job workers.
// - Instanced: each tank part is one instance batch, posed by the same closed-form loop as
//   three.js's InstancedMesh half.
//
// null3D has one way to draw animated characters, an object per character, which it draws in
// batches by itself, so both modes build the soldiers and mechs the same way. Tracers, shells and
// particles are batches in both modes, as games draw effects.
//
// The look is null3D's own technique for each part of the shared description: the generated sky
// and its environment light, a sun with cascaded shadows, height fog that glows toward the sun,
// the mip-chain bloom, ambient occlusion, the AgX curve and a grading table. Grass and flags sway
// in the wind, and the wrecks' embers glow, through custom materials. Smoke, fire, sparks and
// flashes are sprite batches.
import {
	type Animator,
	defineSketch,
	type InstanceBatch,
	type Material,
	type Mesh,
	type MeshGeometry,
	type PointLight,
	type PrefabInstance,
	quat,
	type StandardValues,
	type Texture,
} from '@null3d/engine';
import {
	effectsFromText,
	gradeTable,
	type MeshData,
	modeFromText,
	SIM_STEP,
	type SurfaceKind,
	sampleCameraLoop,
	surfaceMaps,
} from '../../lib/compare-scene';
import { createSpriteRows, fireAtlas, smokeAtlas } from '../../lib/particles';
import { null3dSprites } from '../../lib/particles-null3d';
import { sampleUrl } from '../../lib/samples';
import {
	ARMIES,
	activeTanks,
	BATTLE_CAMERA,
	BATTLE_HOLD,
	BATTLE_LOOK,
	BATTLE_MATERIALS,
	BATTLE_SEED,
	type BattleMaterial,
	barrelRecoil,
	battleMeshes,
	battleUnits,
	CLIP_FADE_SECONDS,
	CLIP_NAMES,
	Clip,
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

/** Units that each frame makes or destroys, within the engine's queue of changes. */
const UNITS_PER_FRAME = 400;

/** The page's message that sets the units to draw. */
export const COUNT_MESSAGE = 'count';

/** Grass bends at its tips, by a gust that runs across the field. */
const swayGrass = /* wgsl */ `
struct Uniforms { amount: f32, speed: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    let phase = dot(object.position.xz, vec2f(0.23, 0.17));
    let t = frame.time * material.speed;
    let gust = sin(t + phase) + 0.4 * sin(t * 2.3 + phase * 1.7);
    let bend = input.uv.y * input.uv.y * material.amount * gust;
    return vec3f(bend * 0.8, -abs(bend) * 0.25, bend * 0.6);
}
`;

/** A flag ripples from its pole outward, in waves that grow toward its free edge. */
const waveFlag = /* wgsl */ `
struct Uniforms { amount: f32, speed: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    let phase = dot(object.position.xz, vec2f(0.31, 0.19));
    let t = frame.time * material.speed + phase;
    let reach = input.uv.x;
    let ripple = sin(t - reach * 7.0) + 0.35 * sin(t * 1.9 - reach * 13.0 + input.uv.y * 3.0);
    return vec3f(0.0, -0.18 * reach * reach, ripple * material.amount * reach);
}
`;

/** Charred steel with embers that pulse in its cracks. */
const embers = /* wgsl */ `
struct Uniforms { ember: vec3f, glow: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition * 2.7;
    let a = sin(p.x * 1.7 + sin(p.z * 2.3)) * sin(p.z * 1.9 + sin(p.y * 2.9));
    let cracks = pow(1.0 - abs(a), 10.0);
    let pulse = 0.55 + 0.45 * sin(frame.time * 2.6 + p.x * 0.7 + p.z * 0.5);
    let low = clamp(1.4 - (input.worldPosition.y - object.position.y) * 0.6, 0.0, 1.0);
    s.emissive = material.ember * (material.glow * cracks * pulse * low);
    s.roughness = mix(s.roughness, 1.0, cracks);
    return s;
}
`;

/** A unit's copy: its group, its animator, and what the sketch last gave it. */
interface UnitObject {
	copy: PrefabInstance;
	animator: Animator;
	clip: number;
	life: number;
	x: number;
	z: number;
	heading: number;
}

/** The plays that the sketch repeats, in frozen options, so a clip switch allocates nothing. */
const DIE = Object.freeze({ fade: CLIP_FADE_SECONDS, loop: false });
/** Start times of a unit that joins again, in eighths of its run, so units do not step in time. */
const REJOIN = Array.from({ length: 8 }, (_, k) => Object.freeze({ time: k / 8 }));

export default defineSketch(
	async ({ scene, geometry, materials, textures, assets, post, quality, page }) => {
		const params = new URL(import.meta.url).searchParams;
		const capacity = battleUnits(Number(params.get('capacity') ?? BATTLE_HOLD.count));
		const effects = effectsFromText(params.get('effects'));
		const mode = modeFromText(params.get('mode'));
		const state = createBattle(capacity);
		setActiveUnits(state, Number(params.get('count') ?? capacity));

		// The comparison's fixed settings: no governor, every pixel drawn, and ambient occlusion at
		// half the render size in each direction, as the three.js half draws it.
		const look = BATTLE_LOOK;
		quality.set({
			governor: false,
			minRenderScale: 1,
			maxRenderScale: 1,
			aoScale: effects.ao ? look.ao.scale : 0,
		});
		post.set({
			toneMapping: look.toneMapping,
			exposure: look.exposure,
			bloom: effects.bloom && { ...look.bloomChain, threshold: look.bloom.threshold, blend: 'add' },
			ao: effects.ao && { radius: look.ao.radius, intensity: look.ao.intensity },
		});
		if (effects.grade) {
			const table = gradeTable(look.grade);
			const data = Float32Array.from(
				{ length: table.size ** 3 * 3 },
				(_, i) => (table.data[Math.floor(i / 3) * 4 + (i % 3)] as number) / 255,
			);
			post.set({ lut: await assets.lutFromData({ size: table.size, data }) });
		}
		scene.setBackground({ sky: look.sky }, { intensity: look.skyIntensity });
		scene.setEnvironment(await assets.skyEnvironment(), { intensity: look.environmentIntensity });
		if (effects.fog) scene.setFog({ curve: 'exponential', ...look.fog });
		const { sun } = look;
		scene.createDirectionalLight({
			direction: sun.direction,
			color: sun.color,
			intensity: sun.intensity,
			castShadows: effects.shadows,
			shadow: {
				cascades: sun.cascades,
				distance: sun.distance,
				mapSize: sun.mapSize,
				bias: sun.bias,
				normalBias: sun.normalBias,
			},
		});
		scene.createHemisphereLight({
			skyColor: look.hemisphere.sky,
			groundColor: look.hemisphere.ground,
			intensity: look.hemisphere.intensity,
		});
		const lights: PointLight[] = Array.from({ length: LIGHT_COUNT }, (_, k) => {
			const fire = k < LIGHT_COUNT - WRECKS.length ? FIRE_LIGHT : WRECK_LIGHT;
			return scene.createPointLight({
				color: fire.color,
				intensity: 0,
				range: fire.range,
				decay: fire.decay,
				dynamic: true,
			});
		});

		// Surfaces and meshes, from the shared description.
		const data = battleMeshes();
		const toMesh = (mesh: MeshData) =>
			geometry.fromArrays({
				positions: mesh.position,
				normals: mesh.normal,
				uvs: mesh.uv,
				indices: mesh.index,
				...(mesh.color ? { colors: mesh.color } : {}),
			});
		const maps = new Map<SurfaceKind, { color: Texture; orm: Texture; normal: Texture }>();
		const surface = (kind: SurfaceKind) => {
			let made = maps.get(kind);
			if (!made) {
				const texels = surfaceMaps(kind, SURFACE_SIZE, BATTLE_SEED);
				const upload = ({ size, data, colorSpace }: (typeof texels)['color']) =>
					textures.fromData({
						width: size,
						height: size,
						data,
						colorSpace,
						wrap: 'repeat',
						mipmaps: true,
						anisotropy: 8,
					});
				made = {
					color: upload(texels.color),
					orm: upload(texels.orm),
					normal: upload(texels.normal),
				};
				maps.set(kind, made);
			}
			return made;
		};
		const material = (spec: BattleMaterial): Material<StandardValues> => {
			const common = {
				color: spec.color,
				vertexColors: spec.vertexColors,
				doubleSided: spec.doubleSided,
			};
			if (spec.surface) {
				const { color, orm, normal } = surface(spec.surface);
				const repeat = spec.repeat ?? 1;
				return materials.standard({
					...common,
					// The maps alone set roughness and metalness, as glTF's factors of 1 do.
					roughness: 1,
					metalness: 1,
					map: color,
					metalnessRoughnessMap: orm,
					normalMap: normal,
					uvTransform: { repeat: [repeat, repeat] },
				});
			}
			return materials.standard({
				...common,
				roughness: spec.roughness,
				metalness: spec.metalness,
				emissive: spec.emissive,
				emissiveIntensity: spec.emissiveIntensity,
			});
		};
		const shadows = (spec: BattleMaterial) => ({
			castShadows: effects.shadows && spec.noShadow !== true,
			receiveShadows: effects.shadows,
		});
		const M = BATTLE_MATERIALS;

		// The ground: the detailed field and the land around it.
		const ground = material(M.ground);
		scene.createMesh({ mesh: toMesh(data.single.field), material: ground, ...shadows(M.ground) });
		scene.createMesh({
			mesh: toMesh(data.single.land),
			material: ground,
			receiveShadows: effects.shadows,
		});

		/** A still batch of placed copies of one mesh, written once. */
		const scatter = (
			mesh: MeshGeometry,
			list: readonly Placed[],
			made: Material,
			spec: BattleMaterial,
			lift = 0,
		) => {
			const batch = scene.createInstances(mesh, Math.max(1, list.length), {
				material: made,
				...shadows(spec),
			});
			const rotation = quat.create();
			list.forEach((p, i) => {
				batch.positions.set([p.x, p.y + lift * p.scale, p.z], i * 3);
				quat.fromEuler(rotation, 0, p.yaw, 0);
				batch.rotations.set(rotation, i * 4);
				batch.scales.set([p.scale, p.scale, p.scale], i * 3);
			});
			batch.setActiveCount(list.length);
			batch.markDirty();
			return batch;
		};
		const rock = material(M.rock);
		data.rocks.forEach((mesh, v) => {
			scatter(
				toMesh(mesh),
				ROCKS.filter((p) => p.variant === v),
				rock,
				M.rock,
				-0.1,
			);
		});
		const tree = material(M.tree);
		data.trees.forEach((mesh, v) => {
			scatter(
				toMesh(mesh),
				TREES.filter((p) => p.variant === v),
				tree,
				M.tree,
			);
		});
		scatter(toMesh(data.single.trap), TANK_TRAPS, material(M.trap), M.trap);
		const grass = materials.shader({
			wgsl: swayGrass,
			uniforms: WIND.grass,
			color: M.grass.color,
			roughness: M.grass.roughness,
			metalness: M.grass.metalness,
			doubleSided: true,
		});
		data.grass.forEach((mesh, v) => {
			scatter(
				toMesh(mesh),
				GRASS.filter((p) => p.variant === v),
				grass,
				M.grass,
			);
		});
		const wall = material(M.wall);
		RUINS.forEach((ruin, k) => {
			scene.createMesh({
				mesh: toMesh(data.walls[k] as MeshData),
				material: wall,
				position: [ruin.x, ruin.y - 0.2, ruin.z],
				rotation: quat.fromEuler(quat.create(), 0, ruin.yaw, 0),
				...shadows(M.wall),
			});
		});
		scene.createMesh({
			mesh: toMesh(data.single.tower),
			material: wall,
			position: [TOWER.x, TOWER.y - 0.3, TOWER.z],
			rotation: quat.fromEuler(quat.create(), 0, TOWER.yaw, 0),
			...shadows(M.wall),
		});
		const charred = materials.shader({
			wgsl: embers,
			uniforms: { ember: WRECK_LOOK.ember, glow: WRECK_LOOK.emberIntensity },
			color: WRECK_LOOK.color,
			roughness: WRECK_LOOK.roughness,
			metalness: WRECK_LOOK.metalness,
		});
		const wreckMesh = toMesh(data.single.wreck);
		for (const wreck of WRECKS) {
			const rotation = quat.fromEuler(quat.create(), 0, wreck.yaw, wreck.tilt);
			scene.createMesh({
				mesh: wreckMesh,
				material: charred,
				position: [wreck.x, wreck.y - 0.35, wreck.z],
				rotation,
				castShadows: effects.shadows,
				receiveShadows: effects.shadows,
			});
		}
		const pole = toMesh(data.single.pole);
		const poleMaterial = material(M.pole);
		const cloth = toMesh(data.single.flag);
		const flagMaterials = ARMIES.map((army) =>
			materials.shader({
				wgsl: waveFlag,
				uniforms: WIND.flag,
				color: army.flag,
				roughness: M.flag.roughness,
				metalness: M.flag.metalness,
				doubleSided: true,
			}),
		);
		for (const flag of FLAGS) {
			const rotation = quat.fromEuler(quat.create(), 0, flag.yaw, 0);
			scene.createMesh({
				mesh: pole,
				material: poleMaterial,
				position: [flag.x, flag.y, flag.z],
				...shadows(M.pole),
			});
			const banner = scene.createMesh({
				mesh: cloth,
				material: flagMaterials[flag.army] as Material,
				position: [flag.x, flag.y + FLAG_POLE_HEIGHT - 1.75, flag.z],
				rotation,
				...shadows(M.flag),
			});
			// The cloth swings out of its mesh's sphere, so it culls with a larger one.
			banner.setBounds([1.3, 0.8, 0], 2.4);
		}

		// The armies' soldiers and mechs, from the two model files.
		const [soldier, mech] = await Promise.all([
			assets.loadGltf(sampleUrl('sources/characters/battle-soldier/soldier.glb')),
			assets.loadGltf(sampleUrl('sources/characters/quaternius-mech/mech.glb')),
		]);
		const prefabs = { soldier, mech };
		// Each army tints the models' vertex colors with its own material.
		const uniforms = ARMIES.map((army) =>
			materials.standard({ color: army.tint, vertexColors: true, roughness: 0.8, metalness: 0 }),
		);
		const units: UnitObject[] = [];
		let shown = state.active;
		const rotation = quat.create();
		const makeUnit = (i: number) => {
			const name: ModelName = unitKindOf(i) === UnitKind.mech ? 'mech' : 'soldier';
			const facts = MODELS[name];
			const x = state.x[i] as number;
			const z = state.z[i] as number;
			const heading = state.heading[i] as number;
			const copy = scene.instantiate(prefabs[name], {
				position: [x, state.y[i] as number, z],
				rotation: quat.fromEuler(rotation, 0, heading, 0),
				scale: [facts.scale, facts.scale, facts.scale],
				dynamic: true,
				castShadows: effects.shadows,
				receiveShadows: effects.shadows,
			});
			(copy.find(facts.mesh) as Mesh).setMaterial(uniforms[i & 1] as Material);
			const animator = copy.animator();
			const clip = state.clip[i] as number;
			animator.play(CLIP_NAMES[clip], {
				time: state.clipTime[i] as number,
				loop: clip !== Clip.die,
			});
			units.push({ copy, animator, clip, life: state.deaths[i] as number, x, z, heading });
		};
		// The engine queues at most 65,536 changes of the scene's structure between two frames, so
		// each frame makes or destroys a share of the units until the scene holds those that show.
		const fit = () => {
			let made = units.length;
			if (made < shown) {
				const until = Math.min(shown, made + UNITS_PER_FRAME);
				while (made < until) makeUnit(made++);
			} else if (made > shown) {
				const until = Math.max(shown, made - UNITS_PER_FRAME);
				for (let i = until; i < made; i++) (units[i] as UnitObject).copy.destroy();
				units.length = until;
			}
		};
		const poseUnits = () => {
			const count = Math.min(units.length, state.active);
			for (let i = 0; i < count; i++) {
				const unit = units[i] as UnitObject;
				const x = state.x[i] as number;
				const z = state.z[i] as number;
				const heading = state.heading[i] as number;
				if (x !== unit.x || z !== unit.z) {
					unit.x = x;
					unit.z = z;
					unit.copy.setPosition(x, state.y[i] as number, z);
				}
				if (heading !== unit.heading) {
					unit.heading = heading;
					quat.fromEuler(rotation, 0, heading, 0);
					unit.copy.setRotation(
						rotation[0] as number,
						rotation[1] as number,
						rotation[2] as number,
						rotation[3] as number,
					);
				}
				const clip = state.clip[i] as number;
				const life = state.deaths[i] as number;
				if (life !== unit.life && clip !== Clip.die) {
					// A fallen unit joined its army again: it starts its run at once, at its own step.
					unit.animator.play(CLIP_NAMES[Clip.run], REJOIN[i % REJOIN.length]);
				} else if (clip === Clip.die && unit.clip !== Clip.die) {
					unit.animator.play(CLIP_NAMES[Clip.die], DIE);
				} else if (clip !== unit.clip) {
					unit.animator.crossFade(CLIP_NAMES[clip], CLIP_FADE_SECONDS);
				}
				unit.clip = clip;
				if (clip !== Clip.die) unit.life = life;
			}
		};
		fit();

		// Tanks: a tree of three objects each, or a batch per part.
		const armyPaint = ARMIES.map((army) =>
			material({ color: army.tank, surface: 'camo', repeat: 0.5 }),
		);
		const tankMeshes = {
			hull: toMesh(data.single.hull),
			turret: toMesh(data.single.turret),
			barrel: toMesh(data.single.barrel),
		};
		const tankCapacity = state.tankCapacity * 2;
		const position = new Float64Array(3);
		const turnQ = quat.create();
		/** Places the tanks in use: the tree's joints, or the batches' rows in closed form. */
		let poseTanks: () => void;
		if (mode === 'instanced') {
			const batches = ARMIES.map((_, army) => {
				const make = (mesh: MeshGeometry) =>
					scene.createInstances(mesh, Math.ceil(tankCapacity / 2), {
						material: armyPaint[army] as Material,
						dynamic: true,
						castShadows: effects.shadows,
						receiveShadows: effects.shadows,
					});
				return {
					hull: make(tankMeshes.hull),
					turret: make(tankMeshes.turret),
					barrel: make(tankMeshes.barrel),
				};
			});
			const [px, py, pz] = TANK_BARREL_PIVOT;
			poseTanks = () => {
				const tanks = activeTanks(state) * 2;
				for (let army = 0; army < 2; army++) {
					const { hull, turret, barrel } = batches[army] as (typeof batches)[number];
					const hp = hull.positions;
					const hr = hull.rotations;
					const tp = turret.positions;
					const tr = turret.rotations;
					const bp = barrel.positions;
					const br = barrel.rotations;
					let row = 0;
					for (let t = army; t < tanks; t += 2, row++) {
						const x = state.tankX[t] as number;
						const y = state.tankY[t] as number;
						const z = state.tankZ[t] as number;
						const heading = state.tankHeading[t] as number;
						const aim = heading + (state.tankTurret[t] as number);
						const recoil = barrelRecoil(state, t);
						const c = Math.cos(aim);
						const s = Math.sin(aim);
						hp[row * 3] = x;
						hp[row * 3 + 1] = y;
						hp[row * 3 + 2] = z;
						writeYaw(hr, row, heading);
						tp[row * 3] = x;
						tp[row * 3 + 1] = y + TANK_TURRET_HEIGHT;
						tp[row * 3 + 2] = z;
						writeYaw(tr, row, aim);
						const along = pz + recoil;
						bp[row * 3] = x + c * px + s * along;
						bp[row * 3 + 1] = y + TANK_TURRET_HEIGHT + py;
						bp[row * 3 + 2] = z - s * px + c * along;
						writeYaw(br, row, aim);
					}
					hull.setActiveCount(row);
					turret.setActiveCount(row);
					barrel.setActiveCount(row);
				}
			};
		} else {
			const hulls: Mesh[] = [];
			const turrets: Mesh[] = [];
			const barrels: Mesh[] = [];
			for (let t = 0; t < tankCapacity; t++) {
				const paint = armyPaint[t & 1] as Material;
				const hull = scene.createMesh({
					mesh: tankMeshes.hull,
					material: paint,
					dynamic: true,
					...shadows(M.trap),
				});
				const turret = scene.createMesh({
					mesh: tankMeshes.turret,
					material: paint,
					parent: hull,
					position: [0, TANK_TURRET_HEIGHT, 0],
					dynamic: true,
					...shadows(M.trap),
				});
				const barrel = scene.createMesh({
					mesh: tankMeshes.barrel,
					material: paint,
					parent: turret,
					position: [...TANK_BARREL_PIVOT],
					dynamic: true,
					...shadows(M.trap),
				});
				hulls.push(hull);
				turrets.push(turret);
				barrels.push(barrel);
			}
			poseTanks = () => {
				const tanks = activeTanks(state) * 2;
				for (let t = 0; t < tankCapacity; t++) {
					const hull = hulls[t] as Mesh;
					const inUse = t < tanks;
					hull.setVisible(inUse);
					if (!inUse) continue;
					hull.setPosition(
						state.tankX[t] as number,
						state.tankY[t] as number,
						state.tankZ[t] as number,
					);
					quat.fromEuler(turnQ, 0, state.tankHeading[t] as number, 0);
					hull.setRotation(
						turnQ[0] as number,
						turnQ[1] as number,
						turnQ[2] as number,
						turnQ[3] as number,
					);
					quat.fromEuler(turnQ, 0, state.tankTurret[t] as number, 0);
					(turrets[t] as Mesh).setRotation(
						turnQ[0] as number,
						turnQ[1] as number,
						turnQ[2] as number,
						turnQ[3] as number,
					);
					(barrels[t] as Mesh).setPosition(
						TANK_BARREL_PIVOT[0],
						TANK_BARREL_PIVOT[1],
						TANK_BARREL_PIVOT[2] + barrelRecoil(state, t),
					);
				}
			};
		}

		// Tracers and shells: the flights in use, packed to the front of their batches each frame.
		const flightBatch = (mesh: MeshData, spec: BattleMaterial) =>
			scene.createInstances(toMesh(mesh), state.flights, {
				material: material(spec),
				dynamic: true,
				castShadows: false,
				receiveShadows: false,
			});
		const tracers = flightBatch(data.single.tracer, M.tracer);
		const shells = flightBatch(data.single.shell, M.shell);
		const flightRotation = new Float64Array(4);
		const poseFlights = (batch: InstanceBatch, kind: number) => {
			const positions = batch.positions;
			const rotations = batch.rotations;
			let row = 0;
			for (let f = 0; f < state.flights; f++) {
				if (state.flightActive[f] === 0 || state.flightKind[f] !== kind) continue;
				flightTransform(state, f, position, flightRotation);
				positions[row * 3] = position[0] as number;
				positions[row * 3 + 1] = position[1] as number;
				positions[row * 3 + 2] = position[2] as number;
				rotations[row * 4] = flightRotation[0] as number;
				rotations[row * 4 + 1] = flightRotation[1] as number;
				rotations[row * 4 + 2] = flightRotation[2] as number;
				rotations[row * 4 + 3] = flightRotation[3] as number;
				row++;
			}
			batch.setActiveCount(row);
		};

		// Particles: fire, sparks and flashes added as light; smoke and dust blended.
		const pools = particleCapacity(state);
		const fireRows = createSpriteRows(pools.fire);
		const smokeRows = createSpriteRows(pools.smoke);
		const [fire, smoke] = await Promise.all([
			null3dSprites(
				{ scene, textures },
				{ capacity: pools.fire, blending: 'additive', atlas: fireAtlas(), fog: false },
			),
			null3dSprites(
				{ scene, textures },
				{ capacity: pools.smoke, blending: 'normal', atlas: smokeAtlas(), fog: true },
			),
		]);
		const lightValues = new Float32Array(LIGHT_COUNT * 4);

		const camera = scene.createPerspectiveCamera(look.camera);
		scene.setActiveCamera(camera);

		page.onMessage((type, value) => {
			if (type !== COUNT_MESSAGE) return;
			setActiveUnits(state, Math.min(capacity, value as number));
			shown = state.active;
		});

		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const cameraRotation = quat.create();
		let steps = 0;

		const pose = () => {
			const seconds = steps * SIM_STEP;
			fit();
			poseUnits();
			poseTanks();
			poseFlights(tracers, 0);
			poseFlights(shells, 1);
			writeParticles(state, seconds, fireRows, smokeRows);
			fire.draw(fireRows);
			smoke.draw(smokeRows);
			writeLights(state, seconds, lightValues);
			for (let k = 0; k < LIGHT_COUNT; k++) {
				const light = lights[k] as PointLight;
				light.setPosition(
					lightValues[k * 4] as number,
					lightValues[k * 4 + 1] as number,
					lightValues[k * 4 + 2] as number,
				);
				light.setIntensity(lightValues[k * 4 + 3] as number);
			}
			sampleCameraLoop(BATTLE_CAMERA, seconds, cameraPosition, cameraTarget);
			quat.lookAt(cameraRotation, cameraTarget, cameraPosition);
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
				stepBattle(state);
				steps++;
			},
			onUpdate: pose,
		};
	},
	{ fixedRate: 1 / SIM_STEP, maxFixedSteps: 8 },
);

/** Writes a turn about +Y into row `row` of a rotations array. */
function writeYaw(rotations: Float32Array, row: number, angle: number): void {
	rotations[row * 4] = 0;
	rotations[row * 4 + 1] = Math.sin(angle / 2);
	rotations[row * 4 + 2] = 0;
	rotations[row * 4 + 3] = Math.cos(angle / 2);
}
