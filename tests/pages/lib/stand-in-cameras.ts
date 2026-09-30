// Cameras with no engine behind them, for the tests of the camera controls. Each keeps its pose in
// 32-bit floats and turns toward a point as the engine's cameras do, and allocates nothing.
import { quat } from '@null3d/engine';

/** The perspective camera's vertical field of view, in degrees. */
export const STAND_IN_FOV = 50;
/** The orthographic camera's view height at the start, in world units. */
export const STAND_IN_VIEW_HEIGHT = 8;

/** A perspective camera. */
export class StandInCamera {
	readonly isOrthographic: boolean = false;
	readonly fov = STAND_IN_FOV;
	/** The position, as the engine stores it. */
	readonly stored = new Float32Array(3);
	/** The rotation quaternion, as the engine stores it. */
	readonly rotation = new Float32Array(4);
	private readonly turn = new Float64Array(4);
	private readonly toward = new Float64Array(3);

	setPosition(x: number, y: number, z: number): void {
		this.stored[0] = x;
		this.stored[1] = y;
		this.stored[2] = z;
	}

	getPosition(out: { [index: number]: number }): void {
		out[0] = this.stored[0] as number;
		out[1] = this.stored[1] as number;
		out[2] = this.stored[2] as number;
	}

	/** Cameras look down their -Z axis, so the engine swaps the eye and the target. */
	lookAt(x: number, y: number, z: number): void {
		this.toward[0] = x;
		this.toward[1] = y;
		this.toward[2] = z;
		quat.lookAt(this.turn, this.toward, this.stored);
		this.rotation.set(this.turn);
	}
}

/** An orthographic camera whose width follows the canvas, as `createOrthographicCamera` makes. */
export class StandInOrthographic extends StandInCamera {
	override readonly isOrthographic = true;
	readonly width = undefined;
	height = STAND_IN_VIEW_HEIGHT;

	setOrthoHeight(height: number): void {
		this.height = height;
	}
}
