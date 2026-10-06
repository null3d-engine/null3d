// The skinning scene (bench/scenes/skinning.ts), which the parity test also draws with three.js's
// SkinnedMesh. Each character is a mesh whose own animator plays the clip of poses at its own
// speed, and whose vertices its joints skin. ?shadows puts the characters on a ground under a sun
// that casts their shadows, which must follow each pose. ?quantized stores the mesh as quantized
// glTF files do: positions in whole millimeters, which the inverse bind matrices scale back to
// meters as glTF asks of skinned meshes, normals and weights in normalized 8-bit integers, and
// joints in 8 bits. The skinning pass must read each type. ?blend makes the middle character see
// through, so the transparent pass draws it skinned. ?outline outlines the middle character with
// the default outline, whose mask must follow the pose. ?tone=none turns off the engine's
// default of ACES, as the parity test asks: the three.js twin draws with no tone mapping,
// three.js's default. ?textured draws the characters with a custom material that samples a texture
// of stripes along their height, at texture coordinates from their positions, so custom materials'
// textures must follow each way to skin. ?normalmap gives the characters tangents and the standard
// material a normal map of grooves around their bodies, so the tangents that each way skins must
// light the grooves alike: the skinning pass stores them in 8 bits. ?still holds every character in the clip's first pose,
// and the render scale at the whole canvas with the governor off, so frames of play compare pixel
// for pixel whenever they come: on a slow GPU the governor lowers the scale once its grace ends.
// ?late adds the characters during play, on the page's 'characters' message, and posts 'added'
// once their pipelines are built: the first skinned mesh downloads the skinning shader file. With
// ?extras the same message also turns bloom on and makes a line batch, two more features whose
// shaders load on first use. The engine cannot load animated models yet, so the rig comes from the
// engine's internal loader calls.
import { defineSketch } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import { OUTLINE_SETTINGS } from '../../../bench/scenes/outline';
import {
	AMBIENT,
	BACKGROUND,
	CHAIN,
	CHARACTERS,
	CLIP,
	characterMesh,
	GROUND,
	KEY_TIMES,
	rotationKeys,
	SKINNING_CAMERA,
	SUN,
} from '../../../bench/scenes/skinning';

const params = new URL(import.meta.url).searchParams;
const SHADOWS = params.has('shadows');
const QUANTIZED = params.has('quantized');
const BLEND = params.has('blend');
const OUTLINE = params.has('outline');
const TEXTURED = params.has('textured');
const NORMAL_MAPPED = params.has('normalmap');
const STILL = params.has('still');
const LATE = params.has('late');
const EXTRAS = params.has('extras');
/** Millimeters per meter: the scale of quantized positions. */
const MM = 1000;

/** The character's arrays, stored as the ?quantized switch asks. */
function characterArrays() {
	const { positions, normals, joints, weights, indices } = characterMesh();
	// Texture coordinates from the front: x across, and y up the character.
	const uvs = Array.from({ length: (positions.length / 3) * 2 }, (_, k) =>
		k % 2 === 0
			? (positions[(k >> 1) * 3] as number) + 0.5
			: (positions[(k >> 1) * 3 + 1] as number) / 2,
	);
	if (TEXTURED) return { positions, normals, joints, weights, indices, uvs };
	if (NORMAL_MAPPED) {
		// Each tangent runs around the body, square to its normal, with a handedness of 1.
		const tangents = Array.from({ length: (positions.length / 3) * 4 }, (_, k) => {
			const v = k >> 2;
			const [x, z] = [normals[v * 3] as number, normals[v * 3 + 2] as number];
			const length = Math.hypot(x, z) || 1;
			return [-z / length, 0, x / length, 1][k % 4] as number;
		});
		return { positions, normals, joints, weights, indices, uvs, tangents };
	}
	if (!QUANTIZED) return { positions, normals, joints, weights, indices };
	return {
		positions: Int16Array.from(positions, (v) => Math.round(v * MM)),
		normals: { array: Int8Array.from(normals, (v) => Math.round(v * 127)), normalized: true },
		joints: Uint8Array.from(joints),
		weights: { array: Uint8Array.from(weights, (v) => Math.round(v * 255)), normalized: true },
		indices,
	};
}

/** A joint's inverse bind matrix, row-major 3 × 4, scaled from millimeters with ?quantized. */
function inverseBind(matrix: readonly number[]): number[] {
	const scale = QUANTIZED ? 1 / MM : 1;
	return matrix.map((v, k) => (k % 4 === 3 ? v : v * scale));
}

/** Stripes of a texture along the characters' height, for ?textured. */
const STRIPED = /* wgsl */ `
var stripes: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= textureSample(stripes, stripesSampler, input.uv * vec2f(1.0, 6.0)).rgb;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, post, textures, page, quality }) => {
	if (STILL) quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	if (OUTLINE) post.set({ outline: OUTLINE_SETTINGS.plain });
	scene.setBackground(BACKGROUND);
	const { fov, position, target, near, far } = SKINNING_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, position, target, near, far }));
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
		castShadows: SHADOWS,
		shadow: { cascades: 2, mapSize: 2048, distance: 15 },
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	if (SHADOWS)
		scene.createMesh({
			mesh: geometry.box({ width: GROUND.size, height: 0.1, depth: GROUND.size }),
			material: materials.standard({ color: GROUND.color }),
			position: [0, -0.05, 0],
			receiveShadows: true,
		});

	const rig = createAnimationRig(scene, {
		joints: CHAIN.map((joint, j) => ({
			name: `joint${j}`,
			parent: joint.parent,
			translation: [...joint.translation],
			rotation: [0, 0, 0, 1],
			scale: [1, 1, 1],
			inverseBind: inverseBind(joint.inverseBind),
		})),
		clips: [
			{
				name: CLIP,
				tracks: CHAIN.map((_, j) => ({
					joint: j,
					channel: 'rotation' as const,
					interpolation: 'step' as const,
					times: KEY_TIMES,
					values: rotationKeys(j),
				})),
			},
		],
	});
	const mesh = geometry.fromArrays(characterArrays());
	const stripes = TEXTURED
		? textures.fromData({
				width: 1,
				height: 2,
				data: Uint8Array.of(255, 255, 255, 255, 60, 60, 60, 255),
				colorSpace: 'srgb',
				wrap: 'repeat',
				filter: 'nearest',
			})
		: undefined;
	// Grooves across the texture's width: normals that lean left and right in tangent space.
	const grooves = NORMAL_MAPPED
		? textures.fromData({
				width: 8,
				height: 1,
				data: Uint8Array.from({ length: 32 }, (_, k) => {
					const lean = 0.6 * Math.sin(((k >> 2) / 8) * 2 * Math.PI);
					const n = [lean, 0, Math.sqrt(1 - lean * lean), 1][k % 4] as number;
					return k % 4 === 3 ? 255 : Math.round((n * 0.5 + 0.5) * 255);
				}),
				colorSpace: 'linear',
				wrap: 'repeat',
				filter: 'linear',
			})
		: undefined;
	const addCharacters = () => {
		for (const [k, character] of CHARACTERS.entries()) {
			const seeThrough = BLEND && k === 1 ? { alphaMode: 'blend' as const, opacity: 0.6 } : {};
			const object = scene.createMesh({
				mesh,
				material: stripes
					? materials.shader({ wgsl: STRIPED, color: character.color, textures: { stripes } })
					: materials.standard({
							color: character.color,
							...seeThrough,
							...(grooves && { normalMap: grooves, roughness: 0.4 }),
						}),
				position: [...character.position],
				castShadows: SHADOWS,
				receiveShadows: SHADOWS,
			});
			if (OUTLINE && k === 1) object.setOutlined(true);
			const animator = animateObject(object, rig);
			skinObject(object, animator);
			animator.play(CLIP, { speed: STILL ? 0 : character.speed });
		}
	};
	if (!LATE) {
		addCharacters();
		return;
	}
	page.onMessage((message) => {
		if (message !== 'characters') return;
		addCharacters();
		const extras = EXTRAS ? addExtras() : Promise.resolve();
		void extras.then(() => scene.warmUp()).then(() => page.post('added', null));
	});
	/** Turns bloom on and draws a line across the characters' feet. */
	const addExtras = async () => {
		post.set({ bloom: { intensity: 0.4 } });
		await scene.createLines({
			positions: Float32Array.of(-2, 0.02, 0.5, 2, 0.02, 0.5),
			width: 3,
		});
	};
});
