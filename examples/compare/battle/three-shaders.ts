// Battle's three custom materials in three.js, each the same intent as the null3D half's WGSL:
// grass that sways in the wind, flags that ripple from their poles, and charred steel with embers
// that pulse in its cracks. WebGLRenderer takes them as MeshStandardMaterial with GLSL added in
// onBeforeCompile, as three.js's examples extend built-in materials. WebGPURenderer takes them as
// MeshStandardNodeMaterial with position, emissive and roughness nodes. The materials read the
// simulation's time from a uniform that `setTime` moves, as null3D's shaders read the sketch's.

import type * as ThreeModule from 'three';
import type { Hex } from '../../lib/compare-scene';
import type { Three } from '../../lib/three-worker';

/** The custom materials, and the call that moves their time. */
export interface BattleShaders {
	grass(options: {
		color: Hex;
		roughness: number;
		amount: number;
		speed: number;
	}): ThreeModule.Material;
	flag(options: {
		color: Hex;
		roughness: number;
		amount: number;
		speed: number;
	}): ThreeModule.Material;
	embers(options: {
		color: Hex;
		roughness: number;
		metalness: number;
		ember: Hex;
		glow: number;
	}): ThreeModule.Material;
	setTime(seconds: number): void;
}

/** The name of the instanced attribute that holds each grass clump's phase of the wind. */
export const GRASS_PHASE = 'rowPhase';

/** A clump's phase of the wind from its place, as null3D's shader works it out from the row's. */
export function grassPhase(x: number, z: number): number {
	return x * 0.23 + z * 0.17;
}

const GRASS_GLSL = /* glsl */ `
	float swayT = battleTime * swaySpeed;
	float swayGust = sin( swayT + rowPhase ) + 0.4 * sin( swayT * 2.3 + rowPhase * 1.7 );
	float swayBend = uv.y * uv.y * swayAmount * swayGust;
	transformed += vec3( swayBend * 0.8, - abs( swayBend ) * 0.25, swayBend * 0.6 );
`;

const FLAG_GLSL = /* glsl */ `
	float flagPhase = dot( modelMatrix[ 3 ].xz, vec2( 0.31, 0.19 ) );
	float flagT = battleTime * swaySpeed + flagPhase;
	float flagRipple = sin( flagT - uv.x * 7.0 ) + 0.35 * sin( flagT * 1.9 - uv.x * 13.0 + uv.y * 3.0 );
	transformed += vec3( 0.0, - 0.18 * uv.x * uv.x, flagRipple * swayAmount * uv.x );
`;

export async function battleShaders(
	three: Three,
	renderer: 'webgl' | 'webgpu',
): Promise<BattleShaders> {
	return renderer === 'webgpu' ? nodeShaders(three) : glslShaders(three);
}

function glslShaders(three: Three): BattleShaders {
	const time = { value: 0 };
	const vertexHook =
		(body: string, attributes: string, amount: number, speed: number) =>
		(shader: ThreeModule.WebGLProgramParametersWithUniforms) => {
			shader.uniforms.battleTime = time;
			shader.uniforms.swayAmount = { value: amount };
			shader.uniforms.swaySpeed = { value: speed };
			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <common>',
					`#include <common>\nuniform float battleTime;\nuniform float swayAmount;\nuniform float swaySpeed;\n${attributes}`,
				)
				.replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
		};
	return {
		grass({ color, roughness, amount, speed }) {
			const material = new three.MeshStandardMaterial({
				color,
				roughness,
				metalness: 0,
				side: three.DoubleSide,
			});
			material.onBeforeCompile = vertexHook(
				GRASS_GLSL,
				`attribute float ${GRASS_PHASE};`,
				amount,
				speed,
			);
			material.customProgramCacheKey = () => 'battle-grass';
			return material;
		},
		flag({ color, roughness, amount, speed }) {
			const material = new three.MeshStandardMaterial({
				color,
				roughness,
				metalness: 0,
				side: three.DoubleSide,
			});
			material.onBeforeCompile = vertexHook(FLAG_GLSL, '', amount, speed);
			material.customProgramCacheKey = () => 'battle-flag';
			return material;
		},
		embers({ color, roughness, metalness, ember, glow }) {
			const material = new three.MeshStandardMaterial({ color, roughness, metalness });
			const emberColor = new three.Color(ember);
			material.onBeforeCompile = (shader) => {
				shader.uniforms.battleTime = time;
				shader.uniforms.emberColor = { value: emberColor };
				shader.uniforms.emberGlow = { value: glow };
				shader.vertexShader = shader.vertexShader
					.replace(
						'#include <common>',
						'#include <common>\nvarying vec3 vEmberWorld;\nvarying float vEmberBase;',
					)
					.replace(
						'#include <begin_vertex>',
						'#include <begin_vertex>\nvEmberWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvEmberBase = modelMatrix[ 3 ].y;',
					);
				shader.fragmentShader = shader.fragmentShader
					.replace(
						'#include <common>',
						'#include <common>\nuniform float battleTime;\nuniform vec3 emberColor;\nuniform float emberGlow;\nvarying vec3 vEmberWorld;\nvarying float vEmberBase;',
					)
					.replace(
						'#include <color_fragment>',
						`#include <color_fragment>
	vec3 emberP = vEmberWorld * 2.7;
	float emberA = sin( emberP.x * 1.7 + sin( emberP.z * 2.3 ) ) * sin( emberP.z * 1.9 + sin( emberP.y * 2.9 ) );
	float emberCracks = pow( 1.0 - abs( emberA ), 10.0 );
	float emberPulse = 0.55 + 0.45 * sin( battleTime * 2.6 + emberP.x * 0.7 + emberP.z * 0.5 );
	float emberLow = clamp( 1.4 - ( vEmberWorld.y - vEmberBase ) * 0.6, 0.0, 1.0 );`,
					)
					.replace(
						'#include <roughnessmap_fragment>',
						'#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 1.0, emberCracks );',
					)
					.replace(
						'#include <emissivemap_fragment>',
						'#include <emissivemap_fragment>\ntotalEmissiveRadiance += emberColor * ( emberGlow * emberCracks * emberPulse * emberLow );',
					);
			};
			material.customProgramCacheKey = () => 'battle-embers';
			return material;
		},
		setTime(seconds) {
			time.value = seconds;
		},
	};
}

async function nodeShaders(three: Three): Promise<BattleShaders> {
	const webgpu = three as unknown as typeof import('three/webgpu');
	const tsl = await import('three/tsl');
	const time = tsl.uniform(0);
	const uv = tsl.uv();
	return {
		grass({ color, roughness, amount, speed }) {
			const material = new webgpu.MeshStandardNodeMaterial({
				color,
				roughness,
				metalness: 0,
				side: three.DoubleSide,
			});
			const phase = tsl.attribute(GRASS_PHASE, 'float');
			const t = time.mul(speed);
			const gust = tsl.sin(t.add(phase)).add(tsl.sin(t.mul(2.3).add(phase.mul(1.7))).mul(0.4));
			const bend = uv.y.mul(uv.y).mul(amount).mul(gust);
			material.positionNode = tsl.positionLocal.add(
				tsl.vec3(bend.mul(0.8), bend.abs().mul(-0.25), bend.mul(0.6)),
			);
			return material as unknown as ThreeModule.Material;
		},
		flag({ color, roughness, amount, speed }) {
			const material = new webgpu.MeshStandardNodeMaterial({
				color,
				roughness,
				metalness: 0,
				side: three.DoubleSide,
			});
			const phase = tsl.dot(tsl.modelPosition.xz, tsl.vec2(0.31, 0.19));
			const t = time.mul(speed).add(phase);
			const ripple = tsl
				.sin(t.sub(uv.x.mul(7)))
				.add(tsl.sin(t.mul(1.9).sub(uv.x.mul(13)).add(uv.y.mul(3))).mul(0.35));
			material.positionNode = tsl.positionLocal.add(
				tsl.vec3(0, uv.x.mul(uv.x).mul(-0.18), ripple.mul(amount).mul(uv.x)),
			);
			return material as unknown as ThreeModule.Material;
		},
		embers({ color, roughness, metalness, ember, glow }) {
			const material = new webgpu.MeshStandardNodeMaterial({ color, roughness, metalness });
			const p = tsl.positionWorld.mul(2.7);
			const a = tsl
				.sin(p.x.mul(1.7).add(tsl.sin(p.z.mul(2.3))))
				.mul(tsl.sin(p.z.mul(1.9).add(tsl.sin(p.y.mul(2.9)))));
			const cracks = tsl.pow(tsl.float(1).sub(a.abs()), 10);
			const pulse = tsl
				.sin(time.mul(2.6).add(p.x.mul(0.7)).add(p.z.mul(0.5)))
				.mul(0.45)
				.add(0.55);
			const low = tsl.clamp(
				tsl.float(1.4).sub(tsl.positionWorld.y.sub(tsl.modelPosition.y).mul(0.6)),
				0,
				1,
			);
			const emberColor = new three.Color(ember);
			material.emissiveNode = tsl
				.vec3(emberColor.r, emberColor.g, emberColor.b)
				.mul(cracks.mul(pulse).mul(low).mul(glow));
			material.roughnessNode = tsl.mix(tsl.float(roughness), tsl.float(1), cracks);
			return material as unknown as ThreeModule.Material;
		},
		setTime(seconds) {
			time.value = seconds;
		},
	};
}
