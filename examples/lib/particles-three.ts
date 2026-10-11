// The comparison scenes' particles in three.js, with the methods of its official examples: on
// WebGLRenderer, `Points` with a sprite texture, a size and an RGBA color per point, as the points
// sprites example draws them; on WebGPURenderer, a `Sprite` drawn once per particle with
// `PointsNodeMaterial` and instanced attributes, as the instanced points example draws them. Both
// keep each particle's size in meters with size attenuation, and neither sorts its particles, as
// three.js leaves the order of points to the buffer.

import type * as ThreeModule from 'three';
import type { ParticleLook, ParticleMaker, ParticleRows, Particles } from './particles';
import type { Three } from './three-worker';

/**
 * A point's size factor for a camera's vertical field of view: three.js scales a point's size by
 * half the canvas's height over its depth, so a size of h / tan(fov / 2) spans h meters.
 */
function sizeFactor(fovDegrees: number): number {
	return 1 / Math.tan((fovDegrees * Math.PI) / 360);
}

function particleTexture(three: Three, look: ParticleLook): ThreeModule.DataTexture {
	const { size, data } = look.texture;
	const texture = new three.DataTexture(data, size, size);
	texture.colorSpace = three.SRGBColorSpace;
	texture.magFilter = three.LinearFilter;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

/** Makes a three.js scene's particle systems, for the renderer of the run. */
export function threeParticles(
	three: Three,
	renderer: 'webgl' | 'webgpu',
	scene: ThreeModule.Scene,
	camera: ThreeModule.PerspectiveCamera,
): ParticleMaker {
	return async (look: ParticleLook): Promise<Particles> => {
		const n = look.capacity;
		const positions = new Float32Array(n * 3);
		const sizes = new Float32Array(n * 2);
		const colors = new Float32Array(n * 4);
		const rows: ParticleRows = { positions, sizes, colors };
		const map = particleTexture(three, look);
		const blending = look.blending === 'additive' ? three.AdditiveBlending : three.NormalBlending;
		const attributes = [
			new three.BufferAttribute(positions, 3),
			new three.BufferAttribute(sizes, 2),
			new three.BufferAttribute(colors, 4),
		] as const;
		const upload = (count: number) => {
			for (const attribute of attributes) {
				attribute.clearUpdateRanges();
				attribute.addUpdateRange(0, count * attribute.itemSize);
				attribute.needsUpdate = true;
			}
		};
		if (renderer === 'webgpu') {
			const webgpu = three as unknown as typeof import('three/webgpu');
			const tsl = await import('three/tsl');
			const instanced = [
				new webgpu.InstancedBufferAttribute(positions, 3),
				new webgpu.InstancedBufferAttribute(sizes, 2),
				new webgpu.InstancedBufferAttribute(colors, 4),
			] as const;
			for (const attribute of instanced) attribute.setUsage(three.DynamicDrawUsage);
			const [position, size, color] = instanced.map((attribute) =>
				tsl.instancedBufferAttribute(attribute),
			);
			const picture = tsl.texture(map, tsl.uv());
			const material = new webgpu.PointsNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending,
				sizeAttenuation: true,
				fog: look.fog,
			});
			material.positionNode = position as never;
			material.sizeNode = (size as ReturnType<typeof tsl.vec2>).mul(
				sizeFactor(camera.fov),
			) as never;
			material.colorNode = picture.rgb.mul((color as ReturnType<typeof tsl.vec4>).rgb) as never;
			material.opacityNode = picture.a.mul((color as ReturnType<typeof tsl.vec4>).a) as never;
			const sprite = new webgpu.Sprite(material);
			sprite.count = 0;
			sprite.frustumCulled = false;
			sprite.name = look.name;
			scene.add(sprite);
			return {
				rows: () => rows,
				commit(count) {
					sprite.count = count;
					for (const attribute of instanced) {
						attribute.clearUpdateRanges();
						attribute.addUpdateRange(0, count * attribute.itemSize);
						attribute.needsUpdate = true;
					}
				},
			};
		}
		const geometry = new three.BufferGeometry();
		for (const attribute of attributes) attribute.setUsage(three.DynamicDrawUsage);
		geometry.setAttribute('position', attributes[0]);
		geometry.setAttribute('townSize', attributes[1]);
		geometry.setAttribute('color', attributes[2]);
		geometry.setDrawRange(0, 0);
		const material = new three.PointsMaterial({
			map,
			size: sizeFactor(camera.fov),
			sizeAttenuation: true,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending,
			fog: look.fog,
		});
		// Each point takes its own size from its row.
		material.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute vec2 townSize;')
				.replace('gl_PointSize = size;', 'gl_PointSize = size * townSize.y;');
		};
		material.customProgramCacheKey = () => 'night-town-points';
		const points = new three.Points(geometry, material);
		points.frustumCulled = false;
		points.name = look.name;
		scene.add(points);
		return {
			rows: () => rows,
			commit(count) {
				geometry.setDrawRange(0, count);
				upload(count);
			},
		};
	};
}
