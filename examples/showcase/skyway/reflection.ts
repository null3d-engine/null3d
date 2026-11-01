// The hero car's own reflection in the wet road. Screen-space reflections cannot show it, because
// the car's underside never comes on screen. A camera under the road, turned about the road's plane,
// draws the car alone into a texture that the ground reads where it is wet. The pass clears to
// transparent black and draws no background, so the texture holds the car and nothing else, and the
// ground adds it over its own shading.
import {
	type PerspectiveCamera,
	type QuatLike,
	quat,
	type SketchContext,
	type Texture,
	vec3,
} from '@null3d/engine';
import { HERO_LAYER, ROAD } from './layout';

/**
 * Writes the turn of a camera under the road, from the turn of the camera above it: the turn
 * mirrored across the road negates its parts about the two level axes, which leaves a proper turn.
 * That camera draws the mirror image turned upside down, which the ground's texture coordinates
 * undo.
 */
export function mirrorTurn(out: QuatLike, turn: QuatLike): void {
	out[0] = -(turn[0] as number);
	out[1] = turn[1] as number;
	out[2] = -(turn[2] as number);
	out[3] = turn[3] as number;
}

/** The car's reflection, and the camera that draws it. */
export interface Reflection {
	/** The texture that the ground reads: the car mirrored under the road, on black. */
	readonly mirror: Texture;
	/** Turns the mirror camera about the road. Call once per frame, after the camera moves. */
	update(): void;
}

/**
 * Makes the pass that mirrors the hero car in the road under it. Give the texture to the ground's
 * material, and call `update` each frame after the camera has moved: the mirror follows the camera
 * that the frame draws from.
 */
export function createReflection(ctx: SketchContext, camera: PerspectiveCamera): Reflection {
	const { scene, render, textures } = ctx;
	const under = scene.createPerspectiveCamera({
		fov: camera.fov,
		near: camera.near,
		far: camera.far,
	});
	const pass = render.addPass({
		kind: 'scene',
		camera: under,
		writes: 'carMirror',
		// The same size as the frame, so the road's points read the mirror at their own pixel.
		scale: 1,
		layers: HERO_LAYER,
		clearColor: [0, 0, 0],
		clearAlpha: 0,
	});
	const mirror = textures.fromPass(pass);
	const at = vec3.create();
	const turn = quat.create();
	const mirrored = quat.create();
	return {
		mirror,
		update() {
			camera.getPosition(at);
			under.setPosition(at[0] as number, 2 * ROAD - (at[1] as number), at[2] as number);
			camera.getRotation(turn);
			mirrorTurn(mirrored, turn);
			under.setRotation(
				mirrored[0] as number,
				mirrored[1] as number,
				mirrored[2] as number,
				mirrored[3] as number,
			);
			// The lens is the drawn camera's, so the mirror image lands where the road's points do.
			if (under.fov !== camera.fov) under.setFov(camera.fov);
			if (under.near !== camera.near || under.far !== camera.far)
				under.setNearFar(camera.near, camera.far);
		},
	};
}
