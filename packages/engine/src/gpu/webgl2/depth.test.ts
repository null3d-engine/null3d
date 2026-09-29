import { describe, expect, it } from 'bun:test';
import type { DepthMode } from '../../page/switches';
import { DEPTH_SETUPS, type DepthSetup, setDepthMode } from './depth';

const f = Math.fround;
const MODES = Object.keys(DEPTH_SETUPS) as DepthMode[];

/**
 * The depth GL stores for WebGPU clip depth `z` and `w`, in 32-bit floats as a GPU computes it:
 * the vertex shader's mapping, the divide by w, and GL's move into its default depth range.
 */
function stored(setup: DepthSetup, z: number, w: number): number {
	const clip = f(f(z * setup.scale) + f(w * setup.offset));
	const ndc = f(clip / w);
	return setup.zeroToOne ? ndc : f(f(ndc * 0.5) + 0.5);
}

/** True when a depth passes the mode's depth test against the depth already stored. */
function passes(setup: DepthSetup, incoming: number, kept: number): boolean {
	return setup.standard ? incoming < kept : incoming > kept;
}

/**
 * WebGPU clip depth and w of a point `distance` in front of a camera, through the camera's
 * reversed projection in 32-bit floats.
 */
function clipDepth(distance: number, near: number, far: number): [number, number] {
	const scale = f(near / f(far - near));
	const offset = f(f(near * far) / f(far - near));
	const w = f(distance);
	return [f(f(scale * -w) + offset), w];
}

describe('WebGL2 depth modes', () => {
	it('store the near plane and the far plane where their depth tests expect them', () => {
		for (const mode of MODES) {
			const setup = DEPTH_SETUPS[mode];
			const [near, far] = setup.standard ? [0, 1] : [1, 0];
			for (const w of [0.5, 1, 1000])
				expect([mode, w, stored(setup, w, w), stored(setup, 0, w)]).toEqual([mode, w, near, far]);
		}
	});

	it('let the nearer of two surfaces through, and every surface through a cleared buffer', () => {
		for (const mode of MODES) {
			const setup = DEPTH_SETUPS[mode];
			const nearer = stored(setup, 0.6, 1);
			const farther = stored(setup, 0.3, 1);
			// The draw list clears to 0, its far plane, which standard depth turns into 1.
			const cleared = setup.standard ? 1 : 0;
			expect([mode, passes(setup, nearer, farther), passes(setup, farther, nearer)]).toEqual([
				mode,
				true,
				false,
			]);
			expect([mode, passes(setup, farther, cleared)]).toEqual([mode, true]);
		}
	});

	it('write the same clip depth in reversed-gl as the fixed step that GL range needs, 2z - w', () => {
		const setup = DEPTH_SETUPS['reversed-gl'];
		for (const [z, w] of [
			[0.3, 1],
			[0.0999, 7.25],
			[1e-6, 9999.5],
		] as const)
			expect(f(f(z * setup.scale) + f(w * setup.offset))).toBe(f(f(z * 2) - f(w)));
	});

	it('tell surfaces 1 cm apart apart from 5 to 10 km only in reversed depth', () => {
		const near = 0.1;
		const far = 20_000;
		const right = new Map<DepthMode, number>();
		const pairs = 100;
		for (const mode of MODES) {
			const setup = DEPTH_SETUPS[mode];
			let count = 0;
			for (let k = 0; k < pairs; k++) {
				const distance = 5_000 + k * 50.5;
				const front = stored(setup, ...clipDepth(distance, near, far));
				const back = stored(setup, ...clipDepth(distance + 0.01, near, far));
				if (passes(setup, front, back) && !passes(setup, back, front)) count++;
			}
			right.set(mode, count);
		}
		expect(right.get('reversed')).toBe(pairs);
		expect(right.get('reversed-gl')).toBeLessThan(pairs / 2);
		expect(right.get('standard')).toBeLessThan(pairs / 2);
	});

	it('tell surfaces 1 cm apart apart within 10 m in every mode', () => {
		for (const mode of MODES) {
			const setup = DEPTH_SETUPS[mode];
			for (let distance = 1; distance <= 10; distance += 0.25) {
				const front = stored(setup, ...clipDepth(distance, 0.1, 20_000));
				const back = stored(setup, ...clipDepth(distance + 0.01, 0.1, 20_000));
				expect([mode, distance, passes(setup, front, back)]).toEqual([mode, distance, true]);
			}
		}
	});

	/** A stand-in for a WebGL2 context, which notes the calls that set depth up. */
	function context(clipControl: boolean): { gl: WebGL2RenderingContext; calls: string[] } {
		const calls: string[] = [];
		const extension = {
			LOWER_LEFT_EXT: 0x8ca1,
			ZERO_TO_ONE_EXT: 0x935f,
			clipControlEXT: (origin: number, depth: number) => calls.push(`clip ${origin} ${depth}`),
		};
		const gl = {
			LESS: 0x0201,
			GREATER: 0x0204,
			depthFunc: (func: number) => calls.push(`depthFunc ${func}`),
			getExtension: (name: string) =>
				clipControl && name === 'EXT_clip_control' ? extension : null,
		};
		return { gl: gl as unknown as WebGL2RenderingContext, calls };
	}

	it('set a range from 0 to 1 with EXT_clip_control, and the depth test of each mode', () => {
		const reversed = context(true);
		expect(setDepthMode(reversed.gl, 'reversed')).toBe(DEPTH_SETUPS.reversed);
		expect(reversed.calls).toEqual([`clip ${0x8ca1} ${0x935f}`, `depthFunc ${0x0204}`]);
		const standard = context(true);
		expect(setDepthMode(standard.gl, 'standard')).toBe(DEPTH_SETUPS.standard);
		expect(standard.calls).toEqual([`depthFunc ${0x0201}`]);
	});

	it('draw reversed depth in GL range on a context that answers no EXT_clip_control', () => {
		const lost = context(false);
		expect(setDepthMode(lost.gl, 'reversed')).toBe(DEPTH_SETUPS['reversed-gl']);
		expect(lost.calls).toEqual([`depthFunc ${0x0204}`]);
	});
});
