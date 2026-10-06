// The asset tool's clip step. It puts every track of each animation on the frames that the engine
// stores the clip at, with the engine core's own resampler (`bakeClip` in formats.js), so the
// engine's loader copies the keys instead of resampling them:
//
// - All tracks of a clip share one input of frame times, at the rate the engine would pick: the
//   file's own grid when its keys lie on one of up to 30 keys a second, else 30 keys a second.
// - A rotation that changes keeps a key per frame as four 16-bit normalized integers, the form the
//   engine stores, and meshopt compresses them with its quaternion filter
//   (`MeshoptWithRotationFilter`). Translations, scales and morph weights stay 32-bit floats, as
//   glTF asks, and meshopt compresses them without loss.
// - A track whose value never changes keeps one key, at the clip's last time, so the clip keeps
//   its length in every reader.
// - Step tracks stay step tracks. Cubic spline tracks become linear keys on the curve.
//
// No key and no track is dropped: a clip counts only where it has tracks when it blends, so a
// dropped track would change what the clip means. Channels that target no node, such as those of
// KHR_animation_pointer, stay as they are.
import { PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { bakeClip } from './formats.js';

/** @import { Accessor, Animation, AnimationChannel, AnimationSampler, Document, TypedArray } from '@gltf-transform/core' */
/** @import { ClipTrack } from './formats.js' */

/** The values of one key of each path that moves a node. */
const COMPONENTS = /** @type {const} */ ({ translation: 3, rotation: 4, scale: 3 });

/** Morph weights that the engine core keeps in one track: three, one along each axis. */
const WEIGHTS_PER_TRACK = 3;

/**
 * @typedef {object} ClipReport
 * @property {number} clips The animations whose tracks were put on frames.
 * @property {number} tracks Their channels.
 * @property {number} constant The channels that keep one key.
 */

/**
 * An accessor's values as floats, with normalized integers mapped to -1 to 1 or 0 to 1 as glTF
 * defines them.
 *
 * @param {Accessor} accessor
 */
function floats(accessor) {
	const array = /** @type {TypedArray} */ (accessor.getArray());
	if (array instanceof Float32Array) return array;
	const out = new Float32Array(array.length);
	const scale = !accessor.getNormalized()
		? 1
		: array instanceof Int8Array
			? 127
			: array instanceof Uint8Array
				? 255
				: array instanceof Int16Array
					? 32767
					: 65535;
	for (let i = 0; i < array.length; i++)
		out[i] = Math.max(/** @type {number} */ (array[i]) / scale, -1);
	return out;
}

/**
 * A float accessor of `array`, or a 16-bit normalized one, with `type` elements.
 *
 * @param {Document} doc
 * @param {Float32Array | Int16Array} array
 * @param {import('@gltf-transform/core').GLTF.AccessorType} type
 */
function accessorOf(doc, array, type) {
	return doc
		.createAccessor()
		.setType(type)
		.setArray(/** @type {TypedArray} */ (array))
		.setNormalized(array instanceof Int16Array);
}

/**
 * One channel of an animation that moves a node, as the clip step reads it.
 *
 * @typedef {object} NodeChannel
 * @property {AnimationChannel} channel
 * @property {'translation' | 'rotation' | 'scale' | 'weights'} path
 * @property {number} width Values per key: three or four for a node's transform, the morph target
 *   count for weights.
 * @property {number} first The first of the core's tracks that hold it.
 * @property {number} count The core's tracks that hold it: one, or one per three weights.
 */

/**
 * A channel's new keys, before the step stores them.
 *
 * @typedef {object} BakedChannel
 * @property {Animation} animation
 * @property {AnimationChannel} channel
 * @property {NodeChannel['path']} path
 * @property {Accessor} input The clip's frame times, or its last time for a channel of one key.
 * @property {Float32Array | Int16Array} keys
 * @property {boolean} constant
 */

/** The order of paths among the stored keys, so that like keys sit together and compress well. */
const PATH_ORDER = { translation: 0, scale: 1, weights: 2, rotation: 3 };

/**
 * Puts the tracks of each animation in `doc` on the frames that the engine stores the clip at.
 * The same input gives the same bytes on every machine.
 *
 * @param {Document} doc
 * @returns {ClipReport}
 */
export function bakeClips(doc) {
	const root = doc.getRoot();
	const nodes = root.listNodes();
	const index = new Map(nodes.map((node, k) => [node, k]));
	/** @type {BakedChannel[]} */
	const baked = [];
	let clips = 0;
	for (const animation of root.listAnimations()) {
		const before = baked.length;
		bakeAnimation(doc, animation, index, nodes.length, baked);
		if (baked.length > before) clips++;
	}
	// Keys that change come first, each path's together, then the channels of one key. meshopt and
	// Brotli then find like values next to each other.
	const ordered = baked
		.map((entry, k) => ({ entry, k }))
		.sort(
			(a, b) =>
				Number(a.entry.constant) - Number(b.entry.constant) ||
				PATH_ORDER[a.entry.path] - PATH_ORDER[b.entry.path] ||
				a.k - b.k,
		);
	for (const { entry } of ordered) {
		const { animation, channel, path, input, keys } = entry;
		const old = /** @type {AnimationSampler} */ (channel.getSampler());
		const type = path === 'rotation' ? 'VEC4' : path === 'weights' ? 'SCALAR' : 'VEC3';
		const sampler = doc
			.createAnimationSampler()
			.setInput(input)
			.setOutput(accessorOf(doc, keys, type))
			.setInterpolation(old.getInterpolation() === 'STEP' ? 'STEP' : 'LINEAR');
		animation.addSampler(sampler);
		channel.setSampler(sampler);
	}
	// The samplers that the step replaced. Their accessors go when the pipeline drops unused ones.
	for (const sampler of root.listAnimations().flatMap((a) => a.listSamplers()))
		if (
			sampler
				.listParents()
				.every((parent) => parent.propertyType !== PropertyType.ANIMATION_CHANNEL)
		)
			sampler.dispose();
	return {
		clips,
		tracks: baked.length,
		constant: baked.filter((entry) => entry.constant).length,
	};
}

/**
 * Puts one animation's channels that move nodes on the clip's frames, into `out`.
 *
 * @param {Document} doc
 * @param {Animation} animation
 * @param {Map<import('@gltf-transform/core').Node, number>} index
 * @param {number} nodeCount
 * @param {BakedChannel[]} out
 */
function bakeAnimation(doc, animation, index, nodeCount, out) {
	/** @type {NodeChannel[]} */
	const channels = [];
	/** @type {ClipTrack[]} */
	const tracks = [];
	// Weight tracks name pseudo-joints past the nodes, as the engine's reader gives them joints.
	let weightJoint = nodeCount;
	for (const channel of animation.listChannels()) {
		const node = channel.getTargetNode();
		const path = channel.getTargetPath();
		const sampler = channel.getSampler();
		const input = sampler?.getInput();
		const output = sampler?.getOutput();
		if (!node || !sampler || !input || !output || input.getCount() === 0) continue;
		if (path !== 'translation' && path !== 'rotation' && path !== 'scale' && path !== 'weights')
			continue;
		const interpolation = sampler.getInterpolation();
		const parts = interpolation === 'CUBICSPLINE' ? 3 : 1;
		const times = floats(input);
		const values = floats(output);
		const width = values.length / (times.length * parts);
		if (!Number.isInteger(width) || width === 0) continue;
		const first = tracks.length;
		if (path === 'weights') {
			for (let j = 0; j < Math.ceil(width / WEIGHTS_PER_TRACK); j++)
				tracks.push({
					joint: weightJoint++,
					channel: 'translation',
					interpolation,
					times,
					values: weightSlice(values, width, j),
				});
		} else {
			if (width !== COMPONENTS[path]) continue;
			tracks.push({
				joint: /** @type {number} */ (index.get(node)),
				channel: path,
				interpolation,
				times,
				values,
			});
		}
		channels.push({ channel, path, width, first, count: tracks.length - first });
	}
	if (tracks.length === 0) return;
	const { times, tracks: keys } = bakeClip(tracks, weightJoint);
	const grid = accessorOf(doc, times, 'SCALAR');
	const end = accessorOf(doc, times.slice(-1), 'SCALAR');
	for (const { channel, path, width, first, count } of channels) {
		const own = keys.slice(first, first + count);
		const constant = own.every((k) => k.length === COMPONENTS[keyPath(path)]);
		out.push({
			animation,
			channel,
			path,
			input: constant ? end : grid,
			keys:
				path === 'weights'
					? joinWeights(own, width, constant ? 1 : times.length)
					: /** @type {Float32Array | Int16Array} */ (own[0]),
			constant,
		});
	}
}

/**
 * The path whose key size a core track of `path` has: weights travel as translations.
 *
 * @param {NodeChannel['path']} path
 */
function keyPath(path) {
	return path === 'weights' ? 'translation' : path;
}

/**
 * Weights `3j` to `3j + 2` of each key of a weights track of `width` targets, with 0 past the last
 * target. A cubic key keeps its in-tangent, value and out-tangent in that order.
 *
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} j
 */
function weightSlice(values, width, j) {
	const keys = values.length / width;
	const out = new Float32Array(keys * WEIGHTS_PER_TRACK);
	for (let key = 0; key < keys; key++)
		for (let axis = 0; axis < WEIGHTS_PER_TRACK; axis++) {
			const target = j * WEIGHTS_PER_TRACK + axis;
			if (target < width)
				out[key * WEIGHTS_PER_TRACK + axis] = /** @type {number} */ (values[key * width + target]);
		}
	return out;
}

/**
 * A weights track of `width` targets and `keys` keys from the core's tracks of three weights each.
 * A track that keeps one key, while another of the same weights changes, holds its key at every
 * frame.
 *
 * @param {(Int16Array | Float32Array)[]} tracks
 * @param {number} width
 * @param {number} keys
 */
function joinWeights(tracks, width, keys) {
	const out = new Float32Array(keys * width);
	tracks.forEach((track, j) => {
		const own = track.length / WEIGHTS_PER_TRACK;
		for (let key = 0; key < keys; key++)
			for (let axis = 0; axis < WEIGHTS_PER_TRACK; axis++) {
				const target = j * WEIGHTS_PER_TRACK + axis;
				if (target < width)
					out[key * width + target] = /** @type {number} */ (
						track[Math.min(key, own - 1) * WEIGHTS_PER_TRACK + axis]
					);
			}
	});
	return out;
}

/** The bits of each rotation component under meshopt's quaternion filter. */
const ROTATION_FILTER_BITS = 16;

/**
 * Meshopt compression, as glTF-Transform writes it, with meshopt's quaternion filter on the buffer
 * views that hold only rotation keys of 16-bit integers. The filter stores the three smallest
 * components of each key and rebuilds the fourth, which compresses better than the four integers.
 * glTF-Transform picks a filter for every accessor or for none, and its other filters lose
 * precision in translations and scales. So this class changes the views of rotation keys after
 * glTF-Transform has grouped the accessors, and before it compresses them. It reads three fields
 * that glTF-Transform 4.5.1 keeps for that step; `clips.test.ts` fails if a version changes them.
 */
export class MeshoptWithRotationFilter extends EXTMeshoptCompression {
	/**
	 * @param {any} context glTF-Transform's writer context.
	 * @param {PropertyType} propertyType
	 */
	prewrite(context, propertyType) {
		super.prewrite(context, propertyType);
		if (propertyType === PropertyType.ACCESSOR) this.filterRotations(context);
		return this;
	}

	/**
	 * Gives each buffer view of rotation keys the quaternion filter.
	 *
	 * @param {any} context
	 */
	filterRotations(context) {
		const json = context.jsonDoc.json;
		const rotations = new Set();
		for (const animation of this.document.getRoot().listAnimations())
			for (const channel of animation.listChannels()) {
				const output = channel.getSampler()?.getOutput();
				if (channel.getTargetPath() === 'rotation' && output?.getArray() instanceof Int16Array)
					rotations.add(json.accessors[context.accessorIndexMap.get(output)]);
			}
		const state = writerState(this);
		const views = state._encoderBufferViews;
		for (const key of Object.keys(views)) {
			/** @type {any[]} */
			const defs = state._encoderBufferViewAccessors[key];
			if (defs.length === 0 || !defs.every((def) => rotations.has(def))) continue;
			/** @type {Uint8Array[]} */
			const data = state._encoderBufferViewData[key];
			data.forEach((bytes, k) => {
				const count = /** @type {number} */ (defs[k].count);
				const keys = new Int16Array(bytes.buffer, bytes.byteOffset, count * 4);
				const floats = new Float32Array(count * 4);
				for (let i = 0; i < floats.length; i++) floats[i] = /** @type {number} */ (keys[i]) / 32767;
				data[k] = state._encoder.encodeFilterQuat(floats, count, 8, ROTATION_FILTER_BITS);
			});
			views[key].extensions[EXTMeshoptCompression.EXTENSION_NAME].filter = 'QUATERNION';
		}
	}
}

/**
 * The fields that glTF-Transform's meshopt extension keeps while it writes: its encoder, and the
 * buffer views it builds, with their accessors and data, by a key of its own.
 *
 * @param {EXTMeshoptCompression} extension
 * @returns {any}
 */
const writerState = (extension) => extension;
