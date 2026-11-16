// The sketch of the record-writer test: one particle buffer, and a check that the block writer
// gives the same records as writing them one at a time, that it wraps around the buffer, and that
// a shift moves the birth times that the time base leaves behind.
import { defineSketch, type ParticleBuffer } from '@null3d/engine';

/** The buffer's records, enough to wrap a batch. */
const CAPACITY = 8;

export default defineSketch((ctx) => {
	const { scene, page } = ctx;
	scene.setBackground('#10141a');
	const camera = scene.createPerspectiveCamera({ fov: 40, position: [0, 0, 6] });
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	let made: Promise<ParticleBuffer> | null = null;

	const check = async () => {
		if (!made) made = scene.createParticleBuffer({ capacity: CAPACITY });
		const buffer = await made;
		const out = new Float32Array(9);
		const same = (a: number, b: number) => Object.is(a, b) || Math.abs(a - b) <= 1e-6;
		const records = (index: number) => {
			buffer.read(index, out);
			return [...out];
		};
		// One record through the single-record path, and the same one through the block.
		buffer.write(0, [1, 2, 3, 4.5, -1, 0.5, 0, 1.75], 0x1234);
		const block = new Float32Array(9);
		block.set([1, 2, 3, 4.5, -1, 0.5, 0, 1.75, 0x1234]);
		buffer.writeRecords(block, 1, 1);
		const single = records(0);
		const throughBlock = records(1);
		// A birth time that a shift moves back.
		buffer.write(2, [0, 0, 0, 1000.5, 0, 0, 0, 1], 3);
		buffer.shiftRecords(2, 3, 1000);
		const shifted = records(2)[3] as number;
		// A batch that starts near the end and wraps to the start.
		const batch = new Float32Array(9 * 4);
		for (let i = 0; i < 4; i++) {
			const at = i * 9;
			batch[at + 3] = 10 + i;
			batch[at + 7] = 1;
			batch[at + 8] = i;
		}
		buffer.writeRecords(batch, 4, 6);
		buffer.commit();
		const wrapped = [records(6), records(7), records(0), records(1)];
		page.post('checked', {
			single,
			throughBlock,
			equal: single.every((value, k) => same(value, throughBlock[k] as number)),
			wrapped: wrapped.map((record) => record[3] as number),
			wrappedSeeds: wrapped.map((record) => record[8] as number),
			shifted,
		});
	};

	page.onMessage((type) => {
		if (type === 'check') void check();
	});

	return {};
});
