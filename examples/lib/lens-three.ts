// The three.js twin of the lens grade that examples/lib/lens.ts writes for null3D: the same
// offsets, the same streak and the same integer hash, so both engines draw the same effect in the
// same place of the post chain. The WebGLRenderer gets a ShaderPass on the linear HDR color before
// UnrealBloomPass; WebGPURenderer gets a TSL node on the scene color before the bloom node. Both
// take the frame's simulation time, never the wall clock, so a held frame draws the same grain.
import type * as ThreeModule from 'three';
import type { LensSettings } from './lens';

/** The vertex shader that a full-screen pass uses. */
const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The fragment shader: the GLSL twin of the WGSL in examples/lib/lens.ts. */
const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float shift;
uniform float streak;
uniform float grain;
uniform float time;
uniform vec2 resolution;
varying vec2 vUv;
out vec4 fragColor;

uint pcg(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float random2(vec2 p) {
    uvec2 bits = floatBitsToUint(p);
    return float(pcg(bits.x ^ pcg(bits.y)) >> 8u) / 16777216.0;
}

void main() {
    vec2 toward = (vUv - vec2(0.5)) * shift / resolution;
    vec4 center = texture2D(tDiffuse, vUv);
    vec3 color = vec3(texture2D(tDiffuse, vUv + toward).r, center.g, texture2D(tDiffuse, vUv - toward).b);
    vec3 glow = vec3(0.0);
    for (int i = 1; i <= 5; i++) {
        vec2 across = vec2(float(i) * 3.0 / resolution.x, 0.0);
        glow += max(texture2D(tDiffuse, vUv - across).rgb - vec3(1.0), vec3(0.0));
        glow += max(texture2D(tDiffuse, vUv + across).rgb - vec3(1.0), vec3(0.0));
    }
    color += glow / 10.0 * streak * vec3(0.45, 0.65, 1.0);
    vec2 seeded = gl_FragCoord.xy + vec2(floor(time * 24.0) * 37.0, 0.0);
    color *= 1.0 + (random2(seeded) - 0.5) * grain;
    fragColor = vec4(color, center.a);
}
`;

/** A lens pass, with the call that moves its clock. */
export interface LensPass {
	pass: unknown;
	setTime(seconds: number): void;
}

/** The WebGLRenderer's lens pass, on the linear color before bloom. */
export function makeLensPass(
	three: typeof ThreeModule,
	ShaderPass: new (shader: ThreeModule.ShaderMaterial) => unknown,
	settings: LensSettings,
	width: number,
	height: number,
): LensPass {
	const uniforms = {
		tDiffuse: { value: null },
		shift: { value: settings.shift },
		streak: { value: settings.streak },
		grain: { value: settings.grain },
		time: { value: 0 },
		resolution: { value: new three.Vector2(width, height) },
	};
	const material = new three.ShaderMaterial({
		uniforms,
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		glslVersion: three.GLSL3,
		depthTest: false,
		depthWrite: false,
	});
	const pass = new ShaderPass(material) as {
		setSize?: (width: number, height: number) => void;
	};
	pass.setSize = (nextWidth, nextHeight) => {
		uniforms.resolution.value.set(nextWidth, nextHeight);
	};
	return {
		pass,
		setTime: (seconds) => {
			uniforms.time.value = seconds;
		},
	};
}

/** The nodes of three.js's TSL, which has no type declarations of its own. */
type Tsl = any;

/** A node that applies the lens grade to a color node, with a uniform clock. */
export function makeLensNode(
	tsl: Record<string, Tsl>,
	color: Tsl,
	settings: LensSettings,
): { node: Tsl; setTime(seconds: number): void } {
	const { Fn, uniform, uint, vec2, vec3, float, screenUV, screenSize, screenCoordinate } = tsl;
	const clock = uniform(0);

	const pcg = Fn(([v]: [Tsl]) => {
		const state = uint(v).mul(uint(747796405)).add(uint(2891336453));
		const word = state
			.shiftRight(state.shiftRight(uint(28)).add(uint(4)))
			.bitXor(state)
			.mul(uint(277803737));
		return word.shiftRight(uint(22)).bitXor(word);
	});
	const random2 = Fn(([p]: [Tsl]) => {
		const bits = tsl.floatBitsToUint(p);
		return float(pcg(bits.x.bitXor(pcg(bits.y))).shiftRight(uint(8))).div(16777216.0);
	});

	const sample = (uv: Tsl) => color.sample(uv);
	const toward = screenUV.sub(0.5).mul(settings.shift).div(screenSize);
	const center = sample(screenUV);
	let graded = vec3(sample(screenUV.add(toward)).r, center.g, sample(screenUV.sub(toward)).b);
	let glow = vec3(0, 0, 0);
	for (let i = 1; i <= 5; i++) {
		const across = vec2(i * 3, 0).div(screenSize);
		glow = glow.add(tsl.max(sample(screenUV.sub(across)).rgb.sub(1), vec3(0, 0, 0)));
		glow = glow.add(tsl.max(sample(screenUV.add(across)).rgb.sub(1), vec3(0, 0, 0)));
	}
	graded = graded.add(
		glow
			.div(10)
			.mul(settings.streak)
			.mul(vec3(0.45, 0.65, 1)),
	);
	const seeded = screenCoordinate.add(vec2(tsl.floor(clock.mul(24)).mul(37), 0));
	graded = graded.mul(float(1).add(random2(seeded).sub(0.5).mul(settings.grain)));
	return {
		node: tsl.vec4(graded, center.a),
		setTime: (seconds) => {
			clock.value = seconds;
		},
	};
}
