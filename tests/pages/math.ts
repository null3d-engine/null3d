// Runs each math helper in a loop of its own, for the test that checks that the helpers allocate
// nothing. Each loop is a small function with one call of its helper, so the browser optimizes it
// and inlines the helper, as it does in typical per-frame code. The page makes every array once and
// publishes the names of its loops, and the test runs them by name. The loops mix plain arrays and
// typed arrays, as sketches do. The fractions they pass cycle through one range, so a long run
// takes no branch that the warm-up missed.
import { color, mat4, math, quat, vec3 } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		/** Runs the loop of one helper, by its name such as 'vec3.add', for `iterations` calls. */
		__null3dMathCase?: (name: string, iterations: number) => void;
	}
}

const v = vec3.set(vec3.create(), 1.5, -2, 0.75);
const w = new Float64Array([-0.5, 3, 2]);
const out = vec3.create();
const f32 = new Float32Array(3);
const axis = vec3.normalize(vec3.create(), [0, 1, 1]);
const toward = vec3.normalize(new Float64Array(3), [-2, 0.5, 1]);
const q = quat.setAxisAngle(quat.create(), axis, 0.5);
const r = quat.fromEuler(new Float64Array(4), 0.3, -0.2, 0.9);
const turn = new Float32Array(4);
const m = mat4.compose(mat4.create(), v, q, [1, 2, 3]);
const n = new Float64Array(16);
const position = vec3.create();
const rotation = quat.create();
const size = vec3.create();
const rgb = new Float32Array(3);
/** The up directions that the look-at loop passes in turn: its own, and none. */
const ups = [axis, undefined] as const;
/** The hex colors that the hex loop reads in turn, in each form. */
const hexes = [0x4a8cff, '#4a8cff', '#48f'] as const;
/** Where the loops that compute a number keep their sum, so their work is not dead code. */
const sink = new Float64Array(1);

/** One loop per helper, by the helper's name. */
const CASES: Record<string, (iterations: number) => void> = {
	'vec3.set': (k) => {
		for (let i = 0; i < k; i++) vec3.set(out, (i % 1000) * 0.5, 2.5, -1.25);
	},
	'vec3.copy': (k) => {
		for (let i = 0; i < k; i++) vec3.copy(f32, v);
	},
	'vec3.add': (k) => {
		for (let i = 0; i < k; i++) vec3.add(out, v, w);
	},
	'vec3.sub': (k) => {
		for (let i = 0; i < k; i++) vec3.sub(out, v, w);
	},
	'vec3.multiply': (k) => {
		for (let i = 0; i < k; i++) vec3.multiply(f32, v, w);
	},
	'vec3.scale': (k) => {
		for (let i = 0; i < k; i++) vec3.scale(out, v, (i % 1000) * 0.001);
	},
	'vec3.scaleAndAdd': (k) => {
		for (let i = 0; i < k; i++) vec3.scaleAndAdd(out, v, w, (i % 1000) * 0.001);
	},
	'vec3.negate': (k) => {
		for (let i = 0; i < k; i++) vec3.negate(out, v);
	},
	'vec3.dot': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.dot(v, w);
		sink[0] = sum;
	},
	'vec3.cross': (k) => {
		for (let i = 0; i < k; i++) vec3.cross(out, v, w);
	},
	'vec3.length': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.length(v);
		sink[0] = sum;
	},
	'vec3.squaredLength': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.squaredLength(w);
		sink[0] = sum;
	},
	'vec3.distance': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.distance(v, w);
		sink[0] = sum;
	},
	'vec3.squaredDistance': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.squaredDistance(v, w);
		sink[0] = sum;
	},
	'vec3.normalize': (k) => {
		for (let i = 0; i < k; i++) vec3.normalize(out, v);
	},
	'vec3.lerp': (k) => {
		for (let i = 0; i < k; i++) vec3.lerp(f32, v, w, (i % 1000) * 0.001);
	},
	'vec3.min': (k) => {
		for (let i = 0; i < k; i++) vec3.min(out, v, w);
	},
	'vec3.max': (k) => {
		for (let i = 0; i < k; i++) vec3.max(out, v, w);
	},
	'vec3.angle': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += vec3.angle(v, w);
		sink[0] = sum;
	},
	'vec3.transformQuat': (k) => {
		for (let i = 0; i < k; i++) vec3.transformQuat(out, v, q);
	},
	'vec3.transformMat4': (k) => {
		for (let i = 0; i < k; i++) vec3.transformMat4(f32, v, m);
	},

	'quat.set': (k) => {
		for (let i = 0; i < k; i++) quat.set(turn, 0.1, (i % 1000) * 0.001, 0.3, 0.9);
	},
	'quat.copy': (k) => {
		for (let i = 0; i < k; i++) quat.copy(turn, r);
	},
	'quat.identity': (k) => {
		for (let i = 0; i < k; i++) quat.identity(turn);
	},
	'quat.setAxisAngle': (k) => {
		for (let i = 0; i < k; i++) quat.setAxisAngle(turn, axis, (i % 1000) * 0.001);
	},
	'quat.fromEuler': (k) => {
		for (let i = 0; i < k; i++) quat.fromEuler(turn, (i % 1000) * 0.001, 0.2, -0.4, 'YXZ');
	},
	'quat.fromMat4': (k) => {
		for (let i = 0; i < k; i++) quat.fromMat4(turn, m);
	},
	'quat.lookAt': (k) => {
		// One call site, with and without an up direction in turn.
		for (let i = 0; i < k; i++) quat.lookAt(turn, i & 1 ? v : w, i & 1 ? w : v, ups[i & 1]);
	},
	'quat.rotationTo': (k) => {
		for (let i = 0; i < k; i++) quat.rotationTo(turn, axis, toward);
	},
	'quat.multiply': (k) => {
		for (let i = 0; i < k; i++) quat.multiply(turn, q, r);
	},
	'quat.rotateX': (k) => {
		for (let i = 0; i < k; i++) quat.rotateX(turn, q, (i % 1000) * 0.001);
	},
	'quat.rotateY': (k) => {
		for (let i = 0; i < k; i++) quat.rotateY(turn, q, (i % 1000) * 0.001);
	},
	'quat.rotateZ': (k) => {
		for (let i = 0; i < k; i++) quat.rotateZ(turn, q, (i % 1000) * 0.001);
	},
	'quat.invert': (k) => {
		for (let i = 0; i < k; i++) quat.invert(turn, q);
	},
	'quat.normalize': (k) => {
		for (let i = 0; i < k; i++) quat.normalize(turn, r);
	},
	'quat.dot': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += quat.dot(q, r);
		sink[0] = sum;
	},
	'quat.slerp': (k) => {
		// One call site, between distant rotations and between close ones in turn.
		for (let i = 0; i < k; i++) quat.slerp(turn, q, i & 1 ? r : q, (i % 1000) * 0.001);
	},

	'mat4.identity': (k) => {
		for (let i = 0; i < k; i++) mat4.identity(n);
	},
	'mat4.copy': (k) => {
		for (let i = 0; i < k; i++) mat4.copy(n, m);
	},
	'mat4.multiply': (k) => {
		for (let i = 0; i < k; i++) mat4.multiply(n, m, m);
	},
	'mat4.invert': (k) => {
		for (let i = 0; i < k; i++) mat4.invert(n, m);
	},
	'mat4.compose': (k) => {
		for (let i = 0; i < k; i++) mat4.compose(n, v, q, w);
	},
	'mat4.decompose': (k) => {
		for (let i = 0; i < k; i++) mat4.decompose(position, rotation, size, m);
	},

	'math.clamp': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.clamp((i % 1000) * 0.001, 0.2, 0.8);
		sink[0] = sum;
	},
	'math.lerp': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.lerp(1.5, 2.5, (i % 1000) * 0.001);
		sink[0] = sum;
	},
	'math.inverseLerp': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.inverseLerp(1.5, 2.5, (i % 1000) * 0.001);
		sink[0] = sum;
	},
	'math.mapLinear': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.mapLinear((i % 1000) * 0.001, 0, 1, 5.5, 9);
		sink[0] = sum;
	},
	'math.damp': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.damp(sum * 0.5, 10, 4, 1 / 60);
		sink[0] = sum;
	},
	'math.smoothstep': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.smoothstep((i % 1000) * 0.001, 0.2, 0.8);
		sink[0] = sum;
	},
	'math.degToRad': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.degToRad((i % 1000) * 0.5);
		sink[0] = sum;
	},
	'math.radToDeg': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.radToDeg((i % 1000) * 0.001);
		sink[0] = sum;
	},
	'math.euclideanModulo': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.euclideanModulo(-(i % 1000) * 0.001, 0.3);
		sink[0] = sum;
	},
	'math.random': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.random();
		sink[0] = sum;
	},
	'math.seed': (k) => {
		for (let i = 0; i < k; i++) math.seed(i);
	},
	'math.randFloat': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.randFloat(-1.5, 2.5);
		sink[0] = sum;
	},
	'math.randInt': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.randInt(1, 6);
		sink[0] = sum;
	},
	'math.randFloatSpread': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += math.randFloatSpread(2.5);
		sink[0] = sum;
	},

	'color.srgbToLinear': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += color.srgbToLinear((i % 1000) * 0.001);
		sink[0] = sum;
	},
	'color.linearToSrgb': (k) => {
		let sum = 0;
		for (let i = 0; i < k; i++) sum += color.linearToSrgb((i % 1000) * 0.001);
		sink[0] = sum;
	},
	'color.fromSrgb': (k) => {
		for (let i = 0; i < k; i++) color.fromSrgb(rgb, (i % 1000) * 0.001, 0.5, 0.25);
	},
	'color.fromHex': (k) => {
		for (let i = 0; i < k; i++) color.fromHex(i & 1 ? rgb : out, hexes[i % 3] as string | number);
	},
	'color.fromHsl': (k) => {
		for (let i = 0; i < k; i++) color.fromHsl(rgb, (i % 1000) * 0.001, 0.5, 0.4);
	},
};

window.__null3dMathCase = (name, iterations) => CASES[name]?.(iterations);
run('math', async () => ({ cases: Object.keys(CASES) }));
