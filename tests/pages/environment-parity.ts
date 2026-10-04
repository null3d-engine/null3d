// Reads three.js's prefiltered environment (PMREMGenerator) of an HDR file, for the parity test of
// the asset tool's environment maps. The page offers `pmremLight(request)`: three.js loads the file
// with HDRLoader, as its examples do, prefilters it with PMREMGenerator.fromEquirectangular, and
// samples the result with textureCubeUV, the lookup that its standard material uses, in each
// direction at each roughness. Floats come back exactly, through a float render target.
import {
	DataTexture,
	FloatType,
	GLSL3,
	Mesh,
	NoBlending,
	OrthographicCamera,
	PlaneGeometry,
	PMREMGenerator,
	RGBAFormat,
	ShaderMaterial,
	WebGLRenderer,
	WebGLRenderTarget,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { run } from './lib/result';

interface PmremRequest {
	/** The HDR file's address. */
	url: string;
	/** Three numbers per direction. */
	directions: number[];
	roughness: number[];
}

interface PmremLight {
	/** The width of the PMREM's largest faces. */
	cubeSize: number;
	/** Three numbers per direction, each direction once per roughness, in the request's order. */
	light: number[];
}

declare global {
	interface Window {
		pmremLight?: (request: PmremRequest) => Promise<PmremLight>;
	}
}

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D envMap;
uniform sampler2D directions;
uniform float roughness;
out vec4 color;
#define ENVMAP_TYPE_CUBE_UV
#include <cube_uv_reflection_fragment>
void main() {
	ivec2 at = ivec2(gl_FragCoord.xy);
	vec3 direction = texelFetch(directions, at, 0).xyz;
	color = vec4(textureCubeUV(envMap, direction, roughness).rgb, 1.0);
}`;

run('environment-parity', async () => {
	const canvas = document.createElement('canvas');
	const renderer = new WebGLRenderer({ canvas });
	window.pmremLight = async ({ url, directions, roughness }) => {
		const hdr = await new HDRLoader().setDataType(FloatType).loadAsync(url);
		const pmrem = new PMREMGenerator(renderer).fromEquirectangular(hdr);
		const count = directions.length / 3;
		const width = Math.min(count, 256);
		const height = Math.ceil(count / width);
		const texels = new Float32Array(width * height * 4);
		for (let i = 0; i < count; i++) texels.set(directions.slice(3 * i, 3 * i + 3), 4 * i);
		const directionTexture = new DataTexture(texels, width, height, RGBAFormat, FloatType);
		directionTexture.needsUpdate = true;
		const target = new WebGLRenderTarget(width, height, { type: FloatType });
		const material = new ShaderMaterial({
			glslVersion: GLSL3,
			vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
			fragmentShader: FRAGMENT,
			defines: {
				CUBEUV_TEXEL_WIDTH: 1 / pmrem.width,
				CUBEUV_TEXEL_HEIGHT: 1 / pmrem.height,
				CUBEUV_MAX_MIP: `${Math.log2(pmrem.height / 4)}.0`,
			},
			uniforms: {
				envMap: { value: pmrem.texture },
				directions: { value: directionTexture },
				roughness: { value: 0 },
			},
			blending: NoBlending,
			depthTest: false,
		});
		const quad = new Mesh(new PlaneGeometry(2, 2), material);
		const camera = new OrthographicCamera();
		const pixels = new Float32Array(width * height * 4);
		const light: number[] = [];
		for (const r of roughness) {
			(material.uniforms.roughness as { value: number }).value = r;
			renderer.setRenderTarget(target);
			renderer.render(quad, camera);
			renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
			for (let i = 0; i < count; i++)
				light.push(
					pixels[4 * i] as number,
					pixels[4 * i + 1] as number,
					pixels[4 * i + 2] as number,
				);
		}
		renderer.setRenderTarget(null);
		for (const disposable of [hdr, pmrem, directionTexture, target, material, quad.geometry])
			disposable.dispose();
		return { cubeSize: pmrem.height / 4, light };
	};
	return {};
});
