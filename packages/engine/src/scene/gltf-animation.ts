// The glTF parser's reader of skins, clips and morph targets, which runs in the glTF worker. It
// turns a file's skins and animations into one skeleton for the whole model, in the form that the
// engine core's animation table takes (`createAnimationRig` in animation.ts):
//
// - The skeleton's joints are every node that a skin names or a clip moves, every node below
//   those, and every node above them. Joints come parents first, and the roots' parent is the
//   group that holds a copy of the model. These nodes become joints only, not objects.
// - A node that a skin names twice with different inverse bind matrices, once per skin, gets one
//   joint per matrix: a child joint at rest under it holds each further matrix.
// - A skinned mesh's vertices name joints by their place in the skin, so the reader rewrites them
//   to name the skeleton's joints. A mesh without a skin on a node that moves gets joints and
//   weights that give its whole weight to its node's joint, so it moves through the same skinning.
//   Each pairing of a mesh with a skin or a joint makes its own copy of the mesh.
// - The other nodes stay objects. One under a joint goes under the copy's group, with the place
//   that its joints give it at rest, which never changes, because nothing moves them.
//
// - Each node whose morph weights a clip animates gets joints that move no vertex: roots at rest at
//   the origin with scale 0, three weights to a joint. A clip's weights track becomes translation
//   tracks of those joints, one weight along each axis, and a constant scale of 1 marks the weights
//   as the clip's, as the core's `posed_weight` reads them.
//
// Clips keep their keys as the file holds them. The core resamples them on its job workers. The
// module also defines the rig data that animation.ts stores in the core. It imports only its
// sibling modules of the glTF worker, so code that type checks the parser alone needs no browser
// types.

import type { FileBudget } from './file-limits';
import { broken, type Entry, entry, index, list, type Reader, text, toFloats } from './gltf-json';
import { affineOf, decomposeAffine, multiplyAffine } from './gltf-math';
import type { MeshData, NodeData, PrimitiveData, VertexData } from './gltf-parse';

/** The most joints that one skeleton of the engine core holds (the core's `MAX_JOINTS`). */
export const MAX_RIG_JOINTS = 1024;

// Numbers of the glTF 2.0 specification.
const FLOAT = 5126;
const SCALAR = 1;

/** How a track's value moves between its keys. */
export type KeyInterpolation = 'linear' | 'step' | 'cubic';

/** A clip's track of a mesh's morph target weights, with one weight per target in each key. */
interface WeightTrack {
	/** The node whose mesh the weights shape, by its index in the node list. */
	node: number;
	interpolation: KeyInterpolation;
	times: Float32Array;
	/** The weights of every target per key, or for a cubic track an in-tangent, the weights and an out-tangent. */
	values: Float32Array;
}

/** The morph targets of a primitive: one array of deltas per target for each attribute it moves. */
export interface MorphTargetsData {
	positions?: Float32Array[];
	normals?: Float32Array[];
	tangents?: Float32Array[];
}

/** One joint of a rig's skeleton. Joints come parents first. */
export interface RigJoint {
	name: string;
	/** The index of the parent joint, or -1 for a root. */
	parent: number;
	translation: readonly [number, number, number];
	rotation: readonly [number, number, number, number];
	scale: readonly [number, number, number];
	/** The inverse of the joint's matrix at bind time, row-major 3 × 4: 12 numbers. */
	inverseBind: ArrayLike<number>;
	/** True for a joint of a skin, which `debug.skeleton` draws. */
	bone?: boolean;
}

/** One track of a rig's clip: keys of one channel of one joint, at any times. */
export interface RigTrack {
	joint: number;
	channel: 'translation' | 'rotation' | 'scale';
	/**
	 * How the value moves between keys: in a straight line (the default), held until the next key
	 * ('step'), or along glTF's cubic spline ('cubic').
	 */
	interpolation?: 'linear' | 'step' | 'cubic';
	times: ArrayLike<number>;
	/**
	 * Three numbers per key, or four for a rotation. A cubic key holds three times as many: an
	 * in-tangent, the value and an out-tangent.
	 */
	values: ArrayLike<number>;
}

/** A named clip of a rig, with its events. */
export interface RigClip {
	name: string;
	tracks: readonly RigTrack[];
	events?: readonly { time: number; name: string }[];
}

/** A skeleton and its clips, as a loaded model gives them. */
export interface RigData {
	joints: readonly RigJoint[];
	clips: readonly RigClip[];
	/** Keys per second that clips are stored at, unless their own keys lie on a coarser grid. */
	rate?: number;
}

/** A clip of the file. */
export interface ClipData extends RigClip {
	tracks: RigTrack[];
}

/** A clip as the reader first reads it: its tracks of nodes, and its tracks of morph weights. */
interface ParsedClip extends ClipData {
	weights: WeightTrack[];
}

/** What the reader adds to a parsed file. */
export interface AnimationData {
	/** The skeleton, or none when no skin names a joint and no clip moves a node. */
	joints: RigJoint[];
	/** The clips, in the file's order, with names that differ. */
	clips: ClipData[];
	/** For each skin of the file, the skeleton's joint of each of its joints; none for an unused skin. */
	skins: number[][];
}

/** The identity as a row-major 3 × 4 matrix. */
const IDENTITY_BIND = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** The morph weights that one joint holds, one along each axis of its translation (the core's `WEIGHTS_PER_JOINT`). */
const WEIGHTS_PER_JOINT = 3;

/**
 * The paths of glTF's animation channels that move a node, which are the channels of rig tracks.
 * Tables that the file's text names a key of are sets and maps, so a name such as "constructor"
 * finds nothing.
 */
const PATHS: ReadonlySet<string> = new Set(['translation', 'rotation', 'scale']);

/** The attributes that the engine morphs. */
const MORPHED_ATTRIBUTES: ReadonlySet<string> = new Set(['POSITION', 'NORMAL', 'TANGENT']);

const INTERPOLATIONS: ReadonlyMap<string, KeyInterpolation> = new Map([
	['LINEAR', 'linear'],
	['STEP', 'step'],
	['CUBICSPLINE', 'cubic'],
]);

/**
 * Reads a primitive's morph targets: the deltas of its positions, normals and tangents, as floats.
 * Returns undefined when it has none. Targets of other attributes, such as colors and texture
 * coordinates, are left out with a note.
 */
export function parseMorphTargets(
	primitive: Entry,
	vertices: number,
	what: string,
	read: Reader,
	budget: FileBudget,
	notes: string[],
): MorphTargetsData | undefined {
	const targets = list(primitive.targets, `${what}'s targets`);
	if (targets.length === 0) return undefined;
	const others = new Set(
		targets.flatMap((target) =>
			Object.keys(target as object).filter((k) => !MORPHED_ATTRIBUTES.has(k)),
		),
	);
	if (others.size > 0)
		notes.push(
			`${what}'s morph targets move ${[...others].join(', ')}, which the engine does not morph`,
		);
	const out: MorphTargetsData = {};
	const fields = [
		['POSITION', 'positions'],
		['NORMAL', 'normals'],
		['TANGENT', 'tangents'],
	] as const;
	const entries = targets.map((value, t) => entry(value, `${what}'s target ${t}`));
	// The first target names the attributes that the targets move. A later target that leaves one
	// out moves it by nothing.
	for (const [name, field] of fields) if (entries[0]?.[name] !== undefined) out[field] = [];
	entries.forEach((target, t) => {
		for (const [name, field] of fields) {
			const deltas = out[field];
			if (target[name] === undefined) {
				if (!deltas) continue;
				budget.take(vertices * 12, `${what}'s target ${t} ${name}`);
				deltas.push(new Float32Array(vertices * 3));
				continue;
			}
			if (!deltas) broken(`${what}'s target ${t} moves ${name}, and its first target does not`);
			const data = read(Number(target[name]), `${what}'s target ${t} ${name}`);
			if (data.components !== 3 || data.count !== vertices)
				broken(
					`${what}'s target ${t} has ${data.count} ${name} deltas of ${data.components} values, and the primitive has ${vertices} vertices`,
				);
			deltas.push(toFloats(data.array, data.normalized, budget, `${what}'s target ${t} ${name}`));
		}
	});
	return out;
}

/** A mesh's default morph weights and target names, checked against its primitives' targets. */
export function morphWeights(
	mesh: Entry,
	primitives: readonly PrimitiveData[],
	what: string,
): { weights: number[]; targetNames: string[] } {
	const counts = primitives.map((p) => targetCount(p));
	const targets = counts[0] ?? 0;
	if (counts.some((c) => c !== targets))
		broken(`${what}'s primitives have different numbers of morph targets`);
	const weights = list(mesh.weights, `${what}'s weights`).map((w) => {
		if (typeof w !== 'number' || !Number.isFinite(w)) broken(`${what}'s weights are not numbers`);
		return w;
	});
	if (weights.length !== 0 && weights.length !== targets)
		broken(`${what} has ${weights.length} weights for ${targets} morph targets`);
	const extras = mesh.extras as Entry | undefined;
	const names = Array.isArray(extras?.targetNames) ? extras.targetNames.map(text) : [];
	return {
		weights: weights.length > 0 ? weights : new Array<number>(targets).fill(0),
		targetNames: names.length === targets ? names : [],
	};
}

function targetCount(p: PrimitiveData): number {
	const m = p.morph;
	return m ? (m.positions ?? m.normals ?? m.tangents ?? []).length : 0;
}

/** A skin of the file: its joints by node index in the node list, and their inverse bind matrices. */
interface SkinData {
	joints: number[];
	/** Row-major 3 × 4 matrices, one per joint. */
	binds: Float32Array;
}

/**
 * Reads the file's skins and clips, builds the model's skeleton, and rewrites `nodes` and `meshes`
 * to match: joints stop being objects, and skinned and moving meshes get copies whose vertices name
 * the skeleton's joints. `place` gives each file node's index in the node list, or -1 for a node
 * outside the scene. Returns undefined when the file has no skin and no clip.
 */
export function parseAnimation(
	json: { skins?: unknown; animations?: unknown },
	nodes: NodeData[],
	meshes: MeshData[],
	place: Int32Array,
	read: Reader,
	budget: FileBudget,
	notes: string[],
): AnimationData | undefined {
	const skinDefs = list(json.skins, 'skins');
	const animationDefs = list(json.animations, 'animations');
	if (skinDefs.length === 0 && animationDefs.length === 0) return undefined;
	const n = nodes.length;
	const skins = skinDefs.map((value, s) => parseSkin(entry(value, `skin ${s}`), s, place, read));
	const clips = animationDefs.map((value, k) =>
		parseClip(entry(value, `animation ${k}`), k, nodes, meshes, place, read, budget, notes),
	);
	uniqueNames(clips);

	// The nodes that move: each joint of a skin that a mesh uses, each node a clip moves, and every
	// node below them.
	const moving = new Uint8Array(n);
	const used = new Set<number>();
	for (const node of nodes)
		if (node.skin >= 0 && node.mesh >= 0) {
			used.add(node.skin);
			for (const joint of (skins[node.skin] as SkinData).joints) if (joint >= 0) moving[joint] = 1;
		}
	for (const clip of clips) for (const track of clip.tracks) moving[track.joint] = 1;
	nodes.forEach((node, k) => {
		if (node.parent >= 0 && moving[node.parent]) moving[k] = 1;
	});
	// The skeleton: the moving nodes and every node above them.
	const inRig = moving.slice();
	for (let k = n - 1; k >= 0; k--) {
		const parent = (nodes[k] as NodeData).parent;
		if (inRig[k] && parent >= 0) inRig[parent] = 1;
	}

	const joints: RigJoint[] = [];
	const jointOf = new Int32Array(n).fill(-1);
	nodes.forEach((node, k) => {
		if (!inRig[k]) return;
		jointOf[k] = joints.length;
		const t = node.transform;
		joints.push({
			name: node.name,
			parent: node.parent >= 0 ? (jointOf[node.parent] as number) : -1,
			translation: [t[0] as number, t[1] as number, t[2] as number],
			rotation: [t[3] as number, t[4] as number, t[5] as number, t[6] as number],
			scale: [t[7] as number, t[8] as number, t[9] as number],
			inverseBind: IDENTITY_BIND,
		});
	});
	const binder = new Binder(joints);

	// Clip tracks named nodes; now they name joints.
	for (const clip of clips)
		for (const track of clip.tracks) track.joint = jointOf[track.joint] as number;
	// Each skin's joints, as the skeleton's joints with the skin's inverse bind matrices.
	const skinJoints = skins.map((skin, s) =>
		used.has(s)
			? skin.joints.map((node, j) => {
					const joint = jointOf[node] as number;
					(joints[joint] as RigJoint).bone = true;
					return binder.bind(joint, skin.binds.subarray(j * 12, j * 12 + 12));
				})
			: [],
	);
	// The joint that moves each mesh without a skin on a moving node, with no inverse bind matrix.
	const rigid = nodes.map((node, k) =>
		node.mesh >= 0 && node.skin < 0 && moving[k]
			? binder.bind(jointOf[k] as number, IDENTITY_BIND)
			: -1,
	);
	if (joints.length > MAX_RIG_JOINTS)
		broken(
			`its skins and clips move ${joints.length} nodes, and the engine's skeletons hold up to ${MAX_RIG_JOINTS}`,
		);

	// The meshes that joints move, as copies whose vertices name the skeleton's joints.
	const copies = new Map<string, number>();
	const copy = (mesh: number, key: string, make: (p: PrimitiveData) => PrimitiveData) => {
		let made = copies.get(key);
		if (made === undefined) {
			const source = meshes[mesh] as MeshData;
			made = meshes.push({ ...source, primitives: source.primitives.map(make) }) - 1;
			copies.set(key, made);
		}
		return made;
	};
	const wide = joints.length > 256;
	nodes.forEach((node, k) => {
		if (node.mesh < 0) return;
		if (node.skin >= 0) {
			const map = skinJoints[node.skin] as number[];
			const name = (meshes[node.mesh] as MeshData).name;
			node.mesh = copy(node.mesh, `skin ${node.skin} ${node.mesh}`, (p) =>
				skinned(p, map, wide, `mesh "${name}" with skin ${node.skin}`, budget, notes),
			);
			node.skinned = true;
		} else if ((rigid[k] as number) >= 0) {
			const joint = rigid[k] as number;
			node.mesh = copy(node.mesh, `joint ${joint} ${node.mesh}`, (p) =>
				onJoint(p, joint, wide, budget, `mesh "${(meshes[node.mesh] as MeshData).name}"`),
			);
			node.skinned = true;
		}
	});

	// Places at rest in the space of the copy's group, for the nodes that leave the tree of objects.
	const worlds: Float64Array[] = [];
	nodes.forEach((node, k) => {
		const local = affineOf(node.transform);
		const parent = node.parent;
		worlds[k] = parent < 0 ? local : multiplyAffine(worlds[parent] as Float64Array, local);
	});
	nodes.forEach((node, k) => {
		node.moving = moving[k] === 1;
		node.joint = jointOf[k] as number;
		node.morphJoint = -1;
		if (inRig[k] || (node.parent >= 0 && inRig[node.parent])) {
			node.transform = decomposeAffine(worlds[k] as Float64Array);
			node.parent = -1;
		}
		if (node.moving && node.light >= 0) {
			notes.push(`the light of node "${node.name}" moves with clips, which lights do not yet`);
			node.light = -1;
		}
		if (node.moving && node.instancing) {
			notes.push(`the instancing of node "${node.name}" moves with clips, and draws at rest`);
		}
	});
	addWeightJoints(clips, nodes, meshes, joints);
	if (joints.length > MAX_RIG_JOINTS)
		broken(
			`its skins and clips need ${joints.length} joints, three morph weights to a joint, and the engine's skeletons hold up to ${MAX_RIG_JOINTS}`,
		);
	return { joints, clips: clips.map(({ weights: _, ...clip }) => clip), skins: skinJoints };
}

/**
 * Gives each node whose morph weights a clip animates the joints that hold them, and adds each
 * clip's weights tracks to its tracks as tracks of those joints.
 */
function addWeightJoints(
	clips: readonly ParsedClip[],
	nodes: NodeData[],
	meshes: readonly MeshData[],
	joints: RigJoint[],
): void {
	for (const clip of clips)
		for (const track of clip.weights) {
			const node = nodes[track.node] as NodeData;
			const targets = (meshes[node.mesh] as MeshData).weights?.length ?? 0;
			const count = Math.ceil(targets / WEIGHTS_PER_JOINT);
			if ((node.morphJoint ?? -1) < 0) {
				node.morphJoint = joints.length;
				for (let j = 0; j < count; j++)
					joints.push({
						name: node.name,
						parent: -1,
						translation: [0, 0, 0],
						rotation: [0, 0, 0, 1],
						scale: [0, 0, 0],
						inverseBind: IDENTITY_BIND,
					});
			}
			const first = node.morphJoint as number;
			for (let j = 0; j < count; j++) {
				clip.tracks.push({
					joint: first + j,
					channel: 'translation',
					interpolation: track.interpolation,
					times: track.times,
					values: jointWeights(track, targets, j),
				});
				// One key of scale 1 marks the weights as the clip's. Each track has arrays of its own,
				// because the worker hands every track's arrays over to the page.
				clip.tracks.push({
					joint: first + j,
					channel: 'scale',
					times: new Float32Array(1),
					values: new Float32Array([1, 1, 1]),
				});
			}
		}
}

/**
 * The keys of joint `j`'s translation from a weights track of `targets` weights per key: weights
 * `3j` to `3j + 2`, with 0 past the last target. A cubic key keeps its in-tangent, value and
 * out-tangent in that order.
 */
function jointWeights(track: WeightTrack, targets: number, j: number): Float32Array {
	const parts = track.interpolation === 'cubic' ? 3 : 1;
	const keys = track.times.length * parts;
	const out = new Float32Array(keys * WEIGHTS_PER_JOINT);
	for (let key = 0; key < keys; key++)
		for (let axis = 0; axis < WEIGHTS_PER_JOINT; axis++) {
			const target = j * WEIGHTS_PER_JOINT + axis;
			if (target < targets)
				out[key * WEIGHTS_PER_JOINT + axis] = track.values[key * targets + target] as number;
		}
	return out;
}

/**
 * Hands out joints with inverse bind matrices: a joint's first matrix is its own, and each other
 * matrix goes to a child joint at rest under it, so a node can carry one per skin that names it.
 */
class Binder {
	private readonly bound = new Set<number>();
	private readonly extra = new Map<number, number[]>();

	constructor(private readonly joints: RigJoint[]) {}

	bind(joint: number, matrix: Float32Array): number {
		const own = this.joints[joint] as RigJoint;
		if (!this.bound.has(joint)) {
			this.bound.add(joint);
			own.inverseBind = matrix;
			return joint;
		}
		if (same(own.inverseBind, matrix)) return joint;
		const children = this.extra.get(joint) ?? [];
		for (const child of children)
			if (same((this.joints[child] as RigJoint).inverseBind, matrix)) return child;
		const child =
			this.joints.push({
				name: own.name,
				parent: joint,
				translation: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				scale: [1, 1, 1],
				inverseBind: matrix,
			}) - 1;
		children.push(child);
		this.extra.set(joint, children);
		return child;
	}
}

function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
	for (let i = 0; i < 12; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** A skin's joints as indices in the node list, and its inverse bind matrices by rows. */
function parseSkin(skin: Entry, s: number, place: Int32Array, read: Reader): SkinData {
	const what = `skin ${s}`;
	const joints = list(skin.joints, `${what}'s joints`).map((j) => {
		const node = place[index(j, place.length, `${what}'s joint`)] as number;
		if (node < 0) broken(`${what} names node ${String(j)}, which is not in the scene`);
		return node;
	});
	if (joints.length === 0) broken(`${what} has no joints`);
	if (new Set(joints).size !== joints.length) broken(`${what} names a node twice`);
	const binds = new Float32Array(joints.length * 12);
	if (skin.inverseBindMatrices === undefined) {
		for (let j = 0; j < joints.length; j++) binds.set(IDENTITY_BIND, j * 12);
		return { joints, binds };
	}
	const data = read(Number(skin.inverseBindMatrices), `${what}'s inverseBindMatrices`);
	if (data.components !== 16 || data.componentType !== FLOAT || data.count < joints.length)
		broken(`${what}'s inverseBindMatrices are not ${joints.length} matrices of 16 floats`);
	const m = data.array as Float32Array;
	for (let j = 0; j < joints.length; j++)
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 4; c++) binds[j * 12 + r * 4 + c] = m[j * 16 + c * 4 + r] as number;
	if (!binds.every(Number.isFinite))
		broken(`${what}'s inverseBindMatrices hold a value that is not a number`);
	return { joints, binds };
}

/**
 * One animation of the file as a clip. Its joint tracks name nodes by their index in the node
 * list, until `parseAnimation` turns them into joints.
 */
function parseClip(
	animation: Entry,
	k: number,
	nodes: readonly NodeData[],
	meshes: readonly MeshData[],
	place: Int32Array,
	read: Reader,
	budget: FileBudget,
	notes: string[],
): ParsedClip {
	const what = `animation ${k}`;
	// three.js's GLTFLoader names an unnamed clip so.
	const name = text(animation.name) || `animation_${k}`;
	const samplers = list(animation.samplers, `${what}'s samplers`).map((s, j) =>
		entry(s, `${what}'s sampler ${j}`),
	);
	const tracks: RigTrack[] = [];
	const weights: WeightTrack[] = [];
	const seen = new Set<string>();
	list(animation.channels, `${what}'s channels`).forEach((value, c) => {
		const channel = entry(value, `${what}'s channel ${c}`);
		const target = entry(channel.target, `${what}'s channel ${c}'s target`);
		const path = text(target.path);
		if (target.node === undefined) {
			notes.push(`${what} moves a property that is not a node's, which the engine does not read`);
			return;
		}
		const node = place[index(target.node, place.length, `${what}'s channel ${c}'s node`)] as number;
		if (path !== 'weights' && !PATHS.has(path))
			broken(`${what}'s channel ${c} has the path ${path}`);
		const key = `${String(target.node)} ${path}`;
		if (seen.has(key)) broken(`${what} moves node ${String(target.node)}'s ${path} twice`);
		seen.add(key);
		// A node outside the scene draws nothing that a clip could move.
		if (node < 0) return;
		const sampler =
			samplers[index(channel.sampler, samplers.length, `${what}'s channel ${c}'s sampler`)];
		const where = `${what}'s sampler ${String(channel.sampler)}`;
		const interpolation = INTERPOLATIONS.get(text(sampler?.interpolation ?? 'LINEAR'));
		if (!interpolation) broken(`${where} has the interpolation ${String(sampler?.interpolation)}`);
		const input = read(Number(sampler?.input), `${where}'s input`, true);
		if (input.components !== SCALAR || input.componentType !== FLOAT)
			broken(`${where}'s input is not one float per key`);
		const times = input.array as Float32Array;
		let last = 0;
		for (const t of times) {
			if (!Number.isFinite(t) || t < last)
				broken(`${where}'s key times are not numbers from 0 up that never fall back`);
			last = t;
		}
		const output = read(Number(sampler?.output), `${where}'s output`, true);
		const values = toFloats(output.array, output.normalized, budget, `${where}'s output`);
		let perKey = path === 'rotation' ? 4 : 3;
		if (path === 'weights') {
			const mesh = (nodes[node] as NodeData).mesh;
			perKey = mesh < 0 ? 0 : ((meshes[mesh] as MeshData).weights?.length ?? 0);
			if (perKey === 0) {
				notes.push(
					`${what} moves the morph weights of node ${String(target.node)}, which has none`,
				);
				return;
			}
		} else if (output.componentType !== FLOAT && path !== 'rotation')
			broken(`${where}'s output is not floats`);
		if (interpolation === 'cubic') perKey *= 3;
		if (values.length !== times.length * perKey)
			broken(`${where}'s output has ${values.length} values for ${times.length} keys of ${perKey}`);
		if (!values.every(Number.isFinite))
			broken(`${where}'s output holds a value that is not a number`);
		if (times.length === 0) return;
		if (path === 'weights') weights.push({ node, interpolation, times, values });
		else
			tracks.push({
				joint: node,
				channel: path as RigTrack['channel'],
				interpolation,
				times,
				values,
			});
	});
	return { name, tracks, weights };
}

/** Gives clips with the same name the suffixes " 2", " 3" and on, so each name finds one clip. */
function uniqueNames(clips: ParsedClip[]): void {
	const taken = new Set<string>();
	for (const clip of clips) {
		let name = clip.name;
		for (let k = 2; taken.has(name); k++) name = `${clip.name} ${k}`;
		clip.name = name;
		taken.add(name);
	}
}

/**
 * The joint indices of a skeleton's size: bytes up to 256 joints, else 16-bit numbers. Each copy
 * takes its bytes from the file's budget.
 */
function jointArray(
	wide: boolean,
	length: number,
	budget: FileBudget,
	what: string,
): Uint8Array | Uint16Array {
	budget.take(length * (wide ? 2 : 1), `the joints of ${what}`);
	return wide ? new Uint16Array(length) : new Uint8Array(length);
}

/** A primitive whose vertices name the skeleton's joints, through `map`, in place of the skin's. */
function skinned(
	p: PrimitiveData,
	map: readonly number[],
	wide: boolean,
	what: string,
	budget: FileBudget,
	notes: string[],
): PrimitiveData {
	if (!p.joints || !p.weights) {
		notes.push(`a primitive of ${what} has no joints or weights, so it does not move`);
		return p;
	}
	const source = p.joints.array;
	const weights = p.weights.array;
	const joints = jointArray(wide, source.length, budget, what);
	for (let i = 0; i < source.length; i++) {
		const j = source[i] as number;
		const joint = map[j];
		if (joint === undefined) {
			// A joint that the vertex gives no weight never moves it.
			if (weights[i] === 0) continue;
			broken(`a vertex of ${what} names joint ${j}, and the skin has ${map.length}`);
		}
		joints[i] = joint;
	}
	return { ...p, joints: { array: joints, normalized: false } };
}

/** A primitive whose every vertex moves with `joint` alone. */
function onJoint(
	p: PrimitiveData,
	joint: number,
	wide: boolean,
	budget: FileBudget,
	what: string,
): PrimitiveData {
	const vertices = p.positions.array.length / 3;
	const joints = jointArray(wide, vertices * 4, budget, what);
	budget.take(vertices * 4, `the weights of ${what}`);
	const weights = new Uint8Array(vertices * 4);
	for (let v = 0; v < vertices; v++) {
		joints[v * 4] = joint;
		weights[v * 4] = 255;
	}
	const out: PrimitiveData = {
		...p,
		joints: { array: joints, normalized: false },
		weights: { array: weights, normalized: true } satisfies VertexData,
	};
	return out;
}
