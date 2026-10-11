// Factory, the three.js half, which runs in its worker. It builds the scene one of two ways, which
// the page's mode picks:
//
// - The scene graph, the default. Each cell's arm is a tree of Object3D nodes, one Mesh per part,
//   as three.js's own examples build jointed models: the base stands on the hall, and each joint
//   turns or slides under its parent. Every node keeps its local matrix until a write changes it
//   (matrixAutoUpdate off, then updateMatrix), the method three.js's docs advise for objects that
//   do not move in every frame, and the renderer's walk of the graph works out the world matrices.
//   A crate hangs under its cell's base, and under the wrist while the arm holds it: reparenting is
//   cheap in three.js. The scene holds only the cells that show.
// - Instanced: each part kind is one InstancedMesh, the batch of copies that three.js's docs advise
//   for many copies of a mesh. Every frame, one loop of game code (poseFactory) works out the world
//   matrix of every moving part in closed form, in place of a walk of a scene graph, and only the
//   copies in use upload.
//
// The meshes, surfaces, lights and simulation come from the shared scene description, and the
// worker (examples/lib/three-worker.ts) draws the effects.

import type * as ThreeModule from 'three';
import {
	gradeTable,
	type MeshData,
	type SurfaceKind,
	sampleCameraLoop,
	surfaceMaps,
} from '../../lib/compare-scene';
import { runThreeWorker, type Three } from '../../lib/three-worker';
import { type FactoryMatrices, poseFactory, writeMatrix } from './pose';
import {
	ARM_PARENT,
	ARM_PART,
	ARM_PARTS,
	armPartLocal,
	beltOffset,
	CRATES_PER_CELL,
	CrateParent,
	CrateState,
	crateTransform,
	createFactory,
	FACTORY_CAMERA,
	FACTORY_LOOK,
	FACTORY_MATERIALS,
	FACTORY_SEED,
	type FactoryMesh,
	factoryCells,
	factoryMeshes,
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

/** Uploads only the copies in use: the first `count` matrices. */
function uploadCopies(batch: ThreeModule.InstancedMesh, count: number): void {
	const matrices = batch.instanceMatrix;
	matrices.clearUpdateRanges();
	matrices.addUpdateRange(0, count * 16);
	matrices.needsUpdate = true;
}

runThreeWorker(({ three, options, anisotropy }) => {
	const capacity = factoryCells(options.capacity);
	const state = createFactory(capacity);
	const meshes = factoryMeshes(capacity);
	const { effects } = options;
	const look = FACTORY_LOOK;
	const scene = new three.Scene();
	scene.background = new three.Color(look.background);
	scene.add(new three.AmbientLight(look.ambient.color, look.ambient.intensity));
	const { spot } = look;
	for (const [x, y, z] of SPOT_POSITIONS) {
		const light = new three.SpotLight(
			spot.color,
			spot.intensity,
			spot.range,
			spot.angle,
			spot.penumbra,
			spot.decay,
		);
		light.position.set(x, y - 0.05, z);
		light.target.position.set(x, 0, z);
		light.castShadow = effects.shadows;
		light.shadow.mapSize.set(spot.shadowSize, spot.shadowSize);
		light.shadow.camera.near = 0.5;
		light.shadow.camera.far = spot.range;
		light.shadow.bias = -0.0005;
		light.shadow.normalBias = spot.normalBias;
		scene.add(light, light.target);
	}

	// Surfaces: each kind's maps are made once; a material with another repeat takes copies of the
	// textures that share their texels.
	const made = new Map<SurfaceKind, ThreeModule.DataTexture[]>();
	const surface = (kind: SurfaceKind, repeat: number) => {
		let textures = made.get(kind);
		if (!textures) {
			const maps = surfaceMaps(kind, SURFACE_SIZE, FACTORY_SEED);
			textures = [maps.color, maps.orm, maps.normal].map(({ size, data, colorSpace }) => {
				const texture = new three.DataTexture(data, size, size, three.RGBAFormat);
				texture.colorSpace = colorSpace === 'srgb' ? three.SRGBColorSpace : three.NoColorSpace;
				texture.wrapS = texture.wrapT = three.RepeatWrapping;
				texture.generateMipmaps = true;
				texture.minFilter = three.LinearMipmapLinearFilter;
				texture.magFilter = three.LinearFilter;
				texture.anisotropy = anisotropy;
				texture.needsUpdate = true;
				return texture;
			});
			made.set(kind, textures);
		}
		if (repeat === 1) return textures;
		return textures.map((texture) => {
			const copy = texture.clone();
			copy.repeat.set(repeat, repeat);
			return copy;
		});
	};
	const materialOf = (name: FactoryMesh): ThreeModule.MeshStandardMaterial => {
		const spec = FACTORY_MATERIALS[name];
		if (spec.surface) {
			const [map, orm, normalMap] = surface(
				spec.surface,
				spec.repeat ?? 1,
			) as ThreeModule.Texture[];
			return new three.MeshStandardMaterial({
				color: spec.color,
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
			color: spec.color,
			roughness: spec.roughness,
			metalness: spec.metalness,
			emissive: spec.emissive,
			emissiveIntensity: spec.emissiveIntensity,
		});
	};
	const materials = new Map<FactoryMesh, ThreeModule.MeshStandardMaterial>();
	const material = (name: FactoryMesh) => {
		let made = materials.get(name);
		if (!made) {
			made = materialOf(name);
			materials.set(name, made);
		}
		return made;
	};

	const geometries = new Map<FactoryMesh, ThreeModule.BufferGeometry>();
	const geometry = (name: FactoryMesh) => {
		let made = geometries.get(name);
		if (!made) {
			made = toGeometry(three, meshes[name]);
			geometries.set(name, made);
		}
		return made;
	};
	const withShadows = <T extends ThreeModule.Object3D>(object: T, name: FactoryMesh): T => {
		object.castShadow = effects.shadows && FACTORY_MATERIALS[name].noShadow !== true;
		object.receiveShadow = effects.shadows;
		return object;
	};
	/** A batch of copies: `perCell` for each cell's part, or `copies` of them in all. */
	const batch = (name: FactoryMesh, copies: number, moving: boolean) => {
		const mesh = new three.InstancedMesh(geometry(name), material(name), copies);
		mesh.instanceMatrix.setUsage(moving ? three.DynamicDrawUsage : three.StaticDrawUsage);
		// The batches cover the whole hall, which the camera always sees.
		mesh.frustumCulled = false;
		scene.add(withShadows(mesh, name));
		return mesh;
	};
	/** A mesh that keeps its local matrix until a write calls updateMatrix. */
	const node = (
		name: FactoryMesh,
		parent: ThreeModule.Object3D,
		x: number,
		y: number,
		z: number,
	) => {
		const mesh = withShadows(new three.Mesh(geometry(name), material(name)), name);
		mesh.matrixAutoUpdate = false;
		mesh.position.set(x, y, z);
		mesh.updateMatrix();
		parent.add(mesh);
		return mesh;
	};
	node('floor', scene, 0, 0, 0);
	for (const [x, y, z] of SPOT_POSITIONS) {
		node('housing', scene, x, y, z);
		node('lens', scene, x, y - 0.01, z);
	}

	/** The instanced mode: a batch per part kind, with room for every cell of the run. */
	const instancedCells = (): Cells => {
		const base = batch('base', capacity, false);
		const still = {
			belt: batch('belt', capacity, false),
			pallet: batch('pallet', capacity, false),
			line: batch('line', capacity, false),
			lamp: batch('lamp', capacity, false),
		};
		const turntable = batch('turntable', capacity, true);
		const upperArm = batch('upperArm', capacity, true);
		const forearm = batch('forearm', capacity, true);
		const wrist = batch('wrist', capacity, true);
		const finger = batch('finger', capacity * 2, true);
		const crate = batch('crate', capacity * CRATES_PER_CELL, true);

		// Still parts: written once for every cell.
		const at = new Float64Array(3);
		const identity = (out: Float32Array, i: number, x: number, y: number, z: number) =>
			writeMatrix(out, i * 16, 1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z);
		for (let c = 0; c < capacity; c++) {
			const ox = state.origin[c * 2] as number;
			const oz = state.origin[c * 2 + 1] as number;
			identity(base.instanceMatrix.array as Float32Array, c, ox, 0, oz);
			for (const [name, kind] of Object.entries(STILL_PART) as [keyof typeof still, number][]) {
				stillPartLocal(kind, at);
				identity(
					still[name].instanceMatrix.array as Float32Array,
					c,
					ox + (at[0] as number),
					at[1] as number,
					oz + (at[2] as number),
				);
			}
		}
		for (const mesh of [base, ...Object.values(still)]) mesh.instanceMatrix.needsUpdate = true;

		const perCell = [base, ...Object.values(still), turntable, upperArm, forearm, wrist];
		const matrices: FactoryMatrices = {
			turntable: turntable.instanceMatrix.array as Float32Array,
			upperArm: upperArm.instanceMatrix.array as Float32Array,
			forearm: forearm.instanceMatrix.array as Float32Array,
			wrist: wrist.instanceMatrix.array as Float32Array,
			finger: finger.instanceMatrix.array as Float32Array,
			crate: crate.instanceMatrix.array as Float32Array,
		};
		let cells = 0;
		return {
			show(next) {
				cells = next;
				for (const mesh of perCell) mesh.count = cells;
				finger.count = cells * 2;
				crate.count = cells * CRATES_PER_CELL;
			},
			pose() {
				poseFactory(state, cells, matrices);
				uploadCopies(turntable, cells);
				uploadCopies(upperArm, cells);
				uploadCopies(forearm, cells);
				uploadCopies(wrist, cells);
				uploadCopies(finger, cells * 2);
				uploadCopies(crate, cells * CRATES_PER_CELL);
			},
		};
	};

	/** The scene-graph mode: a tree of meshes per cell, for the cells that show. */
	const sceneGraphCells = (): Cells => {
		const hall = new three.Group();
		scene.add(hall);
		const position = new Float64Array(3);
		const rotation = new Float64Array(4);
		// Each cell's arm parts, parent first, and its crates, cell by cell.
		const arms: ThreeModule.Mesh[] = [];
		const crates: ThreeModule.Mesh[] = [];
		// The values last written let joints and crates that did not change write nothing.
		const written = new Float32Array(capacity * JOINTS);
		const crateWritten = new Int8Array(capacity * CRATES_PER_CELL);
		const crateAt = new Float32Array(capacity * CRATES_PER_CELL);
		const placeArmPart = (mesh: ThreeModule.Object3D, c: number, p: number) => {
			armPartLocal(state, c, p, position, rotation);
			mesh.position.set(position[0] as number, position[1] as number, position[2] as number);
			mesh.quaternion.set(
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			);
			mesh.updateMatrix();
		};
		const createCell = (c: number) => {
			// A new cell's nodes start at its joints' values, and its crates wait for their first write.
			written.set(state.joints.subarray(c * JOINTS, (c + 1) * JOINTS), c * JOINTS);
			crateWritten.fill(-1, c * CRATES_PER_CELL, (c + 1) * CRATES_PER_CELL);
			crateAt.fill(Number.NaN, c * CRATES_PER_CELL, (c + 1) * CRATES_PER_CELL);
			const tree: ThreeModule.Mesh[] = [];
			for (let p = 0; p < ARM_PARTS; p++) {
				const parent = p === 0 ? hall : (tree[ARM_PARENT[p] as number] as ThreeModule.Mesh);
				const mesh = node(ARM_MESHES[p] as FactoryMesh, parent, 0, 0, 0);
				placeArmPart(mesh, c, p);
				tree.push(mesh);
			}
			arms.push(...tree);
			const base = tree[0] as ThreeModule.Mesh;
			for (const [name, kind] of Object.entries(STILL_PART) as [FactoryMesh, number][]) {
				stillPartLocal(kind, position);
				node(name, base, position[0] as number, position[1] as number, position[2] as number);
			}
			for (let k = 0; k < CRATES_PER_CELL; k++) crates.push(node('crate', base, 0, 0, 0));
		};

		const writeArm = (c: number) => {
			const j = c * JOINTS;
			const at = c * ARM_PARTS;
			for (let p = ARM_PART.turntable; p <= ARM_PART.wrist; p++) {
				const value = state.joints[j + p - 1] as number;
				if (written[j + p - 1] === value) continue;
				written[j + p - 1] = value;
				placeArmPart(arms[at + p] as ThreeModule.Mesh, c, p);
			}
			const grip = state.joints[j + 4] as number;
			if (written[j + 4] !== grip) {
				written[j + 4] = grip;
				placeArmPart(arms[at + ARM_PART.fingerLeft] as ThreeModule.Mesh, c, ARM_PART.fingerLeft);
				placeArmPart(arms[at + ARM_PART.fingerRight] as ThreeModule.Mesh, c, ARM_PART.fingerRight);
			}
		};

		const writeCrates = (c: number) => {
			const ox = state.origin[c * 2] as number;
			const oz = state.origin[c * 2 + 1] as number;
			for (let k = 0; k < CRATES_PER_CELL; k++) {
				const i = c * CRATES_PER_CELL + k;
				const now = state.crateState[i] as number;
				// A held crate, a placed crate and a crate that waits on its belt stand still in their
				// parent's frame.
				const at = now === CrateState.belt ? (state.crateDistance[i] as number) : 0;
				if (crateWritten[i] === now && crateAt[i] === at) continue;
				crateAt[i] = at;
				const crate = crates[i] as ThreeModule.Mesh;
				const held = crateTransform(state, c, k, position, rotation) === CrateParent.wrist;
				if (crateWritten[i] !== now)
					(arms[c * ARM_PARTS + (held ? ARM_PART.wrist : ARM_PART.base)] as ThreeModule.Mesh).add(
						crate,
					);
				crateWritten[i] = now;
				// A crate under the base sits relative to the cell's origin.
				crate.position.set(
					(position[0] as number) - (held ? 0 : ox),
					position[1] as number,
					(position[2] as number) - (held ? 0 : oz),
				);
				crate.quaternion.set(
					rotation[0] as number,
					rotation[1] as number,
					rotation[2] as number,
					rotation[3] as number,
				);
				crate.updateMatrix();
			}
		};

		let cells = 0;
		return {
			show(next) {
				cells = next;
				let made = hall.children.length;
				while (made < cells) createCell(made++);
				if (made > cells) {
					hall.remove(...hall.children.slice(cells));
					arms.length = cells * ARM_PARTS;
					crates.length = cells * CRATES_PER_CELL;
				}
			},
			pose() {
				for (let c = 0; c < cells; c++) {
					writeArm(c);
					writeCrates(c);
				}
			},
		};
	};

	const cells = options.mode === 'instanced' ? instancedCells() : sceneGraphCells();
	let shown = 0;
	const setCount = (count: number) => {
		shown = Math.min(capacity, factoryCells(count));
		setActiveCells(state, shown);
		cells.show(shown);
	};
	setCount(options.count);

	const sparks = batch('spark', SPARK_COUNT, true);
	sparks.castShadow = false;
	const sparkMatrices = sparks.instanceMatrix.array as Float32Array;
	const spark = new Float64Array(3);
	const lamp = material('lamp');
	const belt = (surface('rubber', 1) as ThreeModule.Texture[]).map((texture) => texture.offset);
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
			fog: look.fog,
			bloom: look.bloom,
			ao: look.ao,
			grade: gradeTable(look.grade),
		},
		setCount,
		step: () => stepFactory(state),
		pose(seconds) {
			cells.pose();
			for (let k = 0; k < SPARK_COUNT; k++) {
				const size = sparkPosition(state, k, seconds, spark) ? 1 : 0;
				writeMatrix(
					sparkMatrices,
					k * 16,
					size,
					0,
					0,
					0,
					size,
					0,
					0,
					0,
					size,
					spark[0] as number,
					spark[1] as number,
					spark[2] as number,
				);
			}
			uploadCopies(sparks, SPARK_COUNT);
			lamp.emissiveIntensity = lampIntensity(seconds);
			const offset = -beltOffset(seconds);
			for (const texture of belt) texture.x = offset;
			sampleCameraLoop(FACTORY_CAMERA, seconds, cameraPosition, cameraTarget);
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

/** One way of building the cells: it shows a count of cells and poses them each frame. */
interface Cells {
	/** Shows the first `cells` cells. */
	show(cells: number): void;
	/** Writes the moving parts for the simulation's state. */
	pose(): void;
}

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
