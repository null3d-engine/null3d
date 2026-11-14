// Night town's custom materials in three.js, which draw the looks of null3D's surface functions
// (shaders.ts) with three.js's own techniques: GLSL that `onBeforeCompile` adds to
// MeshStandardMaterial on WebGLRenderer, and node materials built with TSL on WebGPURenderer. Both
// keep three.js's lighting, as null3D's surface functions keep its own. The window and flicker
// hashes are the same integer math in every language, so both engines light the same windows.

import type * as ThreeModule from 'three';
import type { Three } from '../../lib/three-worker';
import { FLICKER_LOW, FLICKER_RATE, FLICKER_SHARE } from './scene';

/**
 * TSL's node graph, loosely typed: its node types check each operation's operand kinds more
 * strictly than these shaders need, so the graph code here works on plain values.
 */
// biome-ignore lint/suspicious/noExplicitAny: the loose node type above.
type Tsl = any;
type Shader = {
	uniforms: Record<string, { value: unknown }>;
	vertexShader: string;
	fragmentShader: string;
};
type AnyMaterial = ThreeModule.MeshStandardMaterial;

/** The textures that a facade or the street samples. */
export interface ShaderMaps {
	color: ThreeModule.Texture;
	orm: ThreeModule.Texture;
	normal: ThreeModule.Texture;
	puddles?: ThreeModule.Texture;
}

/** A material whose time the scene sets in each frame. */
export interface Timed {
	material: ThreeModule.Material;
	setTime(seconds: number): void;
}

const GLSL_HASH = /* glsl */ `
float town_hash(int a, int b, int c) {
	uint h = (uint(a) * 0x27d4eb2du) ^ (uint(b) * 0x165667b1u) ^ (uint(c) * 0x9e3779b9u);
	h = h ^ (h >> 15u);
	h = h * 0x2c1b3c6du;
	h = h ^ (h >> 12u);
	h = h * 0x297a2d39u;
	h = h ^ (h >> 15u);
	return float(h >> 8u) / 16777216.0;
}
ivec2 lot_of(vec2 p) {
	vec2 b = floor(p / 42.0 + 0.5);
	return ivec2(b * 2.0 + step(b * 42.0, p));
}
`;

/** A shop's neon colors and tubes: the same math as the WGSL's `neon_color` and `shop_neon`. */
const GLSL_NEON = /* glsl */ `
vec3 neon_color( int i ) {
	if ( i == 0 ) return vec3( 1.0, 0.06, 0.35 );
	if ( i == 1 ) return vec3( 0.0, 0.7, 1.0 );
	if ( i == 2 ) return vec3( 1.0, 0.42, 0.04 );
	if ( i == 3 ) return vec3( 0.15, 1.0, 0.2 );
	if ( i == 4 ) return vec3( 0.5, 0.12, 1.0 );
	return vec3( 1.0, 0.04, 0.03 );
}
float tube_to( vec2 p, vec2 a, vec2 b ) {
	vec2 ab = b - a;
	float t = clamp( dot( p - a, ab ) / dot( ab, ab ), 0.0, 1.0 );
	return length( p - a - ab * t );
}
float shop_neon( vec2 p, float tileX, float shop, ivec2 bay, ivec2 lot ) {
	float d = 9.0;
	if ( shop < 0.62 ) {
		float cell = clamp( floor( ( tileX - 0.1 ) / 0.16 ), 0.0, 4.0 );
		float bits = town_hash( int( cell ), bay.x + lot.x * 64, lot.y + 101 );
		float x0 = ( 0.1 + ( cell + 0.2 ) * 0.16 ) * 2.6;
		float x1 = ( 0.1 + ( cell + 0.8 ) * 0.16 ) * 2.6;
		float y0 = 3.2;
		float y1 = 3.85;
		float ym = 3.525;
		d = tube_to( p, vec2( x0, y0 ), vec2( x0, y1 ) );
		d = min( d, mix( 9.0, tube_to( p, vec2( x0, y1 ), vec2( x1, y1 ) ), step( 0.5, fract( bits * 2.0 ) ) ) );
		d = min( d, mix( 9.0, tube_to( p, vec2( x0, ym ), vec2( x1, ym ) ), step( 0.5, fract( bits * 4.0 ) ) ) );
		d = min( d, mix( 9.0, tube_to( p, vec2( x0, y0 ), vec2( x1, y0 ) ), step( 0.5, fract( bits * 8.0 ) ) ) );
		d = min( d, mix( 9.0, tube_to( p, vec2( x1, y0 ), vec2( x1, y1 ) ), step( 0.5, fract( bits * 16.0 ) ) ) );
		d = min( d, mix( 9.0, tube_to( p, vec2( x0, y1 ), vec2( x1, y0 ) ), step( 0.5, fract( bits * 32.0 ) ) ) );
	} else if ( shop < 0.8 ) {
		vec2 q = abs( p - vec2( 1.3, 1.554 ) ) - vec2( 1.18, 1.34 );
		d = abs( length( max( q, vec2( 0.0 ) ) ) + min( max( q.x, q.y ), 0.0 ) );
	}
	return 1.0 - smoothstep( 0.012, 0.022, d ) + exp( - d / 0.05 ) * 0.18;
}
`;

/** The varyings that every custom material passes: texture coordinates, world position and normal. */
const GLSL_VARYINGS = /* glsl */ `
varying vec2 vTownUv;
varying vec3 vTownWorld;
varying vec3 vTownNormal;
varying vec3 vTownObject;
`;
const GLSL_VERTEX = /* glsl */ `
	vec4 townWorld = vec4( transformed, 1.0 );
	vec3 townNormal = objectNormal;
	vec3 townObject = vec3( 0.0 );
	#ifdef USE_INSTANCING
		townWorld = instanceMatrix * townWorld;
		townNormal = mat3( instanceMatrix ) * townNormal;
		townObject = instanceMatrix[ 3 ].xyz;
	#endif
	townWorld = modelMatrix * townWorld;
	vTownWorld = townWorld.xyz;
	vTownNormal = normalize( mat3( modelMatrix ) * townNormal );
	vTownObject = ( modelMatrix * vec4( townObject, 1.0 ) ).xyz;
	vTownUv = uv;
`;

/**
 * Adds GLSL to a MeshStandardMaterial, after any setup it has (such as CSM's), with a cache key of
 * its own so materials of different looks never share a program.
 */
function patch(material: AnyMaterial, key: string, edit: (shader: Shader) => void): void {
	const before = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		before(shader, renderer);
		const s = shader as unknown as Shader;
		s.vertexShader = s.vertexShader
			.replace('#include <common>', `#include <common>\n${GLSL_VARYINGS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${GLSL_VERTEX}`);
		s.fragmentShader = s.fragmentShader.replace(
			'#include <common>',
			`#include <common>\n${GLSL_VARYINGS}\n${GLSL_HASH}`,
		);
		edit(s);
	};
	material.customProgramCacheKey = () => key;
}

// The facades.

/** A facade kind's numbers, which the look sets. */
export interface FacadeSettings {
	litShare: number;
	windowLight: number;
	shopLight: number;
	neonLight: number;
	/** An upper floor's window across the bay and up the floor: u0, u1, v0, v1. */
	window: readonly [number, number, number, number];
	/** How far the room behind a window reaches back from its glass, in meters. */
	roomDepth: number;
}

/** A facade kind's material: the bay texture, lit windows, and the roof. */
export async function facadeMaterial(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	maps: ShaderMaps,
	settings: FacadeSettings,
	setup: (material: ThreeModule.Material) => void,
): Promise<Timed> {
	if (renderer === 'webgpu') return facadeNodes(three, await import('three/tsl'), maps, settings);
	const material = new three.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 1 });
	setup(material);
	const uniforms = {
		townTime: { value: 0 },
		townLitShare: { value: settings.litShare },
		townWindowLight: { value: settings.windowLight },
		townShopLight: { value: settings.shopLight },
		townNeonLight: { value: settings.neonLight },
		townWin: { value: new three.Vector4(...settings.window) },
		townRoomDepth: { value: settings.roomDepth },
		townColor: { value: maps.color },
		townOrm: { value: maps.orm },
		townNormal: { value: maps.normal },
	};
	patch(material, 'night-town-facade', (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float townTime;
uniform float townLitShare;
uniform float townWindowLight;
uniform float townShopLight;
uniform float townNeonLight;
uniform vec4 townWin;
uniform float townRoomDepth;
uniform sampler2D townColor;
uniform sampler2D townOrm;
uniform sampler2D townNormal;`,
			)
			.replace(GLSL_HASH, `${GLSL_HASH}\n${GLSL_NEON}`)
			.replace(
				'#include <metalnessmap_fragment>',
				`#include <metalnessmap_fragment>
	vec2 coord = vTownUv;
	bool ground = coord.y < 1.0;
	vec2 tile = vec2( fract( coord.x ), ground ? 0.5 * coord.y : 0.5 + 0.5 * fract( coord.y ) );
	vec2 gx = dFdx( coord ) * vec2( 1.0, 0.5 );
	vec2 gy = dFdy( coord ) * vec2( 1.0, 0.5 );
	vec4 texel = textureGrad( townColor, tile, gx, gy );
	vec4 orm = textureGrad( townOrm, tile, gx, gy );
	vec3 bump = textureGrad( townNormal, tile, gx, gy ).xyz * 2.0 - 1.0;
	vec3 n = normalize( vTownNormal );
	bool roof = n.y > 0.5;
	ivec2 bay = ivec2( floor( coord ) );
	ivec2 lot = lot_of( vTownWorld.xz );
	float pick = town_hash( bay.x + lot.x * 4096, bay.y, lot.y );
	float kind = town_hash( bay.x, bay.y + 977, lot.x * 131 + lot.y );
	int period = int( floor( townTime / 23.0 + kind * 7.0 ) );
	bool toggles = kind > 0.9 && town_hash( bay.x, bay.y, period + lot.x * 7 + lot.y * 13 ) < 0.5;
	float share = ground ? 0.85 : townLitShare;
	float lit = ( ( pick < share ) != toggles ) ? 1.0 : 0.0;
	vec3 room = kind > 0.78 ? vec3( 0.55, 0.72, 1.0 ) : ( kind > 0.45 ? vec3( 1.0, 0.8, 0.55 ) : vec3( 1.0, 0.55, 0.24 ) );
	float tvFlicker = 0.55 + 0.45 * sin( townTime * 9.0 + pick * 60.0 ) * sin( townTime * 3.7 + kind * 20.0 );
	if ( kind > 0.84 && kind <= 0.9 ) room = vec3( 0.25, 0.45, 1.0 ) * tvFlicker;
	float shop = town_hash( bay.x * 7 + lot.x, 31, lot.y * 5 + 3 );
	vec3 tint = neon_color( int( floor( fract( shop * 13.7 ) * 6.0 ) ) );
	if ( ground && kind > 0.55 ) room = mix( vec3( 1.0, 0.8, 0.55 ), tint, 0.55 );
	float stutter = town_hash( int( floor( townTime * 15.0 ) ), bay.x + lot.x * 64, lot.y ) < 0.035 ? 0.12 : 1.0;
	float neon = ground ? shop_neon( vec2( tile.x * 2.6, coord.y * 4.2 ), tile.x, shop, bay, lot ) : 0.0;
	float curtain = mod( pick * 7.0, 1.0 ) < 0.35 ? ( tile.x > 0.5 ? 1.0 : 0.35 ) : 1.0;
	float depthFade = 0.55 + 0.45 * smoothstep( 0.1, 0.8, fract( coord.y ) );
	float strength = ground ? townShopLight : townWindowLight * ( 0.5 + pick );
	float shelves = ground ? ( 0.45 + 0.55 * step( 0.14, fract( coord.y * 4.0 ) ) ) * ( 0.75 + 0.25 * sin( coord.x * 37.0 + pick * 20.0 ) ) : 1.0;
	vec3 townGlow = room * strength * lit * curtain * depthFade * shelves * ( 0.7 + 0.6 * kind );
	ivec2 grain = ivec2( floor( vTownWorld.xz * 2.0 ) );
	vec3 tar = vec3( 0.035, 0.036, 0.04 ) * ( 0.8 + 0.4 * town_hash( grain.x, grain.y, 0 ) );
	diffuseColor.rgb = roof ? tar : diffuseColor.rgb * texel.rgb;
	roughnessFactor = roof ? 0.45 : orm.g;
	metalnessFactor = roof ? 0.0 : orm.b;
	vec3 along = normalize( vec3( n.z, 0.0, - n.x ) + vec3( 0.0001, 0.0, 0.0 ) );
	vec3 townWorldNormal = roof ? n : normalize( along * bump.x + vec3( 0.0, 1.0, 0.0 ) * bump.y + n * bump.z );
	// The room behind the window: the eye's ray reaches the back wall of a box that starts at the
	// glass, so a window shows more of its room from the side of the street than from in front.
	vec4 win = ground ? vec4( 0.06, 0.94, 0.06, 0.68 ) : townWin;
	float floorHeight = ground ? 4.2 : 3.2;
	float floorY = ground ? coord.y : fract( coord.y );
	float spanU = max( ( win.y - win.x ) * 2.6, 0.01 );
	float spanV = max( ( win.w - win.z ) * floorHeight, 0.01 );
	vec3 eye = normalize( cameraPosition - vTownWorld );
	float reach = townRoomDepth / max( dot( eye, n ), 0.18 );
	float roomU = ( fract( coord.x ) * 2.6 - win.x * 2.6 ) / spanU + dot( eye, along ) * reach / spanU;
	float roomV = ( floorY * floorHeight - win.z * floorHeight ) / spanV + eye.y * reach / spanV;
	float outside = max( max( - roomU, roomU - 1.0 ), max( - roomV, roomV - 1.0 ) );
	float inside = 1.0 - smoothstep( - 0.06, 0.04, outside );
	float sideShade = 0.55 + 0.2 * clamp( 1.0 - outside * 2.0, 0.0, 1.0 );
	float backShade = 0.82 + 0.18 * smoothstep( 0.55, 0.8, roomV ) + 0.07 * step( 0.5, fract( roomU * 4.0 + pick * 9.0 ) );
	townGlow *= mix( sideShade, backShade, inside );`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
	normal = normalize( ( viewMatrix * vec4( townWorldNormal, 0.0 ) ).xyz );`,
			)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
	totalEmissiveRadiance = roof ? vec3( 0.0 ) : townGlow * texel.a + tint * neon * stutter * townNeonLight;`,
			);
	});
	return { material, setTime: (seconds) => (uniforms.townTime.value = seconds) };
}

/** The TSL twin of the integer hash: the same bits as the GLSL and WGSL. */
function tslHash(tsl: Tsl) {
	const { Fn, uint, float } = tsl;
	return Fn(([a, b, c]: [Tsl, Tsl, Tsl]) => {
		const h = uint(a)
			.mul(uint(0x27d4eb2d))
			.bitXor(uint(b).mul(uint(0x165667b1)))
			.bitXor(uint(c).mul(uint(0x9e3779b9)))
			.toVar();
		h.assign(h.bitXor(h.shiftRight(uint(15))));
		h.assign(h.mul(uint(0x2c1b3c6d)));
		h.assign(h.bitXor(h.shiftRight(uint(12))));
		h.assign(h.mul(uint(0x297a2d39)));
		h.assign(h.bitXor(h.shiftRight(uint(15))));
		return float(h.shiftRight(uint(8))).div(16777216.0);
	});
}

/** The TSL twin of the lot's numbers from a point on the ground. */
function tslLot(tsl: Tsl) {
	const { Fn, floor, step, ivec2 } = tsl;
	return Fn(([p]: [Tsl]) => {
		const b = floor(p.div(42).add(0.5));
		return ivec2(b.mul(2).add(step(b.mul(42), p)));
	});
}

/** The TSL twins of a shop's neon colors and tubes. */
function tslNeon(tsl: Tsl) {
	const {
		vec2,
		vec3,
		float,
		int,
		floor,
		fract,
		clamp,
		dot,
		length,
		min,
		max,
		abs,
		mix,
		step,
		select,
		smoothstep,
		exp,
	} = tsl;
	const hash = tslHash(tsl);
	const palette = [
		[1, 0.06, 0.35],
		[0, 0.7, 1],
		[1, 0.42, 0.04],
		[0.15, 1, 0.2],
		[0.5, 0.12, 1],
	] as const;
	const color = (i: Tsl) =>
		palette.reduceRight<Tsl>(
			(rest, rgb, k) => select(i.equal(int(k)), vec3(...rgb), rest),
			vec3(1, 0.04, 0.03),
		);
	const tubeTo = (p: Tsl, a: Tsl, b: Tsl) => {
		const ab = b.sub(a);
		const t = clamp(dot(p.sub(a), ab).div(dot(ab, ab)), 0, 1);
		return length(p.sub(a).sub(ab.mul(t)));
	};
	const tubes = (p: Tsl, tileX: Tsl, shop: Tsl, bay: Tsl, lot: Tsl) => {
		const cell = clamp(floor(tileX.sub(0.1).div(0.16)), 0, 4);
		const bits = hash(int(cell), bay.x.add(lot.x.mul(64)), lot.y.add(101));
		const x0 = cell.add(0.2).mul(0.16).add(0.1).mul(2.6);
		const x1 = cell.add(0.8).mul(0.16).add(0.1).mul(2.6);
		const y0 = float(3.2);
		const y1 = float(3.85);
		const ym = float(3.525);
		const stroke = (a: Tsl, b: Tsl, bit: number) =>
			mix(float(9), tubeTo(p, a, b), step(0.5, fract(bits.mul(bit))));
		let letters = tubeTo(p, vec2(x0, y0), vec2(x0, y1));
		letters = min(letters, stroke(vec2(x0, y1), vec2(x1, y1), 2));
		letters = min(letters, stroke(vec2(x0, ym), vec2(x1, ym), 4));
		letters = min(letters, stroke(vec2(x0, y0), vec2(x1, y0), 8));
		letters = min(letters, stroke(vec2(x1, y0), vec2(x1, y1), 16));
		letters = min(letters, stroke(vec2(x0, y1), vec2(x1, y0), 32));
		const q = abs(p.sub(vec2(1.3, 1.554))).sub(vec2(1.18, 1.34));
		const outline = abs(length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)));
		const d = select(shop.lessThan(0.62), letters, select(shop.lessThan(0.8), outline, float(9)));
		return float(1)
			.sub(smoothstep(0.012, 0.022, d))
			.add(exp(d.div(-0.05)).mul(0.18));
	};
	return { color, tubes };
}

function facadeNodes(three: Three, tsl: Tsl, maps: ShaderMaps, settings: FacadeSettings): Timed {
	const {
		uniform,
		uv,
		vec2,
		vec3,
		float,
		int,
		fract,
		floor,
		select,
		texture,
		dFdx,
		dFdy,
		positionWorld,
		normalWorldGeometry,
		normalize,
		smoothstep,
		step,
		sin,
		mod,
		cameraPosition,
		cameraViewMatrix,
		vec4,
	} = tsl;
	const webgpu = three as unknown as typeof import('three/webgpu');
	const hash = tslHash(tsl);
	const lotOf = tslLot(tsl);
	const time = uniform(0);
	const material = new webgpu.MeshStandardNodeMaterial({
		color: '#ffffff',
		roughness: 1,
		metalness: 1,
	});
	const coord = uv();
	const ground = coord.y.lessThan(1);
	const tile = vec2(
		fract(coord.x),
		select(ground, coord.y.mul(0.5), fract(coord.y).mul(0.5).add(0.5)),
	);
	const gx = dFdx(coord).mul(vec2(1, 0.5));
	const gy = dFdy(coord).mul(vec2(1, 0.5));
	const texel = texture(maps.color, tile).grad(gx, gy);
	const orm = texture(maps.orm, tile).grad(gx, gy);
	const bump = texture(maps.normal, tile).grad(gx, gy).xyz.mul(2).sub(1);
	const n = normalize(normalWorldGeometry);
	const roof = n.y.greaterThan(0.5);
	const bay = tsl.ivec2(floor(coord));
	const lot = lotOf(positionWorld.xz);
	const pick = hash(bay.x.add(lot.x.mul(4096)), bay.y, lot.y);
	const kind = hash(bay.x, bay.y.add(977), lot.x.mul(131).add(lot.y));
	const period = int(floor(time.div(23).add(kind.mul(7))));
	const toggles = kind
		.greaterThan(0.9)
		.and(hash(bay.x, bay.y, period.add(lot.x.mul(7)).add(lot.y.mul(13))).lessThan(0.5));
	const share = select(ground, float(0.85), float(settings.litShare));
	const lit = select(pick.lessThan(share).notEqual(toggles), float(1), float(0));
	const tvFlicker = sin(time.mul(9).add(pick.mul(60)))
		.mul(sin(time.mul(3.7).add(kind.mul(20))))
		.mul(0.45)
		.add(0.55);
	const tv = kind.greaterThan(0.84).and(kind.lessThanEqual(0.9));
	const base = select(
		kind.greaterThan(0.78),
		vec3(0.55, 0.72, 1),
		select(kind.greaterThan(0.45), vec3(1, 0.8, 0.55), vec3(1, 0.55, 0.24)),
	);
	const neonOf = tslNeon(tsl);
	const shop = hash(bay.x.mul(7).add(lot.x), int(31), lot.y.mul(5).add(3));
	const tint = neonOf.color(int(floor(fract(shop.mul(13.7)).mul(6))));
	const room = select(
		ground.and(kind.greaterThan(0.55)),
		tsl.mix(vec3(1, 0.8, 0.55), tint, 0.55),
		select(tv, vec3(0.25, 0.45, 1).mul(tvFlicker), base),
	);
	const stutter = select(
		hash(int(floor(time.mul(15))), bay.x.add(lot.x.mul(64)), lot.y).lessThan(0.035),
		float(0.12),
		float(1),
	);
	const neon = select(
		ground,
		neonOf.tubes(vec2(tile.x.mul(2.6), coord.y.mul(4.2)), tile.x, shop, bay, lot),
		float(0),
	);
	const curtain = select(
		mod(pick.mul(7), 1).lessThan(0.35),
		select(tile.x.greaterThan(0.5), float(1), float(0.35)),
		float(1),
	);
	const depthFade = smoothstep(0.1, 0.8, fract(coord.y)).mul(0.45).add(0.55);
	const strength = select(
		ground,
		float(settings.shopLight),
		pick.add(0.5).mul(settings.windowLight),
	);
	const shelves = select(
		ground,
		step(0.14, fract(coord.y.mul(4)))
			.mul(0.55)
			.add(0.45)
			.mul(
				sin(coord.x.mul(37).add(pick.mul(20)))
					.mul(0.25)
					.add(0.75),
			),
		float(1),
	);
	const glow = room
		.mul(strength)
		.mul(lit)
		.mul(curtain)
		.mul(depthFade)
		.mul(shelves)
		.mul(kind.mul(0.6).add(0.7));
	const grain = floor(positionWorld.xz.mul(2));
	const tar = vec3(0.035, 0.036, 0.04).mul(
		hash(int(grain.x), int(grain.y), int(0)).mul(0.4).add(0.8),
	);
	material.colorNode = select(roof, tar, texel.rgb);
	material.roughnessNode = select(roof, float(0.45), orm.g);
	material.metalnessNode = select(roof, float(0), orm.b);
	const along = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(0.0001, 0, 0)));
	// The room behind the window: the eye's ray reaches the back wall of a box that starts at the
	// glass, so a window shows more of its room from the side of the street than from in front.
	const win = select(
		ground,
		vec4(0.06, 0.94, 0.06, 0.68),
		vec4(settings.window[0], settings.window[1], settings.window[2], settings.window[3]),
	);
	const floorHeight = select(ground, float(4.2), float(3.2));
	const floorY = select(ground, coord.y, fract(coord.y));
	const spanU = tsl.max(win.y.sub(win.x).mul(2.6), float(0.01));
	const spanV = tsl.max(win.w.sub(win.z).mul(floorHeight), float(0.01));
	const eye = normalize(cameraPosition.sub(positionWorld));
	const reach = float(settings.roomDepth).div(tsl.max(tsl.dot(eye, n), float(0.18)));
	const roomU = fract(coord.x)
		.mul(2.6)
		.sub(win.x.mul(2.6))
		.div(spanU)
		.add(tsl.dot(eye, along).mul(reach).div(spanU));
	const roomV = floorY
		.mul(floorHeight)
		.sub(win.z.mul(floorHeight))
		.div(spanV)
		.add(eye.y.mul(reach).div(spanV));
	const outside = tsl.max(
		tsl.max(roomU.negate(), roomU.sub(1)),
		tsl.max(roomV.negate(), roomV.sub(1)),
	);
	const inside = float(1).sub(smoothstep(-0.06, 0.04, outside));
	const sideShade = float(0.55).add(
		tsl.clamp(float(1).sub(outside.mul(2)), float(0), float(1)).mul(0.2),
	);
	const backShade = float(0.82)
		.add(smoothstep(0.55, 0.8, roomV).mul(0.18))
		.add(step(0.5, fract(roomU.mul(4).add(pick.mul(9)))).mul(0.07));
	const roomShade = tsl.mix(sideShade, backShade, inside);
	const worldNormal = select(
		roof,
		n,
		normalize(
			along
				.mul(bump.x)
				.add(vec3(0, 1, 0).mul(bump.y))
				.add(n.mul(bump.z)),
		),
	);
	material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
	material.emissiveNode = select(
		roof,
		vec3(0),
		glow
			.mul(roomShade)
			.mul(texel.a)
			.add(tint.mul(neon.mul(stutter).mul(settings.neonLight))),
	);
	return { material, setTime: (seconds) => (time.value = seconds) };
}

// The wet street.

/** The street's numbers, which its look sets. */
export interface StreetSettings {
	puddleShare: number;
	wetDarken: number;
	wetMirror: number;
}

/** How a reflection reaches the street: three.js's Reflector on WebGL, the reflector node on WebGPU. */
export interface StreetReflection {
	/** WebGL: the Reflector's texture and the matrix from the world to it. */
	texture?: ThreeModule.Texture;
	matrix?: ThreeModule.Matrix4;
	/** WebGPU: the reflector node, which samples where each pixel shows. */
	node?: Tsl;
}

const GLSL_STREET = /* glsl */ `
	vec2 p = vTownWorld.xz;
	vec4 texel = texture2D( townColor, p / 4.0 );
	vec4 orm = texture2D( townOrm, p / 4.0 );
	vec3 bump = texture2D( townNormal, p / 4.0 ).xyz * 2.0 - 1.0;
	vec4 water = texture2D( townPuddles, p / 36.0 );
	vec2 local = p - 42.0 * floor( p / 42.0 + 0.5 );
	vec2 a = abs( local );
	bool onX = a.y > 15.0;
	bool onZ = a.x > 15.0;
	bool lineZ = onZ && !onX && abs( a.x - 21.0 ) > 0.07 && abs( a.x - 21.0 ) < 0.19;
	bool lineX = onX && !onZ && abs( a.y - 21.0 ) > 0.07 && abs( a.y - 21.0 ) < 0.19;
	bool crossZ = onZ && a.y > 11.8 && a.y < 14.6 && a.x > 15.6 && a.x < 26.4 && fract( local.x / 0.9 ) < 0.5;
	bool crossX = onX && a.x > 11.8 && a.x < 14.6 && a.y > 15.6 && a.y < 26.4 && fract( local.y / 0.9 ) < 0.5;
	float worn = 0.55 + 0.45 * water.g;
	vec3 paint = texel.rgb;
	paint = mix( paint, vec3( 0.62, 0.42, 0.05 ) * worn, ( lineZ || lineX ) ? 1.0 : 0.0 );
	paint = mix( paint, vec3( 0.7, 0.7, 0.68 ) * worn, ( crossZ || crossX ) ? 1.0 : 0.0 );
	float curb = max( smoothstep( 16.4, 15.0, a.x ) * ( onZ ? 1.0 : 0.0 ), smoothstep( 16.4, 15.0, a.y ) * ( onX ? 1.0 : 0.0 ) );
	float depthOfWater = water.r + 0.25 * curb + 0.15 * texel.a;
	float edge = 1.0 - townPuddleShare;
	float puddle = smoothstep( edge, edge + 0.035, depthOfWater );
	vec2 cell = floor( p / 0.6 );
	vec2 offset = ( vec2( town_ripple( cell ), town_ripple( cell + 17.0 ) ) - 0.5 ) * 0.25;
	vec2 to = fract( p / 0.6 ) - 0.5 - offset;
	float phase = fract( townTime * 0.85 + town_ripple( cell + 3.0 ) );
	float radius = phase * 0.28;
	float d = length( to ) * 0.6;
	float ring = exp( - pow( ( d - radius ) / 0.012, 2.0 ) ) * ( 1.0 - phase );
	vec2 tilt = normalize( to + vec2( 0.0001 ) ) * ring * 0.35 * puddle;
	vec3 roughNormal = normalize( vec3( bump.x, 0.0, - bump.y ) * 0.3 + vec3( 0.0, 1.0, 0.0 ) * bump.z );
	vec3 waterNormal = normalize( vec3( tilt.x, 1.0, tilt.y ) );
	vec3 townWorldNormal = normalize( mix( roughNormal, waterNormal, puddle ) );
	diffuseColor.rgb *= paint * mix( townWetDarken, 0.35, puddle );
	roughnessFactor = mix( orm.g * 0.32, 0.03, puddle );
	metalnessFactor = 0.0;
	float wet = 1.0 - puddle;
	vec2 smear = vec2( ( water.g - 0.5 ) * 0.004, ( orm.g - 0.855 ) * 0.6 ) * wet;
`;

/** The street's material, with puddles that show the reflection. */
export async function streetMaterial(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	maps: ShaderMaps,
	settings: StreetSettings,
	reflection: StreetReflection | null,
	setup: (material: ThreeModule.Material) => void,
): Promise<Timed> {
	if (renderer === 'webgpu')
		return streetNodes(three, await import('three/tsl'), maps, settings, reflection);
	const material = new three.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
	setup(material);
	const uniforms = {
		townTime: { value: 0 },
		townPuddleShare: { value: settings.puddleShare },
		townWetDarken: { value: settings.wetDarken },
		townMirrorShare: { value: reflection ? 1 : 0 },
		townWetMirror: { value: settings.wetMirror },
		townColor: { value: maps.color },
		townOrm: { value: maps.orm },
		townNormal: { value: maps.normal },
		townPuddles: { value: maps.puddles },
		townMirror: { value: reflection?.texture ?? null },
		townMirrorMatrix: { value: reflection?.matrix ?? new three.Matrix4() },
	};
	patch(material, 'night-town-street', (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform mat4 townMirrorMatrix;\nvarying vec4 vTownMirror;',
			)
			.replace(GLSL_VERTEX, `${GLSL_VERTEX}\n\tvTownMirror = townMirrorMatrix * townWorld;`);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float townTime;
uniform float townPuddleShare;
uniform float townWetDarken;
uniform float townMirrorShare;
uniform float townWetMirror;
uniform sampler2D townColor;
uniform sampler2D townOrm;
uniform sampler2D townNormal;
uniform sampler2D townPuddles;
uniform sampler2D townMirror;
varying vec4 vTownMirror;
float town_hash(int a, int b, int c);
float town_ripple( vec2 c ) { return town_hash(int(c.x), int(c.y), 0); }`,
			)
			.replace(
				'#include <metalnessmap_fragment>',
				`#include <metalnessmap_fragment>\n${GLSL_STREET}`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
	normal = normalize( ( viewMatrix * vec4( townWorldNormal, 0.0 ) ).xyz );`,
			)
			.replace(
				'#include <lights_fragment_maps>',
				`#include <lights_fragment_maps>
	vec4 townMirrorCoord = vTownMirror;
	townMirrorCoord.xy += ( tilt * 0.08 + smear ) * townMirrorCoord.w;
	vec3 townMirrored = textureProj( townMirror, townMirrorCoord ).rgb;
	radiance = mix( radiance, townMirrored, ( puddle + wet * townWetMirror ) * townMirrorShare );`,
			);
	});
	return { material, setTime: (seconds) => (uniforms.townTime.value = seconds) };
}

function streetNodes(
	three: Three,
	tsl: Tsl,
	maps: ShaderMaps,
	settings: StreetSettings,
	reflection: StreetReflection | null,
): Timed {
	const {
		uniform,
		vec2,
		vec3,
		float,
		fract,
		floor,
		select,
		texture,
		positionWorld,
		normalize,
		smoothstep,
		mix,
		max,
		abs,
		exp,
		pow,
		length,
		cameraViewMatrix,
		vec4,
		positionViewDirection,
		normalView,
		dot,
	} = tsl;
	const webgpu = three as unknown as typeof import('three/webgpu');
	const time = uniform(0);
	const material = new webgpu.MeshStandardNodeMaterial({
		color: '#ffffff',
		roughness: 1,
		metalness: 0,
	});
	const integerHash = tslHash(tsl);
	const ripple = (c: Tsl) => integerHash(tsl.int(c.x), tsl.int(c.y), tsl.int(0));
	const p = positionWorld.xz;
	const texel = texture(maps.color, p.div(4));
	const orm = texture(maps.orm, p.div(4));
	const bump = texture(maps.normal, p.div(4)).xyz.mul(2).sub(1);
	const water = texture(maps.puddles as ThreeModule.Texture, p.div(36));
	const local = p.sub(floor(p.div(42).add(0.5)).mul(42));
	const a = abs(local);
	const onX = a.y.greaterThan(15);
	const onZ = a.x.greaterThan(15);
	const dz = abs(a.x.sub(21));
	const dx = abs(a.y.sub(21));
	const lineZ = onZ.and(onX.not()).and(dz.greaterThan(0.07)).and(dz.lessThan(0.19));
	const lineX = onX.and(onZ.not()).and(dx.greaterThan(0.07)).and(dx.lessThan(0.19));
	const crossZ = onZ
		.and(a.y.greaterThan(11.8))
		.and(a.y.lessThan(14.6))
		.and(a.x.greaterThan(15.6))
		.and(a.x.lessThan(26.4))
		.and(fract(local.x.div(0.9)).lessThan(0.5));
	const crossX = onX
		.and(a.x.greaterThan(11.8))
		.and(a.x.lessThan(14.6))
		.and(a.y.greaterThan(15.6))
		.and(a.y.lessThan(26.4))
		.and(fract(local.y.div(0.9)).lessThan(0.5));
	const worn = water.g.mul(0.45).add(0.55);
	const one = float(1);
	const zero = float(0);
	let paint = mix(texel.rgb, vec3(0.62, 0.42, 0.05).mul(worn), select(lineZ.or(lineX), one, zero));
	paint = mix(paint, vec3(0.7, 0.7, 0.68).mul(worn), select(crossZ.or(crossX), one, zero));
	const curb = max(
		smoothstep(16.4, 15, a.x).mul(select(onZ, one, zero)),
		smoothstep(16.4, 15, a.y).mul(select(onX, one, zero)),
	);
	const depth = water.r.add(curb.mul(0.25)).add(texel.a.mul(0.15));
	const edge = 1 - settings.puddleShare;
	const puddle = smoothstep(edge, edge + 0.035, depth);
	const cell = floor(p.div(0.6));
	const offset = vec2(ripple(cell), ripple(cell.add(17)))
		.sub(0.5)
		.mul(0.25);
	const to = fract(p.div(0.6)).sub(0.5).sub(offset);
	const phase = fract(time.mul(0.85).add(ripple(cell.add(3))));
	const radius = phase.mul(0.28);
	const d = length(to).mul(0.6);
	const ring = exp(pow(d.sub(radius).div(0.012), 2).negate()).mul(one.sub(phase));
	const tilt = normalize(to.add(vec2(0.0001)))
		.mul(ring)
		.mul(0.35)
		.mul(puddle);
	const roughNormal = normalize(
		vec3(bump.x, 0, bump.y.negate())
			.mul(0.3)
			.add(vec3(0, 1, 0).mul(bump.z)),
	);
	const waterNormal = normalize(vec3(tilt.x, 1, tilt.y));
	const worldNormal = normalize(mix(roughNormal, waterNormal, puddle));
	material.colorNode = paint.mul(mix(float(settings.wetDarken), float(0.35), puddle));
	material.roughnessNode = mix(orm.g.mul(0.32), float(0.03), puddle);
	material.metalnessNode = float(0);
	material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
	if (reflection?.node) {
		// The reflector node samples where each pixel shows on the screen; a ripple's tilt moves the
		// place. The reflection adds as light from the mirror direction, weighed by Schlick's Fresnel
		// term for water, where the puddles lie.
		// The asphalt's grain moves each pixel's sample up or down the screen, between the puddles.
		const node = reflection.node;
		const wet = one.sub(puddle);
		const smear = vec2(water.g.sub(0.5).mul(0.004), orm.g.sub(0.855).mul(0.6)).mul(wet);
		node.uvNode = node.uvNode.add(tilt.mul(0.08)).add(smear);
		const facing = dot(normalView, positionViewDirection).clamp(0, 1);
		const fresnel = pow(one.sub(facing), 5).mul(0.96).add(0.04);
		material.emissiveNode = node.rgb.mul(fresnel).mul(puddle.add(wet.mul(settings.wetMirror)));
	}
	return { material, setTime: (seconds) => (time.value = seconds) };
}

// The neon tubes.

/** A sign color's neon material, which stutters with its sign's lot. */
export async function neonMaterial(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	glow: readonly [number, number, number],
	strength: number,
	setup: (material: ThreeModule.Material) => void,
): Promise<Timed> {
	if (renderer === 'webgpu') {
		const tsl: Tsl = await import('three/tsl');
		const { uniform, vec3, float, floor, int, select, modelWorldMatrix } = tsl;
		const webgpu = three as unknown as typeof import('three/webgpu');
		const hash = tslHash(tsl);
		const lotOf = tslLot(tsl);
		const time = uniform(0);
		const material = new webgpu.MeshStandardNodeMaterial({
			color: '#050505',
			roughness: 0.3,
			metalness: 0,
		});
		const lot = lotOf(modelWorldMatrix.element(3).xz);
		const steps = int(floor(time.mul(FLICKER_RATE)));
		const on = select(
			hash(steps, lot.x, lot.y).lessThan(FLICKER_SHARE),
			float(FLICKER_LOW),
			float(1),
		);
		material.emissiveNode = vec3(...glow)
			.mul(strength)
			.mul(on);
		return { material, setTime: (seconds) => (time.value = seconds) };
	}
	const material = new three.MeshStandardMaterial({
		color: '#050505',
		roughness: 0.3,
		metalness: 0,
	});
	setup(material);
	const uniforms = {
		townTime: { value: 0 },
		townGlow: { value: new three.Vector3(...glow).multiplyScalar(strength) },
	};
	patch(material, 'night-town-neon', (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform float townTime;\nuniform vec3 townGlow;',
			)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
	ivec2 lot = lot_of( vTownObject.xz );
	int steps = int( floor( townTime * ${FLICKER_RATE.toFixed(1)} ) );
	float on = town_hash( steps, lot.x, lot.y ) < ${FLICKER_SHARE} ? ${FLICKER_LOW} : 1.0;
	totalEmissiveRadiance = townGlow * on;`,
			);
	});
	return { material, setTime: (seconds) => (uniforms.townTime.value = seconds) };
}

// The awnings.

/** An awning's striped cloth, whose hem ripples in the wind. */
export async function awningMaterial(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	stripeA: string,
	stripeB: string,
	setup: (material: ThreeModule.Material) => void,
): Promise<Timed> {
	const a = new three.Color(stripeA);
	const b = new three.Color(stripeB);
	if (renderer === 'webgpu') {
		const tsl: Tsl = await import('three/tsl');
		const {
			uniform,
			vec3,
			uv,
			sin,
			step,
			fract,
			mix,
			smoothstep,
			positionLocal,
			modelWorldMatrix,
		} = tsl;
		const webgpu = three as unknown as typeof import('three/webgpu');
		const time = uniform(0);
		const material = new webgpu.MeshStandardNodeMaterial({
			roughness: 0.6,
			metalness: 0,
			side: three.DoubleSide,
		});
		const origin = modelWorldMatrix.element(3);
		const phase = origin.x.mul(0.37).add(origin.z.mul(0.61));
		const coord = uv();
		const reach = coord.y.mul(coord.y);
		const wave = sin(time.mul(2.3).add(coord.x.mul(2.1)).add(phase))
			.mul(0.05)
			.add(sin(time.mul(5.3).add(coord.x.mul(4.7)).add(phase.mul(1.7))).mul(0.02));
		material.positionNode = positionLocal.add(vec3(0, wave.mul(reach), 0));
		const stripe = step(0.5, fract(coord.x.div(0.5)));
		const colorA = vec3(a.r, a.g, a.b);
		material.colorNode = mix(
			mix(colorA, vec3(b.r, b.g, b.b), stripe),
			colorA.mul(0.6),
			smoothstep(0.9, 0.97, coord.y),
		);
		return { material, setTime: (seconds) => (time.value = seconds) };
	}
	const material = new three.MeshStandardMaterial({
		roughness: 0.6,
		metalness: 0,
		side: three.DoubleSide,
	});
	setup(material);
	const uniforms = {
		townTime: { value: 0 },
		townStripeA: { value: a },
		townStripeB: { value: b },
	};
	patch(material, 'night-town-awning', (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nuniform float townTime;')
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
	float townPhase = modelMatrix[ 3 ].x * 0.37 + modelMatrix[ 3 ].z * 0.61;
	float townWave = sin( townTime * 2.3 + uv.x * 2.1 + townPhase ) * 0.05 + sin( townTime * 5.3 + uv.x * 4.7 + townPhase * 1.7 ) * 0.02;
	transformed.y += townWave * uv.y * uv.y;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform vec3 townStripeA;\nuniform vec3 townStripeB;',
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
	float townStripe = step( 0.5, fract( vTownUv.x / 0.5 ) );
	diffuseColor.rgb = mix( mix( townStripeA, townStripeB, townStripe ), townStripeA * 0.6, smoothstep( 0.9, 0.97, vTownUv.y ) );`,
			);
	});
	return { material, setTime: (seconds) => (uniforms.townTime.value = seconds) };
}

// The sky's dome.

/** The dome's numbers, which the look sets: the direction toward the moon and the clouds' share. */
export interface SkySettings {
	moon: readonly [number, number, number];
	cover: number;
	brightness: number;
}

const GLSL_SKY = /* glsl */ `
${GLSL_HASH}
float sky_hash( vec2 p ) { return town_hash(int(p.x), int(p.y), 0); }
float sky_noise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = sky_hash( i );
	float b = sky_hash( i + vec2( 1.0, 0.0 ) );
	float c = sky_hash( i + vec2( 0.0, 1.0 ) );
	float d = sky_hash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float sky_fbm( vec2 p ) {
	float sum = 0.0;
	float amount = 0.5;
	for ( int k = 0; k < 5; k ++ ) {
		sum += amount * sky_noise( p );
		p = p * 2.03 + vec2( 1.7, 9.2 );
		amount *= 0.5;
	}
	return sum;
}
float sky_star( vec3 d ) {
	vec3 q = d * 160.0;
	vec3 cell = floor( q );
	float h = town_hash(int(cell.x), int(cell.y), int(cell.z));
	float spot = length( fract( q ) - 0.5 );
	return step( 0.985, h ) * ( 1.0 - smoothstep( 0.0, 0.3, spot ) ) * ( h - 0.985 ) / 0.015;
}
vec3 sky_color( vec3 d, vec3 moonDir, float time, float cover ) {
	float up = max( d.y, 0.0 );
	float toward = max( dot( d, moonDir ), 0.0 );
	vec3 zenith = vec3( 0.0006, 0.0011, 0.0042 );
	vec3 haze = vec3( 0.0034, 0.005, 0.0098 );
	vec3 city = vec3( 0.003, 0.002, 0.0016 ) * pow( 1.0 - up, 16.0 );
	vec3 air = mix( haze, zenith, pow( up, 0.5 ) ) + city;
	vec3 moonlight = vec3( 0.62, 0.72, 1.0 );
	air += moonlight * ( 0.004 * pow( toward, 6.0 ) + 0.05 * pow( toward, 90.0 ) + 0.5 * pow( toward, 1800.0 ) );
	air += vec3( 0.5, 0.55, 0.7 ) * 0.02 * sky_star( d ) * smoothstep( 0.08, 0.3, up );
	vec2 plane = d.xz / ( up + 0.3 ) * 1.5 + vec2( time * 0.012, time * 0.005 );
	float n = sky_fbm( plane );
	float edge = 1.0 - cover;
	float density = smoothstep( edge - 0.06, edge + 0.22, n ) * smoothstep( -0.02, 0.08, up );
	float ahead = sky_fbm( plane + normalize( moonDir.xz + vec2( 0.0001 ) ) * 0.09 );
	float rim = clamp( 0.5 + ( n - ahead ) * 5.0, 0.0, 1.0 );
	vec3 base = vec3( 0.0034, 0.004, 0.0058 ) + vec3( 0.0058, 0.006, 0.0066 ) * pow( 1.0 - up, 3.0 ) + city * 1.6;
	vec3 lit = moonlight * ( 0.004 + 0.12 * pow( toward, 10.0 ) + 0.6 * pow( toward, 60.0 ) ) * rim * ( 1.15 - density );
	vec3 cloud = base + lit;
	float disc = smoothstep( 0.99972, 0.99978, dot( d, moonDir ) );
	float seas = 0.78 + 0.22 * sky_noise( ( d.xy - moonDir.xy ) * 900.0 + vec2( 3.0, 7.0 ) );
	vec3 moon = vec3( 1.0, 0.96, 0.88 ) * 2.4 * seas * disc;
	return mix( air, cloud, density * 0.96 ) + moon * ( 1.0 - 0.85 * density );
}
`;

/**
 * The sky dome's material, drawn as light alone and without fog: MeshBasicMaterial with the sky's
 * GLSL on WebGLRenderer, and MeshBasicNodeMaterial with its TSL twin on WebGPURenderer.
 */
export async function skyMaterial(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	settings: SkySettings,
): Promise<Timed> {
	if (renderer === 'webgpu') return skyNodes(three, await import('three/tsl'), settings);
	const material = new three.MeshBasicMaterial({ color: '#ffffff', fog: false });
	const uniforms = {
		townTime: { value: 0 },
		townMoon: { value: new three.Vector3(...settings.moon) },
		townCover: { value: settings.cover },
		townBrightness: { value: settings.brightness },
	};
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTownWorld;')
			.replace(
				'#include <project_vertex>',
				'#include <project_vertex>\n\tvTownWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vTownWorld;
uniform float townTime;
uniform vec3 townMoon;
uniform float townCover;
uniform float townBrightness;
${GLSL_SKY}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
	diffuseColor.rgb = sky_color( normalize( vTownWorld - cameraPosition ), townMoon, townTime, townCover ) * townBrightness;`,
			);
	};
	material.customProgramCacheKey = () => 'night-town-sky';
	return { material, setTime: (seconds) => (uniforms.townTime.value = seconds) };
}

function skyNodes(three: Three, tsl: Tsl, settings: SkySettings): Timed {
	const {
		uniform,
		vec2,
		vec3,
		float,
		fract,
		floor,
		dot,
		mix,
		max,
		pow,
		smoothstep,
		step,
		clamp,
		length,
		normalize,
		positionWorld,
		cameraPosition,
	} = tsl;
	const webgpu = three as unknown as typeof import('three/webgpu');
	const time = uniform(0);
	const moonDir = vec3(...settings.moon);
	const integerHash = tslHash(tsl);
	const hash = (p: Tsl) => integerHash(tsl.int(p.x), tsl.int(p.y), tsl.int(0));
	const noise = (p: Tsl) => {
		const i = floor(p);
		const f = fract(p);
		const u = f.mul(f).mul(f.mul(-2).add(3));
		const a = hash(i);
		const b = hash(i.add(vec2(1, 0)));
		const c = hash(i.add(vec2(0, 1)));
		const d = hash(i.add(vec2(1, 1)));
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	};
	const fbm = (start: Tsl) => {
		let p = start;
		let sum: Tsl = float(0);
		let amount = 0.5;
		for (let k = 0; k < 5; k++) {
			sum = sum.add(noise(p).mul(amount));
			p = p.mul(2.03).add(vec2(1.7, 9.2));
			amount *= 0.5;
		}
		return sum;
	};
	const d = normalize(positionWorld.sub(cameraPosition));
	const up = max(d.y, 0);
	const toward = max(dot(d, moonDir), 0);
	const city = vec3(0.003, 0.002, 0.0016).mul(pow(float(1).sub(up), 16));
	const moonlight = vec3(0.62, 0.72, 1);
	const q = d.mul(160);
	const cell = floor(q);
	const h = integerHash(tsl.int(cell.x), tsl.int(cell.y), tsl.int(cell.z));
	const star = step(0.985, h)
		.mul(float(1).sub(smoothstep(0, 0.3, length(fract(q).sub(0.5)))))
		.mul(h.sub(0.985).div(0.015));
	const air = mix(vec3(0.0034, 0.005, 0.0098), vec3(0.0006, 0.0011, 0.0042), pow(up, 0.5))
		.add(city)
		.add(
			moonlight.mul(
				pow(toward, 6).mul(0.004).add(pow(toward, 90).mul(0.05)).add(pow(toward, 1800).mul(0.5)),
			),
		)
		.add(vec3(0.5, 0.55, 0.7).mul(star.mul(0.02).mul(smoothstep(0.08, 0.3, up))));
	const plane = d.xz
		.div(up.add(0.3))
		.mul(1.5)
		.add(vec2(time.mul(0.012), time.mul(0.005)));
	const n = fbm(plane);
	const edge = 1 - settings.cover;
	const density = smoothstep(edge - 0.06, edge + 0.22, n).mul(smoothstep(-0.02, 0.08, up));
	const ahead = fbm(plane.add(normalize(moonDir.xz.add(vec2(0.0001))).mul(0.09)));
	const rim = clamp(n.sub(ahead).mul(5).add(0.5), 0, 1);
	const cloud = vec3(0.0034, 0.004, 0.0058)
		.add(vec3(0.0058, 0.006, 0.0066).mul(pow(float(1).sub(up), 3)))
		.add(city.mul(1.6))
		.add(
			moonlight
				.mul(pow(toward, 10).mul(0.12).add(pow(toward, 60).mul(0.6)).add(0.004))
				.mul(rim)
				.mul(float(1.15).sub(density)),
		);
	const disc = smoothstep(0.99972, 0.99978, dot(d, moonDir));
	const seas = noise(d.xy.sub(moonDir.xy).mul(900).add(vec2(3, 7)))
		.mul(0.22)
		.add(0.78);
	const moon = vec3(1, 0.96, 0.88).mul(seas.mul(disc).mul(2.4));
	const material = new webgpu.MeshBasicNodeMaterial({ fog: false });
	material.colorNode = mix(air, cloud, density.mul(0.96))
		.add(moon.mul(float(1).sub(density.mul(0.85))))
		.mul(settings.brightness);
	return { material, setTime: (seconds) => (time.value = seconds) };
}
