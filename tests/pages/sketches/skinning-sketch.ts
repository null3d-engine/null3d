// The skinning scene (bench/scenes/skinning.ts), which the parity test also draws with three.js's
// SkinnedMesh. Each character is a mesh whose own animator plays the clip of poses at its own
// speed, and whose vertices its joints skin. ?shadows puts the characters on a ground under a sun
// that casts their shadows, which must follow each pose. ?quantized stores the mesh as quantized
// glTF files do: positions in whole millimeters, which the inverse bind matrices scale back to
// meters as glTF asks of skinned meshes, normals and weights in normalized 8-bit integers, and
// joints in 8 bits. The skinning pass must read each type. ?blend makes the middle character see
// through, so the transparent pass draws it skinned. ?tone=none turns off the engine's default
// of ACES, as the parity test asks: the three.js twin draws with no tone mapping, three.js's
// default. ?textured draws the characters with a custom material that samples a texture of
// stripes along their height, at texture coordinates from their positions, so custom materials'
// textures must follow each way to skin. The engine cannot load animated models yet, so the rig comes from the engine's internal
// loader calls.
import { defineSketch } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
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
const TEXTURED = params.has('textured');
/** Millimeters per meter: the scale of quantized positions. */
const MM = 1000;

/** The character's arrays, stored as the ?quantized switch asks. */
function characterArrays() {
	const { positions, normals, joints, weights, indices } = characterMesh();
	if (TEXTURED) {
		// Texture coordinates from the front: x across, and y up the character.
		const uvs = Array.from({ length: (positions.length / 3) * 2 }, (_, k) =>
			k % 2 === 0
				? (positions[(k >> 1) * 3] as number) + 0.5
				: (positions[(k >> 1) * 3 + 1] as number) / 2,
		);
		return { positions, normals, joints, weights, indices, uvs };
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

export default defineSketch(({ scene, materials, geometry, post, textures }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
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
	for (const [k, character] of CHARACTERS.entries()) {
		const seeThrough = BLEND && k === 1 ? { alphaMode: 'blend' as const, opacity: 0.6 } : {};
		const object = scene.createMesh({
			mesh,
			material: stripes
				? materials.shader({ wgsl: STRIPED, color: character.color, textures: { stripes } })
				: materials.standard({ color: character.color, ...seeThrough }),
			position: [...character.position],
			castShadows: SHADOWS,
			receiveShadows: SHADOWS,
		});
		const animator = animateObject(object, rig);
		skinObject(object, animator);
		animator.play(CLIP, { speed: character.speed });
	}
});
