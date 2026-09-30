// The WebGL2 backend's depth modes. Draw lists and shaders keep WebGPU's reversed depth: clip depth
// runs from w at the near plane to 0 at the far plane. Each GLSL vertex shader maps that depth
// through a uniform, so one program serves every mode, and the backend sets GL's depth range and
// depth test to match.

import type { DepthMode } from '../../page/switches';

/** How the backend draws one depth mode. */
export interface DepthSetup {
	/** The vertex shader writes `z * scale + w * offset` as its clip depth. */
	readonly scale: number;
	readonly offset: number;
	/**
	 * True when GL's clip depth runs from 0 to w, as WebGPU's does, through `EXT_clip_control`.
	 * GL then stores the depth that the shader writes as it is. Otherwise GL's clip depth runs from
	 * -w to w, and GL stores half of it plus one half.
	 */
	readonly zeroToOne: boolean;
	/**
	 * True when the near plane stores 0 and the far plane 1. The depth test then keeps the lesser
	 * depth, and clear values and viewport depth ranges turn around.
	 */
	readonly standard: boolean;
}

export const DEPTH_SETUPS: Readonly<Record<DepthMode, DepthSetup>> = {
	// WebGPU's clip depth as it is.
	reversed: { scale: 1, offset: 0, zeroToOne: true, standard: false },
	// The same depth moved into GL's range: 2z - w.
	'reversed-gl': { scale: 2, offset: -1, zeroToOne: false, standard: false },
	// The depth turned around and moved into GL's range: w - 2z.
	standard: { scale: -2, offset: 1, zeroToOne: false, standard: true },
};

/** `EXT_clip_control`, which TypeScript's DOM types do not describe. */
interface ClipControl {
	readonly LOWER_LEFT_EXT: number;
	readonly ZERO_TO_ONE_EXT: number;
	clipControlEXT(origin: number, depth: number): void;
}

/**
 * Sets the context up for a depth mode, and returns how the backend draws it. A context without
 * `EXT_clip_control` draws `reversed` depth as `reversed-gl`. A context lost while the backend
 * starts answers no extension, so the frames until its restore draw that way too.
 */
export function setDepthMode(gl: WebGL2RenderingContext, mode: DepthMode): DepthSetup {
	let setup = DEPTH_SETUPS[mode];
	if (setup.zeroToOne) {
		const clip = gl.getExtension('EXT_clip_control') as ClipControl | null;
		// The origin stays at the lower left, GL's own, so the image keeps GL's row order.
		if (clip) clip.clipControlEXT(clip.LOWER_LEFT_EXT, clip.ZERO_TO_ONE_EXT);
		else setup = DEPTH_SETUPS['reversed-gl'];
	}
	gl.depthFunc(setup.standard ? gl.LESS : gl.GREATER);
	return setup;
}
