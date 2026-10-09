// The pose of a camera that fly and first-person controls move: its position and rotation in double
// precision, as three.js keeps them. The camera stores 32-bit floats, so the controls keep their own
// copy, and take the camera's pose only when something else changed it. Nothing here allocates.

import type { OrthographicCamera, PerspectiveCamera } from '@null3d/engine';

/** A squared distance past which the camera counts as moved, as in three.js. */
const MOVED = 0.000001;

export class CameraPose {
	/** The camera's position. */
	readonly position = new Float64Array(3);
	/** The camera's rotation as a quaternion (x, y, z, w). */
	readonly rotation = new Float64Array(4);
	/**
	 * The position and the rotation as the camera stores them, after the last write or read. They
	 * start as NaN, which equals nothing, so the first `sync` takes the camera's pose.
	 */
	private readonly stored = new Float64Array(7).fill(Number.NaN);
	/** Where `sync` reads the camera's position, and then its rotation. */
	private readonly read = new Float64Array(4);
	/** The position and the rotation that `changed` last reported. */
	private readonly reported = new Float64Array(7);

	constructor(private readonly camera: PerspectiveCamera | OrthographicCamera) {
		this.sync();
		this.reported.set(this.position);
		this.reported.set(this.rotation, 3);
	}

	/** Takes the camera's position and rotation, unless they are still those the controls wrote. */
	sync(): void {
		const { read, stored, position, rotation } = this;
		this.camera.getPosition(read);
		if (read[0] !== stored[0] || read[1] !== stored[1] || read[2] !== stored[2])
			for (let k = 0; k < 3; k++) {
				position[k] = read[k] as number;
				stored[k] = read[k] as number;
			}
		this.camera.getRotation(read);
		if (
			read[0] !== stored[3] ||
			read[1] !== stored[4] ||
			read[2] !== stored[5] ||
			read[3] !== stored[6]
		)
			for (let k = 0; k < 4; k++) {
				rotation[k] = read[k] as number;
				stored[3 + k] = read[k] as number;
			}
	}

	/** Writes the position and the rotation to the camera. */
	write(): void {
		const { camera, position: p, rotation: r } = this;
		camera.setPosition(p[0] as number, p[1] as number, p[2] as number);
		camera.setRotation(r[0] as number, r[1] as number, r[2] as number, r[3] as number);
		this.keepStored();
	}

	/** Writes the position alone to the camera. */
	writePosition(): void {
		const p = this.position;
		this.camera.setPosition(p[0] as number, p[1] as number, p[2] as number);
		this.keepStored();
	}

	/**
	 * True when the camera moved or turned since the last call that returned true, by three.js's
	 * measure of a change.
	 */
	changed(): boolean {
		const { position, rotation, reported } = this;
		let moved = 0;
		let dot = 0;
		for (let k = 0; k < 3; k++) {
			const d = (position[k] as number) - (reported[k] as number);
			moved += d * d;
		}
		for (let k = 0; k < 4; k++) dot += (rotation[k] as number) * (reported[3 + k] as number);
		if (!(moved > MOVED || 8 * (1 - Math.abs(dot)) > MOVED)) return false;
		reported.set(position);
		reported.set(rotation, 3);
		return true;
	}

	/** Notes the pose as the camera stores it, after a write. */
	private keepStored(): void {
		const { read, stored } = this;
		this.camera.getPosition(read);
		for (let k = 0; k < 3; k++) stored[k] = read[k] as number;
		this.camera.getRotation(read);
		for (let k = 0; k < 4; k++) stored[3 + k] = read[k] as number;
	}
}
