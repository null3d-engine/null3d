// Factory, the three.js half, which runs in its worker. It is the tuned three.js version of the old
// comparison: each part kind is one InstancedMesh, the batch of copies that three.js's docs advise
// for many copies of a mesh. Every frame, one loop of game code (poseFactory) works out the world
// matrix of every moving part in closed form, in place of a walk of a scene graph, and only the
// copies in use upload. The meshes, surfaces, lights and simulation come from the shared scene
// description, and the worker (examples/lib/three-worker.ts) draws the effects.

import type * as ThreeModule from 'three';
import {
	gradeTable,
	type MeshData,
	type SurfaceKind,
	sampleCameraLoop,
	surfaceMaps,
} from '../../lib/compare-scene';
import { runThreeWorker, type Three } from '../../lib/three-worker';
import {
	beltOffset,
	CRATES_PER_CELL,
	createFactory,
	FACTORY_CAMERA,
	FACTORY_LOOK,
	FACTORY_MATERIALS,
	FACTORY_SEED,
	type FactoryMesh,
	factoryCells,
	factoryMeshes,
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
import { type FactoryMatrices, poseFactory, writeMatrix } from './three-pose';

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

	/** A batch of copies, with a copy for each cell's part, or `copies` of them. */
	const batch = (name: FactoryMesh, copies: number, moving: boolean) => {
		const mesh = new three.InstancedMesh(toGeometry(three, meshes[name]), material(name), copies);
		mesh.instanceMatrix.setUsage(moving ? three.DynamicDrawUsage : three.StaticDrawUsage);
		// The batches cover the whole hall, which the camera always sees.
		mesh.frustumCulled = false;
		mesh.castShadow = effects.shadows && FACTORY_MATERIALS[name].noShadow !== true;
		mesh.receiveShadow = effects.shadows;
		scene.add(mesh);
		return mesh;
	};
	const single = (name: FactoryMesh, x: number, y: number, z: number) => {
		const mesh = new three.Mesh(toGeometry(three, meshes[name]), material(name));
		mesh.position.set(x, y, z);
		mesh.castShadow = effects.shadows && FACTORY_MATERIALS[name].noShadow !== true;
		mesh.receiveShadow = effects.shadows;
		scene.add(mesh);
	};
	single('floor', 0, 0, 0);
	for (const [x, y, z] of SPOT_POSITIONS) {
		single('housing', x, y, z);
		single('lens', x, y - 0.01, z);
	}
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
	const sparks = batch('spark', SPARK_COUNT, true);
	sparks.castShadow = false;

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
	let cells = capacity;
	const setCount = (count: number) => {
		cells = Math.min(capacity, factoryCells(count));
		setActiveCells(state, cells);
		for (const mesh of perCell) mesh.count = cells;
		finger.count = cells * 2;
		crate.count = cells * CRATES_PER_CELL;
	};
	setCount(options.count);

	const matrices: FactoryMatrices = {
		turntable: turntable.instanceMatrix.array as Float32Array,
		upperArm: upperArm.instanceMatrix.array as Float32Array,
		forearm: forearm.instanceMatrix.array as Float32Array,
		wrist: wrist.instanceMatrix.array as Float32Array,
		finger: finger.instanceMatrix.array as Float32Array,
		crate: crate.instanceMatrix.array as Float32Array,
	};
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
			poseFactory(state, cells, matrices);
			uploadCopies(turntable, cells);
			uploadCopies(upperArm, cells);
			uploadCopies(forearm, cells);
			uploadCopies(wrist, cells);
			uploadCopies(finger, cells * 2);
			uploadCopies(crate, cells * CRATES_PER_CELL);
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
