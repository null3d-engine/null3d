// The pedunculate oak's shipped textures in a live engine, for the plant textures test. It loads the
// six files of both sets, as the plant material binds them: the leaf colour, leaf relief and both
// bark maps as texture arrays, the leaf relief an array of one layer, and the young bark as 2D
// textures. Two planes draw them, the full set on the left and the half set on the right, each in
// eight upright strips: leaf upper and lower faces, leaf relief, bark colour and relief, young bark
// colour and relief, and the leaf's coverage. Once every texture is on the GPU, it sends the page
// each texture's size, layers and format.
import { defineSketch, type Texture } from '@null3d/engine';
import { files } from '@null3d/vegetation-textures/pedunculate-oak';

const STRIPS_WGSL = /* wgsl */ `
var leafColor: texture_2d_array<f32>;
var leafNormal: texture_2d_array<f32>;
var barkColor: texture_2d_array<f32>;
var barkNormal: texture_2d_array<f32>;
var youngColor: texture_2d<f32>;
var youngNormal: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let strip = clamp(i32(input.uv.x * 8.0), 0, 7);
    // Within a strip, the texture's middle half, so each strip shows the texture's own texels.
    let uv = vec2f(0.25 + fract(input.uv.x * 8.0) * 0.5, 0.25 + input.uv.y * 0.5);
    let upper = textureSampleLevel(leafColor, leafColorSampler, uv, 0, 0.0);
    let lower = textureSampleLevel(leafColor, leafColorSampler, uv, 1, 0.0);
    let relief = textureSampleLevel(leafNormal, leafNormalSampler, uv, 0, 0.0);
    let bark = textureSampleLevel(barkColor, barkColorSampler, uv, 0, 0.0);
    let barkRelief = textureSampleLevel(barkNormal, barkNormalSampler, uv, 0, 0.0);
    let young = textureSampleLevel(youngColor, youngColorSampler, uv, 0.0);
    let youngRelief = textureSampleLevel(youngNormal, youngNormalSampler, uv, 0.0);
    var colour = upper.rgb;
    if (strip == 1) { colour = lower.rgb; }
    if (strip == 2) { colour = relief.rgb; }
    if (strip == 3) { colour = bark.rgb; }
    if (strip == 4) { colour = barkRelief.rgb; }
    if (strip == 5) { colour = young.rgb; }
    if (strip == 6) { colour = youngRelief.rgb; }
    if (strip == 7) { colour = vec3f(upper.a); }
    s.baseColor = vec3f(0.0);
    s.metalness = 0.0;
    s.roughness = 1.0;
    s.emissive = colour;
    return s;
}
`;

export default defineSketch(async ({ scene, materials, geometry, assets, textures, page }) => {
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: 1,
			near: 0.1,
			far: 10,
			position: [0, 0, 4],
			target: [0, 0, 0],
		}),
	);
	const sets = [files.full, files.half] as const;
	const loaded: { set: string; name: string; texture: Texture }[] = [];
	for (const [index, set] of sets.entries()) {
		const name = index === 0 ? 'full' : 'half';
		const load = async (key: keyof typeof set) => {
			const url = set[key];
			if (!url) throw new Error(`the oak's ${name} set has no ${key}`);
			const texture = await assets.loadTexture(url, { wrap: 'repeat' });
			loaded.push({ set: name, name: key, texture });
			return texture;
		};
		const material = materials.shader({
			wgsl: STRIPS_WGSL,
			textures: {
				leafColor: await load('leafColor'),
				leafNormal: await load('leafNormal'),
				barkColor: await load('barkColor'),
				barkNormal: await load('barkNormal'),
				youngColor: await load('youngColor'),
				youngNormal: await load('youngNormal'),
			},
		});
		scene.createMesh({
			mesh: geometry.plane({ width: 1, height: 1 }),
			material,
			position: [index === 0 ? -0.5 : 0.5, 0, 0],
		});
	}
	let sent = false;
	return {
		onUpdate() {
			if (sent || textures.uploads().waiting > 0) return;
			sent = true;
			page.post('result', {
				textures: loaded.map(({ set, name, texture }) => ({
					set,
					name,
					size: [texture.width, texture.height, texture.depth],
					format: texture.format,
					colorSpace: texture.colorSpace,
				})),
				manifest: { species: files.manifest.species, outputs: files.manifest.outputs.length },
			});
		},
	};
});
