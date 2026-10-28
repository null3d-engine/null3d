// A lit custom material that samples six textures of its own, which is the most that custom WGSL
// declares. With the engine's lighting, its fragment stage reads twelve texture units. The
// texture-unit page draws it on a context that reports fewer units, so the engine refuses the
// material with E1209 instead of letting the device fail to link its shader.
import { defineSketch } from '@null3d/engine';

/** Texels in each row and column of every texture that the material samples. */
const SIZE = 4;

const SIX_TEXTURES = /* wgsl */ `
var first: texture_2d<f32>;
var second: texture_2d<f32>;
var third: texture_2d<f32>;
var fourth: texture_2d<f32>;
var fifth: texture_2d<f32>;
var sixth: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.uv;
    s.baseColor *= textureSample(first, firstSampler, uv).rgb;
    s.baseColor *= textureSample(second, secondSampler, uv).rgb;
    s.baseColor *= textureSample(third, thirdSampler, uv).rgb;
    s.baseColor *= textureSample(fourth, fourthSampler, uv).rgb;
    s.baseColor *= textureSample(fifth, fifthSampler, uv).rgb;
    s.baseColor *= textureSample(sixth, sixthSampler, uv).rgb;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#20242a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 50,
			position: [0, 0, 4],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-0.4, -0.8, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.3 });

	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const options = { width: SIZE, height: SIZE, data, colorSpace: 'srgb' } as const;
	const material = materials.shader({
		wgsl: SIX_TEXTURES,
		textures: {
			first: textures.fromData(options),
			second: textures.fromData(options),
			third: textures.fromData(options),
			fourth: textures.fromData(options),
			fifth: textures.fromData(options),
			sixth: textures.fromData(options),
		},
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9, widthSegments: 32, heightSegments: 16 }),
		material,
	});
});
