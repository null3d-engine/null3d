// The instanced mode's crowd in three.js, the route of three.js's crowd example
// (webgpu_skinning_instancing_individual): one AnimationMixer per model poses each unit in turn,
// the unit's bone matrices go into one table, and one draw per model skins every unit from it. The
// example skins in a compute pass that stores each copy's skinned vertices, which at 20,000 soldiers
// would take gigabytes; here the same skinning math runs as the units draw, so memory holds bones,
// not vertices. The rifle on each soldier's hand is an InstancedMesh, each copy placed by the hand's
// joint. It needs WebGPURenderer: on WebGPU the tables are storage buffers, and in its WebGL2 mode
// float textures, in chunks whose textures upload only while their units are in use.

import type * as ThreeModule from 'three';
import type * as TSL from 'three/tsl';
import type * as WebGPU from 'three/webgpu';
import type { Three } from '../../lib/three-worker';
import {
	type BattleState,
	CLIP_NAMES,
	MODELS,
	type ModelName,
	UnitKind,
	unitKindOf,
} from './scene';
import { type ClipPoser, poseUnitMixer, unitActions } from './three-pose';

type WebGPUModule = typeof WebGPU;
type TSLModule = typeof TSL;
type UintNode = WebGPU.Node<'uint'>;
type Vec4Node = WebGPU.Node<'vec4'>;

/** Texture rows are this many texels wide. */
const TABLE_WIDTH = 2048;
/** Units per chunk in texture mode, so the upload follows the count, not the capacity. */
const TEXTURE_CHUNK_UNITS = 2048;

/** A table of vec4 values that shaders read by index: a storage buffer or a float texture. */
class Vec4Table {
	private readonly attribute: WebGPU.StorageBufferAttribute | null;
	private readonly texture: ThreeModule.DataTexture | null;
	private readonly node: WebGPU.StorageBufferNode<'vec4'> | null;

	constructor(
		webgpu: WebGPUModule,
		private readonly tsl: TSLModule,
		length: number,
		asTexture: boolean,
	) {
		if (asTexture) {
			const height = Math.max(1, Math.ceil(length / TABLE_WIDTH));
			this.texture = new webgpu.DataTexture(
				new Float32Array(TABLE_WIDTH * height * 4),
				TABLE_WIDTH,
				height,
				webgpu.RGBAFormat,
				webgpu.FloatType,
			);
			this.texture.needsUpdate = true;
			this.attribute = null;
			this.node = null;
		} else {
			this.attribute = new webgpu.StorageBufferAttribute(new Float32Array(length * 4), 4);
			this.node = tsl.storage(this.attribute, 'vec4', length).toReadOnly();
			this.texture = null;
		}
	}

	get data(): Float32Array {
		return (this.texture ? this.texture.image.data : this.attribute?.array) as Float32Array;
	}

	read(index: UintNode): Vec4Node {
		const { tsl } = this;
		if (this.texture) {
			const x = tsl.int(index.mod(tsl.uint(TABLE_WIDTH)));
			const y = tsl.int(index.div(tsl.uint(TABLE_WIDTH)));
			return tsl.textureLoad(this.texture, tsl.ivec2(x, y)) as unknown as Vec4Node;
		}
		return (this.node as WebGPU.StorageBufferNode<'vec4'>).element(index) as unknown as Vec4Node;
	}

	/** Sends the first `entries` entries to the GPU (the whole texture in texture mode). */
	upload(entries: number): void {
		if (this.texture) {
			this.texture.needsUpdate = true;
			return;
		}
		const attribute = this.attribute as WebGPU.StorageBufferAttribute;
		attribute.clearUpdateRanges();
		attribute.addUpdateRange(0, entries * 4);
		attribute.needsUpdate = true;
	}
}

interface Chunk {
	first: number;
	size: number;
	bones: Vec4Table;
	units: Vec4Table;
	mesh: WebGPU.Mesh;
}

export interface CrowdOptions {
	name: ModelName;
	/** The most units of both kinds: the crowd makes room for its share of them. */
	capacity: number;
	/** Each army's material, whose color tints the model's vertex colors. */
	uniforms: ThreeModule.MeshStandardMaterial[];
	shadows: boolean;
	/** Tables in float textures: WebGPURenderer's WebGL2 mode. */
	textures: boolean;
}

export class DrawCrowd {
	readonly object: ThreeModule.Object3D;
	private readonly chunks: Chunk[] = [];
	private readonly chunkSize: number;
	private readonly boneFloats: number;
	private readonly frame: ThreeModule.Matrix4;
	private readonly place: ThreeModule.Matrix4;
	private readonly world: ThreeModule.Matrix4;
	private readonly rifleWorld: ThreeModule.Matrix4;
	private readonly rifle: ThreeModule.InstancedMesh | null;
	private readonly rifleNode: ThreeModule.Object3D | null;
	/** Each unit's slot among the units of this model, or -1 for the other model's units. */
	private readonly slotOf: Int32Array;

	private constructor(
		webgpu: WebGPUModule,
		tsl: TSLModule,
		private readonly root: ThreeModule.Object3D,
		private readonly mesh: ThreeModule.SkinnedMesh,
		private readonly mixer: ThreeModule.AnimationMixer,
		private readonly poser: ClipPoser,
		private readonly options: CrowdOptions,
	) {
		const { name, capacity } = options;
		this.slotOf = new Int32Array(capacity).fill(-1);
		let slots = 0;
		const kind = name === 'mech' ? UnitKind.mech : UnitKind.soldier;
		for (let i = 0; i < capacity; i++) if (unitKindOf(i) === kind) this.slotOf[i] = slots++;
		const units = Math.max(1, slots);
		this.boneFloats = mesh.skeleton.bones.length * 16;
		const geometry = mesh.geometry.clone();
		geometry.applyMatrix4(mesh.bindMatrix);
		root.updateMatrixWorld(true);
		this.frame = new webgpu.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
		this.place = new webgpu.Matrix4();
		this.world = new webgpu.Matrix4();
		this.rifleWorld = new webgpu.Matrix4();
		const group = new webgpu.Group();
		this.object = group as unknown as ThreeModule.Object3D;
		this.chunkSize = options.textures ? TEXTURE_CHUNK_UNITS : units;
		// The army's tint of each slot, which multiplies the model's vertex colors.
		const tints = new Float32Array(units * 3);
		for (let i = 0; i < capacity; i++) {
			const slot = this.slotOf[i] as number;
			if (slot < 0) continue;
			const color = (options.uniforms[i & 1] as ThreeModule.MeshStandardMaterial).color;
			tints.set([color.r, color.g, color.b], slot * 3);
		}
		for (let first = 0; first < units; first += this.chunkSize) {
			const size = Math.min(this.chunkSize, units - first);
			const chunk = this.makeChunk(webgpu, tsl, geometry, first, size, tints);
			this.chunks.push(chunk);
			group.add(chunk.mesh);
		}
		// The rifle, a mesh of its own that hangs on a joint.
		let rifle: ThreeModule.Mesh | null = null;
		root.traverse((object) => {
			const candidate = object as ThreeModule.Mesh;
			if (candidate.isMesh && !(candidate as ThreeModule.SkinnedMesh).isSkinnedMesh)
				rifle = candidate;
		});
		this.rifleNode = rifle;
		if (rifle) {
			const source = rifle as ThreeModule.Mesh;
			const batch = new webgpu.InstancedMesh(
				source.geometry as never,
				source.material as never,
				units,
			);
			batch.instanceMatrix.setUsage(webgpu.DynamicDrawUsage);
			batch.frustumCulled = false;
			batch.castShadow = batch.receiveShadow = options.shadows;
			batch.count = 0;
			this.rifle = batch as unknown as ThreeModule.InstancedMesh;
			group.add(batch);
		} else {
			this.rifle = null;
		}
	}

	/** A crowd of a model that GLTFLoader read. */
	static async create(
		three: Three,
		gltf: { scene: ThreeModule.Object3D; animations: ThreeModule.AnimationClip[] },
		options: CrowdOptions,
	): Promise<DrawCrowd> {
		const webgpu = three as unknown as WebGPUModule;
		const tsl = await import('three/tsl');
		let mesh: ThreeModule.SkinnedMesh | null = null;
		gltf.scene.traverse((object) => {
			if ((object as ThreeModule.SkinnedMesh).isSkinnedMesh)
				mesh = object as ThreeModule.SkinnedMesh;
		});
		if (!mesh) throw new Error(`The ${options.name} model has no skinned mesh.`);
		const mixer = new webgpu.AnimationMixer(
			gltf.scene as never,
		) as unknown as ThreeModule.AnimationMixer;
		const poser = unitActions(mixer, gltf.animations, CLIP_NAMES);
		return new DrawCrowd(webgpu, tsl, gltf.scene, mesh, mixer, poser, options);
	}

	private makeChunk(
		webgpu: WebGPUModule,
		tsl: TSLModule,
		geometry: ThreeModule.BufferGeometry,
		first: number,
		size: number,
		tints: Float32Array,
	): Chunk {
		const boneCount = this.mesh.skeleton.bones.length;
		const bones = new Vec4Table(webgpu, tsl, size * boneCount * 4, this.options.textures);
		const units = new Vec4Table(webgpu, tsl, size * 5, this.options.textures);
		const unitData = units.data;
		for (let local = 0; local < size; local++) {
			const slot = first + local;
			unitData[local * 20 + 16] = tints[slot * 3] ?? 1;
			unitData[local * 20 + 17] = tints[slot * 3 + 1] ?? 1;
			unitData[local * 20 + 18] = tints[slot * 3 + 2] ?? 1;
			unitData[local * 20 + 19] = 1;
		}
		units.upload(size * 5);
		const { Fn, attribute, instanceIndex, uint, mat4, mat3, vec4, add, normalLocal } = tsl;
		const unitMatrix = (unit: UintNode) => {
			const at = unit.mul(uint(5));
			return mat4(
				units.read(at),
				units.read(at.add(uint(1))),
				units.read(at.add(uint(2))),
				units.read(at.add(uint(3))),
			);
		};
		const boneMatrix = (unit: UintNode, joint: UintNode) => {
			const at = unit.mul(uint(boneCount * 4)).add(joint.mul(uint(4)));
			return mat4(
				bones.read(at),
				bones.read(at.add(uint(1))),
				bones.read(at.add(uint(2))),
				bones.read(at.add(uint(3))),
			);
		};
		const material = new webgpu.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
		material.vertexColors = true;
		material.positionNode = Fn(() => {
			const unit = instanceIndex;
			const joints = attribute('skinIndex', 'uvec4');
			const weights = attribute('skinWeight', 'vec4');
			// The skinning math of three.js's example and of its own skinned meshes.
			const skin = add(
				boneMatrix(unit, joints.x).mul(weights.x),
				boneMatrix(unit, joints.y).mul(weights.y),
				boneMatrix(unit, joints.z).mul(weights.z),
				boneMatrix(unit, joints.w).mul(weights.w),
			);
			const toWorld = unitMatrix(unit).mul(skin).toVar();
			normalLocal.assign(mat3(toWorld).mul(attribute('normal', 'vec3')).normalize());
			return toWorld.mul(vec4(attribute('position', 'vec3'), 1)).xyz;
		})();
		material.colorNode = units.read(instanceIndex.mul(uint(5)).add(uint(4)));
		const mesh = new webgpu.Mesh(geometry as never, material);
		mesh.frustumCulled = false;
		mesh.castShadow = this.options.shadows;
		mesh.receiveShadow = this.options.shadows;
		mesh.count = 0;
		mesh.visible = false;
		return { first, size, bones, units, mesh };
	}

	/** Poses the first `shown` units of the state that are this model's, and draws them. */
	pose(s: BattleState, shown: number): void {
		const scale = MODELS[this.options.name].scale;
		const rifleMatrices = this.rifle?.instanceMatrix.array as Float32Array | undefined;
		let count = 0;
		for (let i = 0; i < shown; i++) {
			const slot = this.slotOf[i] as number;
			if (slot < 0) continue;
			count = slot + 1;
			poseUnitMixer(s, i, this.mixer, this.poser);
			this.root.updateMatrixWorld(true);
			this.mesh.skeleton.update();
			const chunk = this.chunks[Math.floor(slot / this.chunkSize)] as Chunk;
			const local = slot - chunk.first;
			chunk.bones.data.set(
				this.mesh.skeleton.boneMatrices as Float32Array,
				local * this.boneFloats,
			);
			const heading = s.heading[i] as number;
			const c = Math.cos(heading) * scale;
			const sn = Math.sin(heading) * scale;
			// Turn about +Y by the heading, scale to the unit's height, stand at its place.
			this.place.set(
				c,
				0,
				sn,
				s.x[i] as number,
				0,
				scale,
				0,
				s.y[i] as number,
				-sn,
				0,
				c,
				s.z[i] as number,
				0,
				0,
				0,
				1,
			);
			this.world.multiplyMatrices(this.place, this.frame);
			this.world.toArray(chunk.units.data, local * 20);
			if (rifleMatrices && this.rifleNode) {
				this.rifleWorld.multiplyMatrices(this.place, this.rifleNode.matrixWorld);
				this.rifleWorld.toArray(rifleMatrices, slot * 16);
			}
		}
		for (const chunk of this.chunks) {
			const used = Math.max(0, Math.min(chunk.size, count - chunk.first));
			chunk.mesh.count = used;
			chunk.mesh.visible = used > 0;
			if (used === 0) continue;
			chunk.bones.upload(used * this.mesh.skeleton.bones.length * 4);
			chunk.units.upload(used * 5);
		}
		if (this.rifle) {
			this.rifle.count = count;
			const matrices = this.rifle.instanceMatrix;
			matrices.clearUpdateRanges();
			matrices.addUpdateRange(0, Math.max(1, count) * 16);
			matrices.needsUpdate = true;
		}
	}
}
