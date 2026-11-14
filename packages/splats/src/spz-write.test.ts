// The SPZ writer: a cloud that the reader gives back, within the format's quantization, and the
// gzip stream that the readers of the format expect. The test writes a cloud, reads it back, and
// compares the two, which keeps the writer's steps and the reader's in step.
import { describe, expect, it } from 'bun:test';
import type { SplatData } from './format';
import { decodeSpz } from './spz';
import { encodeSpz } from './spz-write';

/** A cloud whose values exercise the fixed-point centers, the log spreads and the smallest three. */
function cloud(): SplatData {
	const count = 4;
	const positions = new Float32Array([
		-1.5, 2.25, -0.125, 0.5, -3, 4, 100.5, -200.25, 0.0625, 0, 0, 0,
	]);
	const scales = new Float32Array([0.05, 0.1, 0.2, 1, 2, 3, 0.01, 0.02, 0.03, 5, 5, 5]);
	const rotations = new Float32Array([
		0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, -0.7071, 0, 0.7071, 0, 0.1, 0.2, 0.3, 0.927,
	]);
	const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0.2, 0.4, 0.6, 0.25, 1, 1, 1, 0.75]);
	return { count, positions, scales, rotations, colors };
}

describe('encodeSpz', () => {
	it('writes a cloud that the reader gives back within its quantization', async () => {
		const before = cloud();
		const back = await decodeSpz(await encodeSpz(before));
		expect(back.count).toBe(before.count);
		for (let i = 0; i < before.count * 3; i++)
			expect(back.positions[i] as number).toBeCloseTo(before.positions[i] as number, 2);
		for (let i = 0; i < before.count * 3; i++)
			expect((back.scales[i] as number) / (before.scales[i] as number)).toBeCloseTo(1, 1);
		for (let i = 0; i < before.count; i++) {
			expect(back.colors[i * 4 + 3] as number).toBeCloseTo(before.colors[i * 4 + 3] as number, 1);
			for (let k = 0; k < 3; k++)
				expect(back.colors[i * 4 + k] as number).toBeCloseTo(before.colors[i * 4 + k] as number, 1);
		}
		// A rotation comes back as the same unit quaternion, up to its sign.
		for (let i = 0; i < before.count; i++) {
			let dot = 0;
			for (let k = 0; k < 4; k++)
				dot += (back.rotations[i * 4 + k] as number) * (before.rotations[i * 4 + k] as number);
			expect(Math.abs(dot)).toBeCloseTo(1, 2);
		}
	});

	it('keeps a distant cloud inside the fixed-point range', async () => {
		const far: SplatData = {
			count: 1,
			positions: new Float32Array([12_000_000, -8_000_000, 0]),
			scales: new Float32Array([1, 1, 1]),
			rotations: new Float32Array([0, 0, 0, 1]),
			colors: new Float32Array([1, 1, 1, 1]),
		};
		await expect(encodeSpz(far)).rejects.toThrow('too far to write');
	});

	it('refuses a cloud whose arrays do not fit its count', async () => {
		const broken = { ...cloud(), count: 5 };
		await expect(encodeSpz(broken)).rejects.toThrow('does not give every one of its splats');
	});
});
