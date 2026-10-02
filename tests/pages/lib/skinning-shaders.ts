// The GLSL programs of the skinning page, which `lib/skinning.ts` describes. The skinning
// programs read each character's joint matrices from a float texture, one row of texels per
// character, and blend four of them per vertex. The plain programs draw vertices that transform
// feedback skinned already. Every program reads its vertex inputs at the same locations, so one
// vertex array serves the skinning programs and the transform feedback pass. This module uses no
// browser API, so a check outside the browser can compile the programs too.
import { MAX_CASCADES, SKINNING } from './skinning';

/** Vertex inputs, at the same locations in every program. */
const INPUTS = `
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
`;

/** Linear blend skinning from the joint texture: one row of texels per character. */
const SKIN = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${INPUTS}
layout(location = 2) in uvec4 jointIds;
layout(location = 3) in vec4 weights;
layout(location = 4) in uint character;
uniform sampler2D joints;
vec4 row0;
vec4 row1;
vec4 row2;
void blendJoints() {
	int y = int(character);
	row0 = vec4(0.0);
	row1 = vec4(0.0);
	row2 = vec4(0.0);
	for (int i = 0; i < 4; i++) {
		int x = int(jointIds[i]) * 3;
		float w = weights[i];
		row0 += w * texelFetch(joints, ivec2(x, y), 0);
		row1 += w * texelFetch(joints, ivec2(x + 1, y), 0);
		row2 += w * texelFetch(joints, ivec2(x + 2, y), 0);
	}
}
vec3 skinnedPosition() {
	vec4 p = vec4(position, 1.0);
	return vec3(dot(row0, p), dot(row1, p), dot(row2, p));
}
vec3 skinnedNormal() {
	return normalize(vec3(dot(row0.xyz, normal), dot(row1.xyz, normal), dot(row2.xyz, normal)));
}
`;

const PLAIN = `#version 300 es
precision highp float;
${INPUTS}
`;

/** A vertex shader that only places each vertex, for the shadow passes. */
const depthOnly = (inputs: string, world: string, setup = '') => `${inputs}
uniform mat4 viewProj;
void main() {
	${setup}
	gl_Position = viewProj * vec4(${world}, 1.0);
}
`;

/** A vertex shader that hands the shaded pass each vertex's place and normal in the world. */
const shaded = (inputs: string, world: string, normal: string, setup = '') => `${inputs}
uniform mat4 viewProj;
out vec3 vWorld;
out vec3 vNormal;
void main() {
	${setup}
	vWorld = ${world};
	vNormal = ${normal};
	gl_Position = viewProj * vec4(vWorld, 1.0);
}
`;

const SHADERS = {
	skinnedDepth: depthOnly(SKIN, 'skinnedPosition()', 'blendJoints();'),
	skinnedShaded: shaded(SKIN, 'skinnedPosition()', 'skinnedNormal()', 'blendJoints();'),
	skinOnly: `${SKIN}
out vec3 skinned;
out vec3 skinnedDirection;
void main() {
	blendJoints();
	skinned = skinnedPosition();
	skinnedDirection = skinnedNormal();
	gl_Position = vec4(0.0);
	gl_PointSize = 1.0;
}
`,
	plainDepth: depthOnly(PLAIN, 'position'),
	plainShaded: shaded(PLAIN, 'position', 'normal'),
	empty: `#version 300 es
precision mediump float;
void main() {}
`,
	lit: `#version 300 es
precision highp float;
precision highp sampler2DArrayShadow;
uniform sampler2DArrayShadow shadowMap;
uniform mat4 cascadeViewProj[${MAX_CASCADES}];
uniform vec4 cascadeEnd;
uniform vec4 cascadeTexel;
uniform int cascades;
uniform vec3 eye;
uniform vec3 forward;
uniform vec3 toLight;
uniform vec3 albedo;
in vec3 vWorld;
in vec3 vNormal;
out vec4 color;
const float TEXEL = 1.0 / ${SKINNING.shadowMapSize}.0;
float lit(vec3 n) {
	float depth = dot(vWorld - eye, forward);
	int k = cascades;
	for (int i = ${MAX_CASCADES - 1}; i >= 0; i--)
		if (i < cascades && depth <= cascadeEnd[i]) k = i;
	if (k >= cascades) return 1.0;
	vec4 clip = cascadeViewProj[k] * vec4(vWorld + n * (1.5 * cascadeTexel[k]), 1.0);
	vec3 s = clip.xyz * 0.5 + 0.5;
	float layer = float(k);
	float sum = texture(shadowMap, vec4(s.xy + vec2(-0.5, -0.5) * TEXEL, layer, s.z));
	sum += texture(shadowMap, vec4(s.xy + vec2(0.5, -0.5) * TEXEL, layer, s.z));
	sum += texture(shadowMap, vec4(s.xy + vec2(-0.5, 0.5) * TEXEL, layer, s.z));
	sum += texture(shadowMap, vec4(s.xy + vec2(0.5, 0.5) * TEXEL, layer, s.z));
	return 0.25 * sum;
}
void main() {
	vec3 n = normalize(vNormal);
	float shade = max(dot(n, toLight), 0.0) * lit(n);
	vec3 halfway = normalize(toLight + normalize(eye - vWorld));
	float shine = pow(max(dot(n, halfway), 0.0), 32.0) * shade;
	vec3 c = albedo * (0.25 + 0.75 * shade) + vec3(0.2 * shine);
	color = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}
`,
};

/** A program: its vertex and fragment shaders, and the outputs that transform feedback captures. */
export interface SkinningProgram {
	vertex: string;
	fragment: string;
	captured?: string[];
}

/** Every program of the page, by name. */
export const SKINNING_PROGRAMS = {
	skinnedDepth: { vertex: SHADERS.skinnedDepth, fragment: SHADERS.empty },
	skinnedShaded: { vertex: SHADERS.skinnedShaded, fragment: SHADERS.lit },
	skinOnly: {
		vertex: SHADERS.skinOnly,
		fragment: SHADERS.empty,
		captured: ['skinned', 'skinnedDirection'],
	},
	plainDepth: { vertex: SHADERS.plainDepth, fragment: SHADERS.empty },
	plainShaded: { vertex: SHADERS.plainShaded, fragment: SHADERS.lit },
} as const satisfies Record<string, SkinningProgram>;

export type SkinningProgramName = keyof typeof SKINNING_PROGRAMS;
