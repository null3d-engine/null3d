// Battle's custom materials in three.js, each the same intent as the null3D half's WGSL: the
// ground's layers, the units' surfaces, grass that sways in the wind, flags that ripple from their poles, and charred
// steel with embers that pulse in its cracks. WebGLRenderer takes them as MeshStandardMaterial with GLSL added in
// onBeforeCompile, as three.js's examples extend built-in materials. WebGPURenderer takes them as
// MeshStandardNodeMaterial with position, emissive and roughness nodes. The materials read the
// simulation's time from a uniform that `setTime` moves, as null3D's shaders read the sketch's.

import type * as ThreeModule from 'three';
import type * as TSL from 'three/tsl';
import type * as WebGPU from 'three/webgpu';
import type { Hex } from '../../lib/compare-scene';
import type { Three } from '../../lib/three-worker';
import { GROUND_LOOK, linearColor, UNIT_LOOK } from './scene';

/** The look of one kind of unit's surface: a soldier's, a mech's or a rifle's. */
export type UnitSurfaceLook = (typeof UNIT_LOOK)['soldier' | 'mech' | 'rifle'];

/** A unit surface's detail texture: its color map, with heights in alpha, and its normal map. */
export interface DetailMaps {
	color: ThreeModule.Texture;
	normal: ThreeModule.Texture;
}

/** The unit shader's values, linear, as both engines' uniforms take them. */
function unitValues(look: UnitSurfaceLook, tint: Hex) {
	return {
		tint: linearColor(tint),
		detailScale: look.detailScale,
		mud: linearColor(UNIT_LOOK.mud),
		mudHeight: look.mudHeight,
		rim: linearColor(UNIT_LOOK.rim.color, UNIT_LOOK.rim.strength),
		shade: UNIT_LOOK.shade,
		glow: linearColor(UNIT_LOOK.glow.color, UNIT_LOOK.glow.strength),
		saturation: UNIT_LOOK.saturation,
		panels: look.panels,
	};
}

/** The ground's layers: each one's color map, with its heights in alpha, and its normal map. */
export type GroundMaps = Record<
	keyof typeof GROUND_LOOK.layers,
	{ color: ThreeModule.Texture; normal: ThreeModule.Texture }
>;

/** The custom materials, and the call that moves their time. */
export interface BattleShaders {
	ground(maps: GroundMaps): ThreeModule.Material;
	/** A unit's surface: a soldier's or a mech's in an army's tint, or a rifle's. */
	unit(look: UnitSurfaceLook, tint: Hex, maps: DetailMaps): ThreeModule.Material;
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

/**
 * The ground's mix, in GLSL, after three.js has read the vertex colors: it sets the base color,
 * the roughness and a world normal, which later chunks take.
 */
const GROUND_GLSL = /* glsl */ `
	vec2 groundP = vGroundWorld.xz;
	vec4 groundLayers = vColor;
	vec2 gp = groundP * grassRepeat;
	vec2 ep = groundP * earthRepeat;
	vec2 rp = groundP * rockRepeat;
	vec4 grassTexel = texture2D( grassColor, gp );
	vec4 soilTexel = texture2D( earthColor, ep );
	vec4 rockTexel = texture2D( rockColor, rp );
	vec3 grassBump = texture2D( grassNormal, gp ).xyz * 2.0 - 1.0;
	vec3 soilBump = texture2D( earthNormal, ep ).xyz * 2.0 - 1.0;
	vec3 rockBump = texture2D( rockNormal, rp ).xyz * 2.0 - 1.0;
	float groundBroad = texture2D( earthColor, groundP * 0.011 ).a;
	float grassShare = clamp( groundLayers.r * 1.8 - 0.4 + ( grassTexel.a - soilTexel.a ) * 0.9, 0.0, 1.0 );
	vec3 blade = grassTexel.rgb * mix( groundLush, groundDry, groundLayers.a );
	vec3 groundMix = mix( soilTexel.rgb * groundEarth, blade, grassShare );
	vec3 groundBump = mix( soilBump, grassBump, grassShare );
	float groundRough = mix( 0.93, 0.85, grassShare );
	float mudShare = clamp( groundLayers.g * 1.6 - 0.3 + ( 0.5 - soilTexel.a ) * 0.8, 0.0, 1.0 );
	groundMix = mix( groundMix, soilTexel.rgb * groundMud, mudShare );
	groundBump = mix( groundBump, vec3( 0.0, 0.0, 1.0 ), mudShare * 0.7 );
	groundRough = mix( groundRough, 0.35, mudShare );
	float scorchShare = clamp( groundLayers.b * 1.5 - 0.2 + ( soilTexel.a - 0.5 ) * 0.6, 0.0, 1.0 );
	groundMix = mix( groundMix, soilTexel.rgb * groundScorch, scorchShare );
	groundRough = mix( groundRough, 0.97, scorchShare );
	vec3 groundN = normalize( vGroundNormal );
	float steep = 1.0 - groundN.y;
	float rockShare = clamp( ( steep - 0.2 ) * 5.0 + ( vGroundWorld.y - 40.0 ) / 60.0 + rockTexel.a - 0.5, 0.0, 1.0 );
	groundMix = mix( groundMix, rockTexel.rgb * groundStone, rockShare );
	groundBump = mix( groundBump, rockBump, rockShare );
	groundRough = mix( groundRough, 0.85, rockShare );
	vec3 groundTangent = normalize( vec3( 1.0, 0.0, 0.0 ) - groundN * groundN.x );
	vec3 groundNormal = normalize( groundTangent * groundBump.x + cross( groundTangent, groundN ) * groundBump.y + groundN * groundBump.z );
	diffuseColor.rgb = groundMix * ( 0.75 + 0.5 * groundBroad );
`;

/**
 * The units' surfaces in GLSL, after three.js has read the vertex colors: the base color, the
 * roughness and metalness, and the shares that the normal and the emissive chunks take.
 */
const UNIT_GLSL = /* glsl */ `
	float unitPart = vColor.a;
	float unitSkin = clamp( 1.0 - abs( unitPart ) * 5.0, 0.0, 1.0 );
	float unitGlow = clamp( 1.0 - abs( unitPart - 0.2 ) * 5.0, 0.0, 1.0 );
	float unitRubber = clamp( 1.0 - abs( unitPart - 0.4 ) * 5.0, 0.0, 1.0 );
	float unitMetal = clamp( 1.0 - abs( unitPart - 0.6 ) * 5.0, 0.0, 1.0 );
	float unitPaint = clamp( 1.0 - abs( unitPart - 0.8 ) * 5.0, 0.0, 1.0 );
	float unitCloth = clamp( 1.0 - abs( unitPart - 1.0 ) * 5.0, 0.0, 1.0 );
	vec2 unitUv = vUnitUv * detailScale;
	vec4 unitDetail = texture2D( detailColor, unitUv );
	vec3 unitBump = texture2D( detailNormal, unitUv ).xyz * 2.0 - 1.0;
	float unitWear = texture2D( detailColor, vUnitUv * 0.31 ).a;
	float unitSpeck = texture2D( detailColor, vUnitUv * 1.7 + 0.37 ).a;
	vec3 unitBase = vColor.rgb;
	unitBase = mix( vec3( dot( unitBase, vec3( 0.2126, 0.7152, 0.0722 ) ) ), unitBase, unitSaturation );
	unitBase *= unitShade * mix( vec3( 1.0 ), unitTint, unitCloth + unitPaint );
	unitBase *= mix( 1.0, unitDetail.r * 1.25, unitCloth + unitPanels * unitPaint );
	unitBase = mix( unitBase, unitBase * 1.45, unitCloth * smoothstep( 0.62, 0.8, unitWear ) );
	float unitSeam = unitPanels * unitPaint * ( 1.0 - smoothstep( 0.03, 0.1, unitDetail.a ) );
	float unitWorn = unitPanels * ( 1.0 - smoothstep( 0.08, 0.2, unitDetail.a ) ) * smoothstep( 0.45, 0.7, unitWear );
	float unitChip = unitPaint * clamp( smoothstep( 0.72, 0.8, unitSpeck ) + unitWorn - unitSeam, 0.0, 1.0 );
	unitBase = mix( unitBase * ( 1.0 - 0.7 * unitSeam ), vec3( 0.3, 0.29, 0.27 ), unitChip );
	float unitHeight = vUnitWorld.y - vUnitBase.y;
	float unitMudOn = min( mudHeight * 100.0, 1.0 );
	float unitMudLine = max( mudHeight, 0.01 ) * ( 0.7 + 0.6 * unitWear );
	float unitMud = unitMudOn * ( 1.0 - unitSkin - unitGlow ) * ( 1.0 - smoothstep( unitMudLine * 0.6, unitMudLine, unitHeight ) );
	unitBase = mix( unitBase, unitMudColor * ( 0.8 + 0.4 * unitSpeck ), unitMud * 0.85 );
	unitBase *= 1.0 - unitMudOn * ( 1.0 - unitGlow ) * 0.6 * smoothstep( 0.72, 0.9, unitWear );
	diffuseColor.rgb = unitBase;
	float unitMetalness = clamp( unitMetal * 0.85 + unitChip * 0.8, 0.0, 1.0 ) * ( 1.0 - unitMud );
	float unitRough = unitSkin * 0.55 + unitGlow * 0.4 + unitRubber * 0.7 + unitMetal * ( 0.3 + 0.35 * unitWear )
		+ unitPaint * ( 0.5 + 0.25 * unitWear ) + unitCloth * 0.92;
	unitRough = mix( mix( unitRough, 0.35, unitChip ), 0.95, unitMud );
`;

/** The detail map's normal, through a frame from the screen-space change of position and uv. */
const UNIT_NORMAL_GLSL = /* glsl */ `
	vec3 unitN = normal;
	vec3 unitP = - vViewPosition;
	vec3 unitDp1 = dFdx( unitP );
	vec3 unitDp2 = dFdy( unitP );
	vec2 unitDuv1 = dFdx( unitUv );
	vec2 unitDuv2 = dFdy( unitUv );
	vec3 unitDp2perp = cross( unitDp2, unitN );
	vec3 unitDp1perp = cross( unitN, unitDp1 );
	vec3 unitT = unitDp2perp * unitDuv1.x + unitDp1perp * unitDuv2.x;
	vec3 unitB = unitDp2perp * unitDuv1.y + unitDp1perp * unitDuv2.y;
	float unitAcross = inversesqrt( max( max( dot( unitT, unitT ), dot( unitB, unitB ) ), 1e-20 ) );
	vec3 unitBumped = normalize( unitT * ( unitAcross * unitBump.x ) + unitB * ( unitAcross * unitBump.y ) + unitN * unitBump.z );
	normal = normalize( mix( unitN, unitBumped, ( unitCloth + unitPanels * unitPaint ) * ( 1.0 - 0.6 * unitMud ) ) );
`;

const UNIT_EMISSIVE_GLSL = /* glsl */ `
	float unitPulse = 0.75 + 0.25 * sin( battleTime * 3.0 + vUnitBase.x * 0.7 );
	float unitFacing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
	totalEmissiveRadiance += unitGlowColor * ( unitGlow * unitPulse ) + unitRim * ( pow( 1.0 - unitFacing, 3.0 ) * ( 1.0 - unitGlow ) );
`;

/** The units' surfaces as TSL nodes, from the unit's tint and the place of its feet. */
export function unitNodes(
	tsl: typeof TSL,
	look: UnitSurfaceLook,
	maps: DetailMaps,
	tint: WebGPU.Node<'vec3'>,
	feet: WebGPU.Node<'vec3'>,
	time: WebGPU.Node<'float'>,
) {
	const v = unitValues(look, '#ffffff');
	const vec = (c: readonly number[]) => tsl.vec3(c[0] as number, c[1] as number, c[2] as number);
	const color = tsl.attribute('color', 'vec4');
	const part = color.w;
	const share = (code: number) => tsl.clamp(tsl.float(1).sub(part.sub(code).abs().mul(5)), 0, 1);
	const skin = share(0);
	const glow = share(0.2);
	const rubber = share(0.4);
	const metal = share(0.6);
	const paint = share(0.8);
	const cloth = share(1);
	const uv0 = tsl.uv();
	const uv = uv0.mul(v.detailScale);
	const detail = tsl.texture(maps.color, uv);
	const wear = tsl.texture(maps.color, uv0.mul(0.31)).a;
	const speck = tsl.texture(maps.color, uv0.mul(1.7).add(0.37)).a;
	const luma = tsl.dot(color.xyz, tsl.vec3(0.2126, 0.7152, 0.0722));
	let base = tsl
		.mix(tsl.vec3(luma), color.xyz, v.saturation)
		.mul(v.shade)
		.mul(tsl.mix(tsl.vec3(1), tint, cloth.add(paint)));
	base = base.mul(tsl.mix(tsl.float(1), detail.r.mul(1.25), cloth.add(paint.mul(v.panels))));
	base = tsl.mix(base, base.mul(1.45), cloth.mul(tsl.smoothstep(0.62, 0.8, wear)));
	const seam = paint.mul(v.panels).mul(tsl.float(1).sub(tsl.smoothstep(0.03, 0.1, detail.a)));
	const worn = tsl
		.float(1)
		.sub(tsl.smoothstep(0.08, 0.2, detail.a))
		.mul(tsl.smoothstep(0.45, 0.7, wear))
		.mul(v.panels);
	const chip = paint.mul(tsl.clamp(tsl.smoothstep(0.72, 0.8, speck).add(worn).sub(seam), 0, 1));
	base = tsl.mix(base.mul(tsl.float(1).sub(seam.mul(0.7))), tsl.vec3(0.3, 0.29, 0.27), chip);
	const height = tsl.positionWorld.y.sub(feet.y);
	const mudOn = Math.min(v.mudHeight * 100, 1);
	const mudLine = wear.mul(0.6).add(0.7).mul(Math.max(v.mudHeight, 0.01));
	const mud = tsl
		.float(1)
		.sub(skin)
		.sub(glow)
		.mul(tsl.float(1).sub(tsl.smoothstep(mudLine.mul(0.6), mudLine, height)))
		.mul(mudOn);
	base = tsl.mix(base, vec(v.mud).mul(speck.mul(0.4).add(0.8)), mud.mul(0.85));
	base = base.mul(
		tsl.float(1).sub(
			tsl
				.float(1)
				.sub(glow)
				.mul(tsl.smoothstep(0.72, 0.9, wear))
				.mul(0.6 * mudOn),
		),
	);
	const metalness = tsl.clamp(metal.mul(0.85).add(chip.mul(0.8)), 0, 1).mul(tsl.float(1).sub(mud));
	const rough = skin
		.mul(0.55)
		.add(glow.mul(0.4))
		.add(rubber.mul(0.7))
		.add(metal.mul(wear.mul(0.35).add(0.3)))
		.add(paint.mul(wear.mul(0.25).add(0.5)))
		.add(cloth.mul(0.92));
	const roughness = tsl.mix(tsl.mix(rough, tsl.float(0.35), chip), tsl.float(0.95), mud);
	// The normal map node gives a view-space normal; its type is not a vec3 node in three's types.
	const bumped = tsl.normalMap(tsl.texture(maps.normal, uv)) as unknown as WebGPU.Node<'vec3'>;
	const normal = tsl.normalize(
		tsl.mix(
			tsl.normalView,
			bumped,
			cloth.add(paint.mul(v.panels)).mul(tsl.float(1).sub(mud.mul(0.6))),
		),
	);
	const pulse = tsl
		.sin(time.mul(3).add(feet.x.mul(0.7)))
		.mul(0.25)
		.add(0.75);
	const facing = tsl.clamp(tsl.dot(normal, tsl.positionViewDirection), 0, 1);
	const emissive = vec(v.glow)
		.mul(glow.mul(pulse))
		.add(vec(v.rim).mul(tsl.pow(tsl.float(1).sub(facing), 3).mul(tsl.float(1).sub(glow))));
	return { color: base, roughness, metalness, normal, emissive };
}

/** The ground's uniforms: each layer's tiles per meter and the tints, as three.js takes them. */
function groundUniforms(three: Three) {
	const { layers, tints } = GROUND_LOOK;
	return {
		grassRepeat: layers.grass.repeat,
		earthRepeat: layers.earth.repeat,
		rockRepeat: layers.rock.repeat,
		groundLush: new three.Color(tints.lush),
		groundDry: new three.Color(tints.dry),
		groundEarth: new three.Color(tints.earth),
		groundMud: new three.Color(tints.mud),
		groundScorch: new three.Color(tints.scorch),
		groundStone: new three.Color(tints.stone),
	};
}

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
		unit(look, tint, maps) {
			// The vertex colors hold each part's color and surface class, which the shader reads.
			const material = new three.MeshStandardMaterial({ vertexColors: true });
			const values = unitValues(look, tint);
			const uniforms: Record<string, unknown> = {
				unitTint: new three.Color(...values.tint),
				detailScale: values.detailScale,
				unitMudColor: new three.Color(...values.mud),
				mudHeight: values.mudHeight,
				unitRim: new three.Color(...values.rim),
				unitShade: values.shade,
				unitGlowColor: new three.Color(...values.glow),
				unitSaturation: values.saturation,
				unitPanels: values.panels,
				detailColor: maps.color,
				detailNormal: maps.normal,
			};
			material.onBeforeCompile = (shader) => {
				for (const [name, value] of Object.entries(uniforms)) shader.uniforms[name] = { value };
				shader.uniforms.battleTime = time;
				shader.vertexShader = shader.vertexShader
					.replace(
						'#include <common>',
						'#include <common>\nvarying vec3 vUnitWorld;\nvarying vec3 vUnitBase;\nvarying vec2 vUnitUv;',
					)
					.replace(
						'#include <skinning_vertex>',
						'#include <skinning_vertex>\nvUnitWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvUnitBase = modelMatrix[ 3 ].xyz;\nvUnitUv = uv;',
					);
				shader.fragmentShader = shader.fragmentShader
					.replace(
						'#include <common>',
						`#include <common>
varying vec3 vUnitWorld;
varying vec3 vUnitBase;
varying vec2 vUnitUv;
uniform float battleTime;
uniform vec3 unitTint;
uniform float detailScale;
uniform vec3 unitMudColor;
uniform float mudHeight;
uniform vec3 unitRim;
uniform float unitShade;
uniform vec3 unitGlowColor;
uniform float unitSaturation;
uniform float unitPanels;
uniform sampler2D detailColor;
uniform sampler2D detailNormal;`,
					)
					.replace('#include <color_fragment>', UNIT_GLSL)
					.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = unitRough;')
					.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = unitMetalness;')
					.replace('#include <normal_fragment_maps>', UNIT_NORMAL_GLSL)
					.replace(
						'#include <emissivemap_fragment>',
						`#include <emissivemap_fragment>\n${UNIT_EMISSIVE_GLSL}`,
					);
			};
			material.customProgramCacheKey = () => 'battle-unit';
			return material;
		},
		ground(maps) {
			// The vertex colors hold the layers' shares, which the mix reads in place of a tint.
			const material = new three.MeshStandardMaterial({ vertexColors: true });
			const values = groundUniforms(three);
			material.onBeforeCompile = (shader) => {
				for (const [name, value] of Object.entries(values)) shader.uniforms[name] = { value };
				for (const [layer, { color, normal }] of Object.entries(maps)) {
					shader.uniforms[`${layer}Color`] = { value: color };
					shader.uniforms[`${layer}Normal`] = { value: normal };
				}
				shader.vertexShader = shader.vertexShader
					.replace(
						'#include <common>',
						'#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormal;',
					)
					.replace(
						'#include <begin_vertex>',
						'#include <begin_vertex>\nvGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGroundNormal = normalize( mat3( modelMatrix ) * objectNormal );',
					);
				shader.fragmentShader = shader.fragmentShader
					.replace(
						'#include <common>',
						`#include <common>
varying vec3 vGroundWorld;
varying vec3 vGroundNormal;
uniform float grassRepeat;
uniform float earthRepeat;
uniform float rockRepeat;
uniform vec3 groundLush;
uniform vec3 groundDry;
uniform vec3 groundEarth;
uniform vec3 groundMud;
uniform vec3 groundScorch;
uniform vec3 groundStone;
${Object.keys(maps)
	.map((layer) => `uniform sampler2D ${layer}Color;\nuniform sampler2D ${layer}Normal;`)
	.join('\n')}`,
					)
					.replace('#include <color_fragment>', GROUND_GLSL)
					.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = groundRough;')
					.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
					.replace(
						'#include <normal_fragment_maps>',
						'normal = normalize( ( viewMatrix * vec4( groundNormal, 0.0 ) ).xyz );',
					);
			};
			material.customProgramCacheKey = () => 'battle-ground';
			return material;
		},
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
	float emberCracks = pow( 1.0 - abs( emberA ), 22.0 );
	float emberPulse = 0.55 + 0.45 * sin( battleTime * 2.6 + emberP.x * 0.7 + emberP.z * 0.5 );
	float emberLow = clamp( 1.4 - ( vEmberWorld.y - vEmberBase ) * 0.6, 0.0, 1.0 );
	float emberPatches = smoothstep( 0.25, 0.85, sin( emberP.x * 0.45 + 1.3 ) * sin( emberP.z * 0.5 + emberP.y * 0.3 ) );`,
					)
					.replace(
						'#include <roughnessmap_fragment>',
						'#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 1.0, emberCracks );',
					)
					.replace(
						'#include <emissivemap_fragment>',
						'#include <emissivemap_fragment>\ntotalEmissiveRadiance += emberColor * ( emberGlow * emberCracks * emberPulse * emberLow * emberPatches );',
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
		unit(look, tint, maps) {
			const material = new webgpu.MeshStandardNodeMaterial();
			const nodes = unitNodes(
				tsl,
				look,
				maps,
				tsl.vec3(...linearColor(tint)),
				tsl.modelPosition,
				time,
			);
			material.colorNode = nodes.color;
			material.roughnessNode = nodes.roughness;
			material.metalnessNode = nodes.metalness;
			material.normalNode = nodes.normal;
			material.emissiveNode = nodes.emissive;
			return material as unknown as ThreeModule.Material;
		},
		ground(maps) {
			const material = new webgpu.MeshStandardNodeMaterial();
			const values = groundUniforms(three);
			const tint = (color: ThreeModule.Color) => tsl.vec3(color.r, color.g, color.b);
			const p = tsl.positionWorld.xz;
			const layers = tsl.attribute('color', 'vec4');
			const gp = p.mul(values.grassRepeat);
			const ep = p.mul(values.earthRepeat);
			const rp = p.mul(values.rockRepeat);
			const grass = tsl.texture(maps.grass.color, gp);
			const soil = tsl.texture(maps.earth.color, ep);
			const rock = tsl.texture(maps.rock.color, rp);
			const bump = (texture: ThreeModule.Texture, at: typeof p) =>
				tsl.texture(texture, at).xyz.mul(2).sub(1);
			const broad = tsl.texture(maps.earth.color, p.mul(0.011)).a;
			const grassShare = tsl.clamp(
				layers.r.mul(1.8).sub(0.4).add(grass.a.sub(soil.a).mul(0.9)),
				0,
				1,
			);
			const blade = grass.rgb.mul(
				tsl.mix(tint(values.groundLush), tint(values.groundDry), layers.a),
			);
			const mudShare = tsl.clamp(
				layers.g.mul(1.6).sub(0.3).add(tsl.float(0.5).sub(soil.a).mul(0.8)),
				0,
				1,
			);
			const scorchShare = tsl.clamp(layers.b.mul(1.5).sub(0.2).add(soil.a.sub(0.5).mul(0.6)), 0, 1);
			// The ground stands at the origin unturned, so its own normal is the world's.
			const n = tsl.normalLocal;
			const rockShare = tsl.clamp(
				tsl
					.float(1)
					.sub(n.y)
					.sub(0.2)
					.mul(5)
					.add(tsl.positionWorld.y.sub(40).div(60))
					.add(rock.a)
					.sub(0.5),
				0,
				1,
			);
			let color = tsl.mix(soil.rgb.mul(tint(values.groundEarth)), blade, grassShare);
			color = tsl.mix(color, soil.rgb.mul(tint(values.groundMud)), mudShare);
			color = tsl.mix(color, soil.rgb.mul(tint(values.groundScorch)), scorchShare);
			color = tsl.mix(color, rock.rgb.mul(tint(values.groundStone)), rockShare);
			let rough = tsl.mix(tsl.float(0.93), tsl.float(0.85), grassShare);
			rough = tsl.mix(rough, tsl.float(0.35), mudShare);
			rough = tsl.mix(rough, tsl.float(0.97), scorchShare);
			rough = tsl.mix(rough, tsl.float(0.85), rockShare);
			let b = tsl.mix(bump(maps.earth.normal, ep), bump(maps.grass.normal, gp), grassShare);
			b = tsl.mix(b, tsl.vec3(0, 0, 1), mudShare.mul(0.7));
			b = tsl.mix(b, bump(maps.rock.normal, rp), rockShare);
			const tangent = tsl.normalize(tsl.vec3(1, 0, 0).sub(n.mul(n.x)));
			const world = tsl.normalize(
				tangent.mul(b.x).add(tsl.cross(tangent, n).mul(b.y)).add(n.mul(b.z)),
			);
			material.colorNode = color.mul(broad.mul(0.5).add(0.75));
			material.roughnessNode = rough;
			material.metalnessNode = tsl.float(0);
			material.normalNode = tsl.normalize(tsl.cameraViewMatrix.mul(tsl.vec4(world, 0)).xyz);
			return material as unknown as ThreeModule.Material;
		},
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
			const cracks = tsl.pow(tsl.float(1).sub(a.abs()), 22);
			const pulse = tsl
				.sin(time.mul(2.6).add(p.x.mul(0.7)).add(p.z.mul(0.5)))
				.mul(0.45)
				.add(0.55);
			const low = tsl.clamp(
				tsl.float(1.4).sub(tsl.positionWorld.y.sub(tsl.modelPosition.y).mul(0.6)),
				0,
				1,
			);
			const patches = tsl.smoothstep(
				0.25,
				0.85,
				tsl.sin(p.x.mul(0.45).add(1.3)).mul(tsl.sin(p.z.mul(0.5).add(p.y.mul(0.3)))),
			);
			const emberColor = new three.Color(ember);
			material.emissiveNode = tsl
				.vec3(emberColor.r, emberColor.g, emberColor.b)
				.mul(cracks.mul(pulse).mul(low).mul(patches).mul(glow));
			material.roughnessNode = tsl.mix(tsl.float(roughness), tsl.float(1), cracks);
			return material as unknown as ThreeModule.Material;
		},
		setTime(seconds) {
			time.value = seconds;
		},
	};
}
