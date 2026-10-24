// Dense swaying grass for the temporal resolve's quality figures (D-129's method): tufts of curved
// blades in one instance batch, over a flat bank, with rocks. Each blade bends in the wind from the
// sketch's frame number, so every run draws the same picture in the same frame: the resolve's motion
// target has no per-vertex wind, which is the condition that D-129 measured. ?orbit= turns the camera
// around the bank in radians per second, and 0 holds it still. ?taa=0 starts the resolve off, and
// ?frames posts each frame's number.
import { defineSketch, type MeshArrays, quat } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const ORBIT = Number(params.get('orbit') ?? '0.1');
/** Frame rate that reads ?orbit= as radians per second. */
const RATE = 60;
const FRAMES = params.has('frames');
const JITTER = params.get('jitter') !== '0';
const TARGET = [0, 1, -10] as const;
const RADIUS = 9;
/** Tufts on the bank. */
const TUFTS = 6000;
const BLADES = 13;
const SEGMENTS = 3;

const wgsl = /* wgsl */ `
struct Uniforms { phase: f32, wind: vec2f, sway: f32 }

// A tuft's row values: x is its phase in the wind, from 0 to 2 pi, y a value from 0 to 1 that picks
// its tint, and z and w the cosine and sine of its turn about y.

fn vertexOffset(input: VertexInput) -> vec3f {
    let traits = object.values;
    let p = object.position.xz;
    let gust = 0.5 + 0.5 * sin(dot(p, material.wind) * 0.35 - material.phase * 1.6);
    let flutter = sin(material.phase * 2.7 + traits.x + input.position.x * 7.0);
    let bend = input.uv.y * input.uv.y * material.sway * (0.4 + 0.8 * gust + 0.25 * flutter);
    let w = normalize(material.wind);
    let along = vec2f(w.x * traits.z - w.y * traits.w, w.x * traits.w + w.y * traits.z);
    return vec3f(along.x * bend, -0.4 * bend * bend, along.y * bend);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let traits = object.values;
    let dry = smoothstep(0.62, 1.0, traits.y) * input.uv.y;
    s.baseColor *= mix(vec3f(0.8 + 0.4 * traits.y), vec3f(1.7, 1.3, 0.45), dry);
    s.normal = select(input.normal, -input.normal, input.normal.y < 0.0);
    return s;
}
`;

/** A small deterministic generator, so every run makes the same tufts. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** One tuft: blades that lean out from its middle and curve over, as the Creek's grass draws them. */
function tuft(seed: number): MeshArrays {
	const next = random(seed);
	const perBlade = SEGMENTS * 2 + 1;
	const positions = new Float32Array(BLADES * perBlade * 3);
	const normals = new Float32Array(BLADES * perBlade * 3);
	const colors = new Float32Array(BLADES * perBlade * 3);
	const uvs = new Float32Array(BLADES * perBlade * 2);
	const indices: number[] = [];
	for (let b = 0; b < BLADES; b++) {
		const angle = next() * Math.PI * 2;
		const [ox, oz] = [Math.cos(angle), Math.sin(angle)];
		const root = 0.015 + 0.11 * next();
		const height = 0.12 + 0.22 * next() ** 1.5;
		const lean = (0.1 + 0.25 * next()) * height;
		const width = 0.016 + 0.012 * next();
		const twist = angle + Math.PI / 2 + (next() - 0.5) * 0.8;
		const [sx, sz] = [Math.cos(twist), Math.sin(twist)];
		const [fx, fz] = [-sz, sx];
		const length = Math.hypot(fx * 0.35, 1, fz * 0.35);
		const first = b * perBlade;
		for (let j = 0; j <= SEGMENTS; j++) {
			const t = j / SEGMENTS;
			const cx = ox * (root + lean * t * t);
			const cz = oz * (root + lean * t * t);
			const cy = height * (t - 0.15 * t * t);
			const half = (width / 2) * (1 - t) ** 0.9;
			const sides = j === SEGMENTS ? [0] : [-1, 1];
			for (const side of sides) {
				const v = first + (j === SEGMENTS ? SEGMENTS * 2 : j * 2 + (side + 1) / 2);
				positions.set([cx + sx * half * side, cy, cz + sz * half * side], v * 3);
				normals.set([(fx * 0.35) / length, 1 / length, (fz * 0.35) / length], v * 3);
				const shade = 0.3 + 0.7 * t;
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([(side + 1) / 2, t], v * 2);
			}
		}
		for (let j = 0; j < SEGMENTS - 1; j++) {
			const a = first + j * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		indices.push(first + SEGMENTS * 2 - 2, first + SEGMENTS * 2 - 1, first + SEGMENTS * 2);
	}
	return { positions, normals, colors, uvs, indices };
}

const spin = quat.create();

export default defineSketch(({ scene, geometry, materials, post, quality, page, time }) => {
	if (params.has('fixed')) quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	const setResolve = (on: boolean) =>
		post.set({ taa: on ? { feedback: 0.9, jitter: JITTER } : false });
	setResolve(params.get('taa') !== '0');
	scene.setBackground('#9cc4e8');
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.6 });
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.3],
		color: '#fff4e0',
		intensity: 3,
		castShadows: true,
	});
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.05, far: 500 });
	scene.setActiveCamera(camera);
	const ground = materials.standard({ color: '#5d7a3a', roughness: 0.95 });
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: ground,
		receiveShadows: true,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	const grass = materials.shader({
		wgsl,
		color: '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		contactShadows: false,
		uniforms: { phase: 0, wind: [0.8, 0.6], sway: 0.12 },
	});
	const next = random(23);
	const mesh = geometry.fromArrays(tuft(101));
	const batch = scene.createInstances(mesh, TUFTS, {
		material: grass,
		castShadows: true,
		receiveShadows: true,
		values: true,
	});
	const values = batch.values as Float32Array;
	for (let row = 0; row < TUFTS; row++) {
		const x = (next() * 2 - 1) * 20;
		const z = -30 + next() * 26;
		const size = 0.75 + 0.6 * next();
		const turn = next() * Math.PI * 2;
		batch.positions.set([x, -0.02, z], row * 3);
		batch.rotations.set(quat.fromEuler(spin, 0, turn, 0), row * 4);
		batch.scales.set([size, size, size], row * 3);
		values.set([next() * Math.PI * 2, next(), Math.cos(turn), Math.sin(turn)], row * 4);
	}
	batch.markDirty();
	// A few rocks on the bank, so the resolve has solid surfaces beside the grass.
	const rock = materials.standard({ color: '#7a7368', roughness: 0.9 });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1.6 }),
		material: rock,
		position: [-5, 0.4, -13],
		scale: [1, 0.6, 1],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1.1 }),
		material: rock,
		position: [4.5, 0.2, -16],
		scale: [1, 0.7, 1],
	});
	page.onMessage((name) => {
		if (name === 'taa') setResolve(true);
		else if (name === 'taa-off') setResolve(false);
		if (name === 'taa' || name === 'taa-off')
			void scene.warmUp().then(() => page.post('settled', {}));
	});
	return {
		onUpdate() {
			if (FRAMES) page.post('frame', time.frame);
			const seconds = time.frame / RATE;
			grass.set({ phase: seconds });
			const a = 0.35 + ORBIT * seconds;
			camera.setPosition(TARGET[0] + RADIUS * Math.sin(a), 1.7, TARGET[2] + RADIUS * Math.cos(a));
			camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
		},
	};
});
