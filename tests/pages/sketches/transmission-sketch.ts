// The glass scene (bench/scenes/transmission.ts), which the parity test also draws with three.js:
// a smooth, a rough and a tinted glass ball in front of a striped wall. Each ball lets all the
// light behind it through, from the copy of the opaque objects' color. ?thin gives the balls no
// thickness, so they bend no light, and ?empty leaves them out: the transmission spec compares
// each with the scene. ?custom draws the balls with a custom material whose surface function sets
// the transmission itself.
// ?blend adds a blended pane in front of the balls, which draws in the same pass as they do.
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

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
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
	const [widthSegments, heightSegments] = BALL_SEGMENTS;
	const ball = geometry.sphere({ radius: BALL_RADIUS, widthSegments, heightSegments });
	const balls = params.has('empty') ? [] : TRANSMISSION_BALLS;
	const thin = params.has('thin');
	for (const { position: center, roughness, thickness, attenuation } of balls) {
		const options = {
			color: '#ffffff',
			metalness: 0,
			roughness,
			ior: BALL_IOR,
			transmission: 1,
			thickness: thin ? 0 : thickness,
			...(attenuation
				? { attenuationColor: attenuation.color, attenuationDistance: attenuation.distance }
				: {}),
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
