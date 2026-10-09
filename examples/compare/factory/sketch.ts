// Factory, the null3D half. Each cell's arm is a tree of scene objects: the base stands still, and
// the turntable, the upper arm, the forearm, the wrist and the two fingers each turn or slide under
// their parent. The sketch writes only each joint's local value, and the engine works out the world
// transforms of the whole tree on its job workers. The belt, the pallet, the floor line, the lamp
// and the crates hang under the base too, so one call hides a whole cell. A held crate follows the
// wrist: after the engine moves the trees, the sketch reads the wrist's world transform and places
// the crate in the same frame. Reparenting the crate at each grip would rebuild the draw tables.
//
// Every effect is null3D's own technique for the look that the scene describes: spot light shadows
// in the shared shadow atlas, height fog, the mip-chain bloom, ambient occlusion, the AgX curve and
// a grading table, under the built-in room environment. The page's address picks the effects, the
// cells to make and the cells that move; the page's `count` message changes the cells that move.
import {
	defineSketch,
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
	SIM_STEP,
	type SurfaceKind,
	sampleCameraLoop,
	surfaceMaps,
} from '../../lib/compare-scene';
import {
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
	MOVING_PER_CELL,
	SPARK_COUNT,
	SPOT_POSITIONS,
	STILL_PART,
	SURFACE_SIZE,
	setActiveCells,
	sparkPosition,
	stepFactory,
	stillPartLocal,
} from './scene';

/** The cells that the setup and each frame after it make, within the engine's queue of changes. */
const CELLS_PER_FRAME = 250;

/** The page's message that sets the moving parts to draw. */
export const COUNT_MESSAGE = 'count';

export default defineSketch(
	async ({ scene, geometry, materials, textures, assets, post, quality, page }) => {
		const params = new URL(import.meta.url).searchParams;
		const capacity = factoryCells(Number(params.get('capacity') ?? FACTORY_HOLD.count));
		const effects = effectsFromText(params.get('effects'));
		const state = createFactory(capacity);
		let cells = Math.min(capacity, factoryCells(Number(params.get('count') ?? capacity * 10)));
		setActiveCells(state, cells);

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
				intensity: look.bloom.strength,
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

		// The cells. Each part kind keeps its objects in one array, cell by cell.
		const position = new Float64Array(3);
		const rotation = new Float64Array(4);
		const bases: Mesh[] = [];
		const arms: Mesh[] = [];
		const crates: Mesh[] = [];
		const ARM_MESHES: FactoryMesh[] = [
			'base',
			'turntable',
			'upperArm',
			'forearm',
			'wrist',
			'finger',
			'finger',
		];
		const createCell = (c: number) => {
			const tree: Mesh[] = [];
			for (let p = 0; p < ARM_MESHES.length; p++) {
				const name = ARM_MESHES[p] as FactoryMesh;
				armPartLocal(state, c, p, position, rotation);
				const parent = p === 0 ? null : (tree[p === 6 ? 4 : p - 1] as Mesh);
				const node = scene.createMesh({
					...part(name),
					...shadows(name),
					parent,
					position: [position[0] as number, position[1] as number, position[2] as number],
					rotation: [
						rotation[0] as number,
						rotation[1] as number,
						rotation[2] as number,
						rotation[3] as number,
					],
					dynamic: p > 0,
				});
				tree.push(node);
			}
			const base = tree[0] as Mesh;
			bases.push(base);
			arms.push(...tree.slice(1));
			for (const [name, kind] of [
				['belt', STILL_PART.belt],
				['pallet', STILL_PART.pallet],
				['line', STILL_PART.line],
				['lamp', STILL_PART.lamp],
			] as const) {
				stillPartLocal(kind, position);
				scene.createMesh({
					...part(name),
					...shadows(name),
					parent: base,
					position: [position[0] as number, position[1] as number, position[2] as number],
				});
			}
			for (let k = 0; k < CRATES_PER_CELL; k++)
				crates.push(
					scene.createMesh({ ...part('crate'), ...shadows('crate'), parent: base, dynamic: true }),
				);
			if (c >= cells) base.setVisible(false);
		};
		// The engine queues at most 65,536 changes of the scene's structure between two frames, and
		// each cell makes about 70. So the setup makes the first cells, and each frame after it makes
		// the next ones until every cell of the run is there.
		let created = 0;
		const createCells = () => {
			const until = Math.min(capacity, created + CELLS_PER_FRAME);
			while (created < until) createCell(created++);
		};
		createCells();
		const sparks = scene.createInstances(part('spark').mesh, SPARK_COUNT, {
			material: part('spark').material,
			dynamic: true,
		});

		const camera = scene.createPerspectiveCamera(look.camera);
		scene.setActiveCamera(camera);

		page.onMessage((type, value) => {
			if (type !== COUNT_MESSAGE) return;
			const next = Math.min(capacity, factoryCells(value as number));
			for (let c = Math.min(cells, next); c < Math.min(created, Math.max(cells, next)); c++)
				(bases[c] as Mesh).setVisible(c < next);
			cells = next;
			setActiveCells(state, cells);
		});

		// What each frame writes: joints that changed, crates on the move, then held crates after
		// the engine moved the trees. The values last written let unchanged joints write nothing.
		const written = new Float32Array(capacity * JOINTS).fill(Number.NaN);
		const crateWritten = new Int8Array(capacity * CRATES_PER_CELL).fill(-1);
		const wristPosition = new Float64Array(3);
		const wristRotation = new Float64Array(4);
		const held = new Float64Array(4);
		const spark = new Float64Array(3);
		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const cameraRotation = quat.create();
		const lamp = part('lamp').material;
		const belt = part('belt').material;
		const lampSet = { emissiveIntensity: 0 };
		const beltSet = { uvTransform: { offset: [0, 0] as [number, number] } };
		let steps = 0;

		const writeArm = (c: number) => {
			const j = c * JOINTS;
			const at = c * (MOVING_PER_CELL - CRATES_PER_CELL);
			for (let p = 1; p <= 4; p++) {
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
				// A placed crate stands still, and a held one waits for the wrist.
				if (now === CrateState.held || (now === CrateState.placed && crateWritten[i] === now))
					continue;
				crateWritten[i] = now;
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
			if (created < capacity) createCells();
			const seconds = steps * SIM_STEP;
			const shown = Math.min(cells, created);
			for (let c = 0; c < shown; c++) {
				writeArm(c);
				writeCrates(c);
			}
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
			onLateUpdate() {
				// A held crate takes the wrist's world turn and sits at the grip point.
				const shown = Math.min(cells, created);
				for (let c = 0; c < shown; c++) {
					const s = state.armState[c] as number;
					if (s < ArmState.lift || s > ArmState.release) continue;
					const i = c * CRATES_PER_CELL + (state.nextCrate[c] as number);
					if (state.crateState[i] !== CrateState.held) continue;
					crateWritten[i] = CrateState.held;
					const wrist = arms[c * (MOVING_PER_CELL - CRATES_PER_CELL) + 3] as Mesh;
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
	},
	{ fixedRate: 1 / SIM_STEP, maxFixedSteps: 8 },
);
