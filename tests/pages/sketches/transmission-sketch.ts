// The glass scene (bench/scenes/transmission.ts), which the parity test also draws with three.js:
// a smooth, a rough and a tinted glass ball in front of a striped wall. Each ball lets all the
// light behind it through, from the copy of the opaque objects' color. ?thin gives the balls no
// thickness, so they bend no light, and ?empty leaves them out: the transmission spec compares
// each with the scene. ?custom draws the balls with a custom material whose surface function sets
// the transmission itself.
// ?blend adds a blended pane in front of the balls, which draws in the same pass as they do.
// ?maps varies the transmission and the thickness across each ball with the two maps that keep row
// slots beside the specular maps: bands of the transmission map's red, and bands of the thickness
// map's green. ?specular adds a specular intensity map in the same texture array, in bands of its
// own, so a material can carry both map families at once. ?env lights the scene from the built-in
// room, whose reflection the specular map varies. ?coat gives the balls a clear coat.
// ?tone=none turns the tone mapping off, as the parity test's three.js twin draws.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	BALL_IOR,
	BALL_RADIUS,
	BALL_SEGMENTS,
	SUN,
	TRANSMISSION_BALLS,
	TRANSMISSION_BOXES,
	TRANSMISSION_CAMERA,
} from '../../../bench/scenes/transmission';

const params = new URL(import.meta.url).searchParams;

/** A surface function that sets the transmission the material gives, as a custom material may. */
const glassWgsl = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.transmission = material.amount;
    return s;
}

struct Uniforms { amount: f32 }
`;

/** A texture of `size` square texels from a function of each texel's place, in 0 to 1. */
function texels(size: number, rgba: (u: number, v: number) => [number, number, number, number]) {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const at = (y * size + x) * 4;
			data.set(
				rgba((x + 0.5) / size, (y + 0.5) / size).map((c) => Math.round(c * 255)),
				at,
			);
		}
	return data;
}

/** Every share, in the texture that both the transmission map and the thickness map read. */
const BANDS = 4;

export default defineSketch(async ({ scene, materials, geometry, post, textures, assets }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	if (params.has('env')) {
		// A bright sky broadens what the specular map varies, so a picture shows it.
		scene.setEnvironment(await assets.skyEnvironment(), { intensity: 1 });
	}
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = TRANSMISSION_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));

	for (const { size, position: center, color } of TRANSMISSION_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color }),
			position: center,
		});
	}
	// The transmission map's red follows the bands across the sphere, and the thickness map's green
	// the bands up it, so each ball shows the wall through its light bands and bends the light
	// farther where its green is white.
	const bands = params.has('maps')
		? textures.fromData({
				width: 32,
				height: 32,
				data: texels(32, (u, v) => [
					(u * BANDS) % 1 < 0.5 ? 1 : 0.15,
					(v * BANDS) % 1 < 0.5 ? 1 : 0.1,
					0,
					1,
				]),
				colorSpace: 'linear',
			})
		: undefined;
	// The specular intensity map keeps its own rows of the same texture array, so the material
	// carries it beside the two volume maps: its alpha doubles the reflection in half the bands.
	const specular = params.has('specular')
		? textures.fromData({
				width: 32,
				height: 32,
				data: texels(32, (u) => [0, 0, 0, (u * BANDS) % 1 < 0.5 ? 1 : 0]),
				colorSpace: 'linear',
			})
		: undefined;
	const [widthSegments, heightSegments] = BALL_SEGMENTS;
	const ball = geometry.sphere({ radius: BALL_RADIUS, widthSegments, heightSegments });
	const balls = params.has('empty') ? [] : TRANSMISSION_BALLS;
	const thin = params.has('thin');
	const coat = params.has('coat') ? { clearcoat: 1, clearcoatRoughness: 0.2 } : {};
	// A specular color near a mirror's makes the reflection strong, so that the specular map's
	// bands show across the ball.
	const reflection = params.has('env')
		? { specularColor: [25, 25, 25] as [number, number, number], envIntensity: 1 }
		: {};
	for (const { position: center, roughness, thickness, attenuation } of balls) {
		const options = {
			color: '#ffffff',
			metalness: 0,
			roughness,
			ior: BALL_IOR,
			transmission: 1,
			thickness: thin ? 0 : thickness,
			...coat,
			...reflection,
			...(attenuation
				? { attenuationColor: attenuation.color, attenuationDistance: attenuation.distance }
				: {}),
			...(bands ? { transmissionMap: bands, thicknessMap: bands } : {}),
			...(specular ? { specularIntensityMap: specular } : {}),
		};
		const material = params.has('custom')
			? materials.shader({ ...options, wgsl: glassWgsl, uniforms: { amount: 1 } })
			: materials.standard(options);
		scene.createMesh({ mesh: ball, material, position: center });
	}
	if (params.has('blend')) {
		const pane = scene.createMesh({
			mesh: geometry.plane({ width: 1.4, height: 0.6 }),
			material: materials.standard({ color: '#f2c14e', opacity: 0.5, alphaMode: 'blend' }),
			position: [0, 0.4, 1.6],
		});
		pane.setRotationEuler(0, 0.2, 0);
	}
	return {};
});
