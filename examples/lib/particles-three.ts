// A layer of particles in three.js: one quad drawn once per sprite, which turns to face the camera
// in its vertex shader, as three.js's own instancing examples draw many copies of a shape. Each
// sprite's place, size, turn, color and atlas frame are instanced attributes, filled from a
// scene's sprite rows (examples/lib/particles.ts). WebGLRenderer draws it with a ShaderMaterial in
// GLSL that takes three.js's fog chunks; WebGPURenderer with a node material, whose position node
// places the corner in the world so the scene's fog node sees the true place. three.js does not
// sort the sprites of one draw.

import type * as ThreeModule from 'three';
import type { SpriteLayer, SpriteRows } from './particles';
import type { Three } from './three-worker';

/** A drawn layer: its object, and `draw` copies the rows' live sprites into it each frame. */
export interface ThreeSprites {
	object: ThreeModule.Object3D;
	draw(rows: SpriteRows): void;
}

const VERTEX = /* glsl */ `
attribute vec3 spritePosition;
attribute vec2 spriteSize;
attribute float spriteRotation;
attribute vec4 spriteColor;
attribute float spriteFrame;
uniform vec2 atlas;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
	float c = cos( spriteRotation );
	float s = sin( spriteRotation );
	vec2 corner = position.xy * spriteSize;
	corner = vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y );
	vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
	vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
	vec3 transformed = spritePosition + right * corner.x + up * corner.y;
	gl_Position = projectionMatrix * viewMatrix * vec4( transformed, 1.0 );
	float column = mod( spriteFrame, atlas.x );
	float row = floor( spriteFrame / atlas.x );
	vUv = ( vec2( column, row ) + uv ) / atlas;
	vColor = spriteColor;
	#include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
	vec4 texel = texture2D( map, vUv );
	gl_FragColor = vec4( texel.rgb * vColor.rgb, texel.a * vColor.a );
	#include <fog_fragment>
}
`;

export async function threeSprites(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	layer: SpriteLayer,
): Promise<ThreeSprites> {
	const { capacity, atlas } = layer;
	const { texture } = atlas;
	const map = new three.DataTexture(texture.data, texture.size, texture.size, three.RGBAFormat);
	map.colorSpace = three.SRGBColorSpace;
	map.generateMipmaps = true;
	map.minFilter = three.LinearMipmapLinearFilter;
	map.magFilter = three.LinearFilter;
	map.needsUpdate = true;
	const geometry = new three.InstancedBufferGeometry();
	geometry.setAttribute(
		'position',
		new three.BufferAttribute(
			new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]),
			3,
		),
	);
	geometry.setAttribute(
		'uv',
		new three.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
	);
	geometry.setIndex([0, 1, 2, 2, 1, 3]);
	const instanced = (size: number) => {
		const attribute = new three.InstancedBufferAttribute(new Float32Array(capacity * size), size);
		attribute.setUsage(three.DynamicDrawUsage);
		return attribute;
	};
	const attributes = {
		spritePosition: instanced(3),
		spriteSize: instanced(2),
		spriteRotation: instanced(1),
		spriteColor: instanced(4),
		spriteFrame: instanced(1),
	};
	for (const [name, attribute] of Object.entries(attributes))
		geometry.setAttribute(name, attribute);
	geometry.instanceCount = 0;
	const blending = layer.blending === 'additive' ? three.AdditiveBlending : three.NormalBlending;
	let material: ThreeModule.Material;
	if (renderer === 'webgpu') {
		const webgpu = three as unknown as typeof import('three/webgpu');
		const tsl = await import('three/tsl');
		const node = new webgpu.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending,
			fog: layer.fog,
		});
		const position = tsl.attribute('spritePosition', 'vec3');
		const size = tsl.attribute('spriteSize', 'vec2');
		const turn = tsl.attribute('spriteRotation', 'float');
		const color = tsl.attribute('spriteColor', 'vec4');
		const frame = tsl.attribute('spriteFrame', 'float');
		const corner = tsl.positionGeometry.xy.mul(size);
		const c = tsl.cos(turn);
		const s = tsl.sin(turn);
		const turned = tsl.vec2(
			c.mul(corner.x).sub(s.mul(corner.y)),
			s.mul(corner.x).add(c.mul(corner.y)),
		);
		// The camera's right and up axes in the world: its world matrix turns the unit axes.
		const right = tsl.cameraWorldMatrix.mul(tsl.vec4(1, 0, 0, 0)).xyz;
		const up = tsl.cameraWorldMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
		node.positionNode = position.add(right.mul(turned.x)).add(up.mul(turned.y));
		const columns = tsl.float(atlas.columns);
		const rows = tsl.float(atlas.rows);
		const column = tsl.mod(frame, columns);
		const row = tsl.floor(frame.div(columns));
		const uv = tsl.vec2(column, row).add(tsl.uv()).div(tsl.vec2(columns, rows));
		const texel = tsl.texture(map, uv);
		node.colorNode = texel.rgb.mul(color.rgb);
		node.opacityNode = texel.a.mul(color.a);
		material = node as unknown as ThreeModule.Material;
	} else {
		material = new three.ShaderMaterial({
			uniforms: {
				map: { value: map },
				atlas: { value: new three.Vector2(atlas.columns, atlas.rows) },
				...three.UniformsLib.fog,
			},
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			transparent: true,
			depthWrite: false,
			blending,
			fog: layer.fog,
		});
	}
	const mesh = new three.Mesh(geometry, material);
	mesh.frustumCulled = false;
	return {
		object: mesh,
		draw(rows) {
			const count = Math.min(rows.count, capacity);
			copy(attributes.spritePosition, rows.positions, count * 3);
			copy(attributes.spriteSize, rows.sizes, count * 2);
			copy(attributes.spriteRotation, rows.rotations, count);
			copy(attributes.spriteColor, rows.colors, count * 4);
			copy(attributes.spriteFrame, rows.frames, count);
			geometry.instanceCount = count;
		},
	};
}

/** Copies the live values, and uploads only them. */
function copy(
	attribute: ThreeModule.InstancedBufferAttribute,
	from: Float32Array | Uint32Array,
	length: number,
): void {
	const to = attribute.array as Float32Array;
	for (let i = 0; i < length; i++) to[i] = from[i] as number;
	attribute.clearUpdateRanges();
	attribute.addUpdateRange(0, Math.max(length, 1));
	attribute.needsUpdate = true;
}
