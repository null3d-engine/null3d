// Factory, the null3D half. It builds the scene one of two ways, which the page's mode picks:
//
// - The scene graph, the default. Each cell's arm is a tree of scene objects: the base stands still,
//   and the turntable, the upper arm, the forearm, the wrist and the two fingers each turn or slide
//   under their parent. The sketch writes only each joint's local value, and the engine works out
//   the world transforms of the whole tree on its job workers. The joints that turn in most frames
//   are dynamic objects. The fingers, which close only at a grip, and the crates are static ones,
//   which the engine recomputes only in a frame that moves them. The belt, the pallet, the floor
//   line, the lamp and the crates hang under the base. A held crate follows the wrist: after the
//   engine moves the trees, the sketch reads the wrist's world transform and places the crate in the
//   same frame. Reparenting the crate at each grip would rebuild the draw tables. The scene holds
//   only the cells that show: it makes cells as the count rises, and destroys them as it falls.
// - Instanced. Each part kind is one instance batch, as three.js's InstancedMesh half has. The
//   closed-form loop that three.js's half runs writes every moving row, and each batch's active
//   count shows the cells in use.
//
// Every effect is null3D's own technique for the look that the scene describes: spot light shadows
// in the shared shadow atlas, height fog, the mip-chain bloom, ambient occlusion, the AgX curve and
// a grading table, under the built-in room environment. The page's address picks the mode, the
// effects, the most cells and the cells that move; the page's `count` message changes the cells
// that move.
import {
	defineSketch,
	type InstanceBatch,
	type Material,
	type Mesh,
	type MeshGeometry,
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
import { type FactoryRows, poseFactoryRows } from './pose';
import {
	ARM_PARENT,
	ARM_PART,
	ArmState,
	armPartLocal,
	beltOffset,
	CRATE_IN_WRIST,
	CRATES_PER_CELL,
	CrateState,
	crateTransform,
	createFactory,
	FACTORY_CAMERA,
	FACTORY_HOLD,
	FACTORY_LOOK,
	FACTORY_MATERIALS,
	FACTORY_SEED,
	type FactoryMesh,
	factoryCells,
	factoryMeshes,
	GRIP_POINT,
	JOINTS,
	lampIntensity,
	SPARK_COUNT,
	SPOT_POSITIONS,
	STILL_PART,
	SURFACE_SIZE,
	setActiveCells,
	sparkPosition,
	stepFactory,
	stillPartLocal,
} from './scene';

/** The cells that each frame makes or destroys, within the engine's queue of changes. */
const CELLS_PER_FRAME = 250;

/** The page's message that sets the moving parts to draw. */
export const COUNT_MESSAGE = 'count';

/** The meshes of an arm's tree, parent first, as ARM_PART numbers them. */
const ARM_MESHES: readonly FactoryMesh[] = [
	'base',
	'turntable',
	'upperArm',
	'forearm',
	'wrist',
	'finger',
	'finger',
];
/** Arm parts below the base: the scene-graph mode keeps six objects per cell for them. */
const ARM_CHILDREN = ARM_MESHES.length - 1;
/** The still parts that hang under each base, with their places in the shared description. */
const STILL_MESHES = [
	['belt', STILL_PART.belt],
	['pallet', STILL_PART.pallet],
	['line', STILL_PART.line],
	['lamp', STILL_PART.lamp],
] as const;

/** One way of building the cells: it shows a count of cells and poses them each frame. */
interface Cells {
	/** Shows the first `cells` cells. */
	show(cells: number): void;
	/** Writes what moved, before the engine updates the scene. */
	pose(): void;
	/** Writes what follows the engine's world transforms, after it updates the scene. */
	late?(): void;
}

export default defineSketch(
	async ({ scene, geometry, materials, textures, assets, post, quality, page }) => {
		const params = new URL(import.meta.url).searchParams;
		const capacity = factoryCells(Number(params.get('capacity') ?? FACTORY_HOLD.count));
		const effects = effectsFromText(params.get('effects'));
		const mode = modeFromText(params.get('mode'));
		const state = createFactory(capacity);
		const startCells = Math.min(
			capacity,
			factoryCells(Number(params.get('count') ?? capacity * 10)),
		);
		setActiveCells(state, startCells);

		// The comparison's fixed settings: no governor, every pixel drawn, and ambient occlusion at
		// half the render size in each direction, as the three.js half draws it.
		const look = FACTORY_LOOK;
		quality.set({
			governor: false,
			minRenderScale: 1,
			maxRenderScale: 1,
			aoScale: effects.ao ? look.ao.scale : 0,
		});
		post.set({
			toneMapping: look.toneMapping,
			exposure: look.exposure,
			bloom: effects.bloom && {
				...look.bloomChain,
				threshold: look.bloom.threshold,
				blend: 'add',
			},
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
		scene.setBackground(look.background);
		if (effects.fog) scene.setFog({ curve: 'exponential', ...look.fog });
		scene.setEnvironment(await assets.builtinEnvironment('room'), {
			intensity: look.environmentIntensity,
		});
		scene.createAmbientLight(look.ambient);
		const { spot } = look;
		for (const [x, y, z] of SPOT_POSITIONS) {
			scene.createSpotLight({
				position: [x, y - 0.05, z],
				target: [x, 0, z],
				color: spot.color,
				intensity: spot.intensity,
				angle: spot.angle,
				penumbra: spot.penumbra,
				range: spot.range,
				decay: spot.decay,
				castShadows: effects.shadows,
				shadow: { bias: spot.bias, normalBias: spot.normalBias },
			});
		}

		// Meshes and surfaces, from the shared description.
		const data = factoryMeshes(capacity);
		const toMesh = (mesh: MeshData) =>
			geometry.fromArrays({
				positions: mesh.position,
				normals: mesh.normal,
				uvs: mesh.uv,
				indices: mesh.index,
			});
		const maps = new Map<SurfaceKind, { color: Texture; orm: Texture; normal: Texture }>();
		const surface = (kind: SurfaceKind) => {
			let made = maps.get(kind);
			if (!made) {
				const texels = surfaceMaps(kind, SURFACE_SIZE, FACTORY_SEED);
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
		const material = (name: FactoryMesh): Material<StandardValues> => {
			const spec = FACTORY_MATERIALS[name];
			if (spec.surface) {
				const { color, orm, normal } = surface(spec.surface);
				const repeat = spec.repeat ?? 1;
				return materials.standard({
					color: spec.color,
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
				color: spec.color,
				roughness: spec.roughness,
				metalness: spec.metalness,
				emissive: spec.emissive,
				emissiveIntensity: spec.emissiveIntensity,
			});
		};
		const parts = Object.keys(data) as FactoryMesh[];
		const kit = new Map<FactoryMesh, { mesh: MeshGeometry; material: Material<StandardValues> }>(
			parts.map((name) => [name, { mesh: toMesh(data[name]), material: material(name) }]),
		);
		const part = (name: FactoryMesh) =>
			kit.get(name) as { mesh: MeshGeometry; material: Material<StandardValues> };
		const shadows = (name: FactoryMesh) => ({
			castShadows: effects.shadows && FACTORY_MATERIALS[name].noShadow !== true,
			receiveShadows: effects.shadows,
		});

		// The hall: the floor, and a housing with a glowing lens over each spot light.
		scene.createMesh({ ...part('floor'), ...shadows('floor') });
		for (const [x, y, z] of SPOT_POSITIONS) {
			scene.createMesh({ ...part('housing'), position: [x, y, z] });
			scene.createMesh({ ...part('lens'), position: [x, y - 0.01, z] });
		}

		const position = new Float64Array(3);
		const rotation = new Float64Array(4);

		/** The scene-graph mode: a tree of objects per cell, made and destroyed with the count. */
		const sceneGraph = (): Cells => {
			// Each part kind keeps its objects in one array, cell by cell.
			const bases: Mesh[] = [];
			const arms: Mesh[] = [];
			const stills: Mesh[] = [];
			const crates: Mesh[] = [];
			// The values last written let joints and crates that did not change write nothing.
			const written = new Float32Array(capacity * JOINTS);
			const crateWritten = new Int8Array(capacity * CRATES_PER_CELL);
			const crateAt = new Float32Array(capacity * CRATES_PER_CELL);
			const wristPosition = new Float64Array(3);
			const wristRotation = new Float64Array(4);
			const held = new Float64Array(4);
			let cells = startCells;

			const createCell = (c: number) => {
				// A new cell's objects start at its joints' values, and its crates wait for their first write.
				written.set(state.joints.subarray(c * JOINTS, (c + 1) * JOINTS), c * JOINTS);
				crateWritten.fill(-1, c * CRATES_PER_CELL, (c + 1) * CRATES_PER_CELL);
				crateAt.fill(Number.NaN, c * CRATES_PER_CELL, (c + 1) * CRATES_PER_CELL);
				const tree: Mesh[] = [];
				for (let p = 0; p < ARM_MESHES.length; p++) {
					const name = ARM_MESHES[p] as FactoryMesh;
					armPartLocal(state, c, p, position, rotation);
					tree.push(
						scene.createMesh({
							...part(name),
							...shadows(name),
							parent: p === 0 ? null : (tree[ARM_PARENT[p] as number] as Mesh),
							position: [position[0] as number, position[1] as number, position[2] as number],
							rotation: [
								rotation[0] as number,
								rotation[1] as number,
								rotation[2] as number,
								rotation[3] as number,
							],
							dynamic: p > 0 && p <= ARM_PART.wrist,
						}),
					);
				}
				const base = tree[0] as Mesh;
				bases.push(base);
				arms.push(...tree.slice(1));
				for (const [name, kind] of STILL_MESHES) {
					stillPartLocal(kind, position);
					stills.push(
						scene.createMesh({
							...part(name),
							...shadows(name),
							parent: base,
							position: [position[0] as number, position[1] as number, position[2] as number],
						}),
					);
				}
				for (let k = 0; k < CRATES_PER_CELL; k++)
					crates.push(scene.createMesh({ ...part('crate'), ...shadows('crate'), parent: base }));
			};
			const destroyLast = (array: Mesh[], count: number) => {
				for (let i = array.length - count; i < array.length; i++) (array[i] as Mesh).destroy();
				array.length -= count;
			};
			// The engine queues at most 65,536 changes of the scene's structure between two frames, and
			// each cell makes about 70. So each frame makes or destroys a share of the cells until the
			// scene holds the cells that show.
			const fit = () => {
				let made = bases.length;
				if (made < cells) {
					const until = Math.min(cells, made + CELLS_PER_FRAME);
					while (made < until) createCell(made++);
				} else if (made > cells) {
					const drop = Math.min(made - cells, CELLS_PER_FRAME);
					destroyLast(crates, drop * CRATES_PER_CELL);
					destroyLast(stills, drop * STILL_MESHES.length);
					destroyLast(arms, drop * ARM_CHILDREN);
					destroyLast(bases, drop);
				}
			};

			const writeArm = (c: number) => {
				const j = c * JOINTS;
				const at = c * ARM_CHILDREN;
				for (let p = ARM_PART.turntable; p <= ARM_PART.wrist; p++) {
					const value = state.joints[j + p - 1] as number;
					if (written[j + p - 1] === value) continue;
					written[j + p - 1] = value;
					armPartLocal(state, c, p, position, rotation);
					(arms[at + p - 1] as Mesh).setRotation(
						rotation[0] as number,
						rotation[1] as number,
						rotation[2] as number,
						rotation[3] as number,
					);
				}
				const grip = state.joints[j + 4] as number;
				if (written[j + 4] !== grip) {
					written[j + 4] = grip;
					for (const p of [ARM_PART.fingerLeft, ARM_PART.fingerRight]) {
						armPartLocal(state, c, p, position, rotation);
						(arms[at + p - 1] as Mesh).setPosition(
							position[0] as number,
							position[1] as number,
							position[2] as number,
						);
					}
				}
			};

			const writeCrates = (c: number) => {
				const ox = state.origin[c * 2] as number;
				const oz = state.origin[c * 2 + 1] as number;
				for (let k = 0; k < CRATES_PER_CELL; k++) {
					const i = c * CRATES_PER_CELL + k;
					const now = state.crateState[i] as number;
					// A held crate waits for the wrist. A placed crate, and a crate that waits on its belt,
					// stand still.
					if (now === CrateState.held) continue;
					const at = now === CrateState.belt ? (state.crateDistance[i] as number) : 0;
					if (crateWritten[i] === now && crateAt[i] === at) continue;
					crateWritten[i] = now;
					crateAt[i] = at;
					crateTransform(state, c, k, position, rotation);
					const crate = crates[i] as Mesh;
					crate.setPosition(
						(position[0] as number) - ox,
						position[1] as number,
						(position[2] as number) - oz,
					);
					crate.setRotation(
						rotation[0] as number,
						rotation[1] as number,
						rotation[2] as number,
						rotation[3] as number,
					);
				}
			};

			fit();
			return {
				show(next) {
					cells = next;
				},
				pose() {
					fit();
					const shown = Math.min(cells, bases.length);
					for (let c = 0; c < shown; c++) {
						writeArm(c);
						writeCrates(c);
					}
				},
				late() {
					// A held crate takes the wrist's world turn and sits at the grip point.
					const shown = Math.min(cells, bases.length);
					for (let c = 0; c < shown; c++) {
						const s = state.armState[c] as number;
						if (s < ArmState.lift || s > ArmState.release) continue;
						const i = c * CRATES_PER_CELL + (state.nextCrate[c] as number);
						if (state.crateState[i] !== CrateState.held) continue;
						crateWritten[i] = CrateState.held;
						const wrist = arms[c * ARM_CHILDREN + ARM_PART.wrist - 1] as Mesh;
						wrist.getWorldPosition(wristPosition);
						wrist.getWorldQuaternion(wristRotation);
						quat.multiply(held, wristRotation, CRATE_IN_WRIST);
						const qx = wristRotation[0] as number;
						const qy = wristRotation[1] as number;
						const qz = wristRotation[2] as number;
						const qw = wristRotation[3] as number;
						// The grip point, GRIP_POINT along the wrist's +Y, turned into the world.
						const x = 2 * (qx * qy - qw * qz) * GRIP_POINT;
						const y = (1 - 2 * (qx * qx + qz * qz)) * GRIP_POINT;
						const z = 2 * (qy * qz + qw * qx) * GRIP_POINT;
						const crate = crates[i] as Mesh;
						crate.setPosition(
							(wristPosition[0] as number) + x - (state.origin[c * 2] as number),
							(wristPosition[1] as number) + y,
							(wristPosition[2] as number) + z - (state.origin[c * 2 + 1] as number),
						);
						crate.setRotation(
							held[0] as number,
							held[1] as number,
							held[2] as number,
							held[3] as number,
						);
					}
				},
			};
		};

		/** The instanced mode: a batch per part kind, with a row per cell's part. */
		const instanced = (): Cells => {
			const batch = (name: FactoryMesh, perCell: number, dynamic: boolean) => {
				const made = scene.createInstances(part(name).mesh, capacity * perCell, {
					material: part(name).material,
					dynamic,
				});
				batches.push({ batch: made, perCell });
				return made;
			};
			const batches: { batch: InstanceBatch; perCell: number }[] = [];
			// The still parts' rows, written once for every cell.
			const base = batch('base', 1, false);
			for (let c = 0; c < capacity; c++) {
				base.positions[c * 3] = state.origin[c * 2] as number;
				base.positions[c * 3 + 2] = state.origin[c * 2 + 1] as number;
			}
			for (const [name, kind] of STILL_MESHES) {
				const p = batch(name, 1, false).positions;
				stillPartLocal(kind, position);
				for (let c = 0; c < capacity; c++) {
					p[c * 3] = (state.origin[c * 2] as number) + (position[0] as number);
					p[c * 3 + 1] = position[1] as number;
					p[c * 3 + 2] = (state.origin[c * 2 + 1] as number) + (position[2] as number);
				}
			}
			const moving: Record<keyof FactoryRows, InstanceBatch> = {
				turntable: batch('turntable', 1, true),
				upperArm: batch('upperArm', 1, true),
				forearm: batch('forearm', 1, true),
				wrist: batch('wrist', 1, true),
				finger: batch('finger', 2, true),
				crate: batch('crate', CRATES_PER_CELL, true),
			};
			const names = Object.keys(moving) as (keyof FactoryRows)[];
			// The row arrays, read from each batch in every frame, as the engine's memory can grow.
			const rows = Object.fromEntries(
				names.map((name) => [
					name,
					{ positions: new Float32Array(0), rotations: new Float32Array(0) },
				]),
			) as unknown as FactoryRows;
			let cells = startCells;
			const show = (next: number) => {
				cells = next;
				for (const { batch, perCell } of batches) batch.setActiveCount(cells * perCell);
			};
			show(cells);
			return {
				show,
				pose() {
					for (const name of names) {
						rows[name].positions = moving[name].positions;
						rows[name].rotations = moving[name].rotations;
					}
					poseFactoryRows(state, cells, rows);
				},
			};
		};

		const cells = mode === 'instanced' ? instanced() : sceneGraph();
		const sparks = scene.createInstances(part('spark').mesh, SPARK_COUNT, {
			material: part('spark').material,
			dynamic: true,
		});

		const camera = scene.createPerspectiveCamera(look.camera);
		scene.setActiveCamera(camera);

		page.onMessage((type, value) => {
			if (type !== COUNT_MESSAGE) return;
			const next = Math.min(capacity, factoryCells(value as number));
			setActiveCells(state, next);
			cells.show(next);
		});

		const spark = new Float64Array(3);
		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const cameraRotation = quat.create();
		const lamp = part('lamp').material;
		const belt = part('belt').material;
		const lampSet = { emissiveIntensity: 0 };
		const beltSet = { uvTransform: { offset: [0, 0] as [number, number] } };
		let steps = 0;

		const writeSparks = (seconds: number) => {
			const positions = sparks.positions;
			const scales = sparks.scales;
			for (let k = 0; k < SPARK_COUNT; k++) {
				const flies = sparkPosition(state, k, seconds, spark);
				positions[k * 3] = spark[0] as number;
				positions[k * 3 + 1] = spark[1] as number;
				positions[k * 3 + 2] = spark[2] as number;
				const size = flies ? 1 : 0;
				scales[k * 3] = size;
				scales[k * 3 + 1] = size;
				scales[k * 3 + 2] = size;
			}
		};

		const pose = () => {
			const seconds = steps * SIM_STEP;
			cells.pose();
			writeSparks(seconds);
			lampSet.emissiveIntensity = lampIntensity(seconds);
			lamp.set(lampSet);
			beltSet.uvTransform.offset[0] = -beltOffset(seconds);
			belt.set(beltSet);
			sampleCameraLoop(FACTORY_CAMERA, seconds, cameraPosition, cameraTarget);
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
				stepFactory(state);
				steps++;
			},
			onUpdate: pose,
			onLateUpdate: cells.late,
		};
	},
	{ fixedRate: 1 / SIM_STEP, maxFixedSteps: 8 },
);
