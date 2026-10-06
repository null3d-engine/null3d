// Checks of the environment generator page's result, shared by the Playwright test and the
// real-browser runner: the built-in room that the engine makes on the GPU, against the asset tool's
// map of the room. Both follow the same steps (D-19): the trace, the blur of 0.04 radians, the
// chain of halved levels and the GGX filter of each level. The tool works in 32-bit floats on the
// CPU, and the GPU keeps each step's texels as shared-exponent floats and filters with the GPU's
// own precision, so the two differ by small steps. The comparison tone maps each texel first, as
// the parity test does, so it counts a difference as much as a picture shows it. On WebGL2 the
// finished cube must also hold the very texels that went into it.
import { readEnvironment } from '../../packages/cli/src/assets/env.js';
import { environmentMap } from '../../packages/cli/src/assets/formats.js';
import { averageLight, fromRgb9e5 } from './environment-maps.ts';

export interface GeneratorResult {
	ok: boolean;
	error?: string;
	tier: string;
	errors: string[];
	prepareTime: number;
	times: number[];
	callTimes: number[];
	gpuTimes: number[];
	/**
	 * On WebGL2, the texels of each level of a finished map that differ from the texels on their way
	 * into the cube; null where the device draws into no float target, and on WebGPU.
	 */
	cubeWrong: number[] | null;
	size: number;
	levels: string[];
}

/** How far each level may lie from the tool's, in steps of 1/255 after tone mapping: mean / p99. */
const TOLERANCE = { mean: 0.25, p99: 1 };
/** How far each level's total light may lie from the tool's. */
const RATIO = 0.005;

/** Every texel of a level as shared-exponent words, from the page's bytes or the tool's file. */
const words = (bytes: Uint8Array) =>
	new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** The tool's map of the room, made once, on the first check. */
let room: { tool: Uint8Array; env: ReturnType<typeof readEnvironment> } | undefined;

/**
 * Compares the page's map with the tool's, level by level. Returns a line per level for the log,
 * and what is wrong, or nothing when the map matches.
 */
export function generatorReport(result: GeneratorResult): { lines: string[]; problems: string[] } {
	if (result.error) return { lines: [], problems: [result.error] };
	room ??= (() => {
		const tool = environmentMap({ builtin: 'room' }, { size: 256, format: 'rgb9e5ufloat' });
		return { tool, env: readEnvironment(tool) };
	})();
	const { tool, env } = room;
	// Reinhard's operator at an exposure that puts the room's average light at a third of white.
	const exposure = 0.5 / averageLight(env.sh);
	const tone = (x: number) => (255 * x * exposure) / (1 + x * exposure);
	const lines: string[] = [];
	const problems = result.errors.map((error) => `GPU error: ${error}`);
	if (result.levels.length !== env.levels.length)
		problems.push(`the page read ${result.levels.length} levels, not ${env.levels.length}`);
	result.levels.forEach((base64, level) => {
		const ours = words(Uint8Array.from(Buffer.from(base64, 'base64')));
		const { offset, length } = env.levels[level] as { offset: number; length: number };
		const theirs = words(tool.subarray(offset, offset + length));
		if (ours.length !== theirs.length) {
			problems.push(`level ${level}: ${ours.length} texels, not ${theirs.length}`);
			return;
		}
		const steps = new Float64Array(ours.length);
		let [sumOurs, sumTheirs] = [0, 0];
		for (let k = 0; k < ours.length; k++) {
			const a = fromRgb9e5(ours[k] as number)[0];
			const b = fromRgb9e5(theirs[k] as number)[0];
			steps[k] = Math.abs(tone(a) - tone(b));
			sumOurs += a;
			sumTheirs += b;
		}
		const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
		const p99 = steps.sort()[Math.floor(0.99 * (steps.length - 1))] as number;
		const ratio = sumOurs / sumTheirs;
		lines.push(`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}, ratio ${ratio.toFixed(4)}`);
		if (mean > TOLERANCE.mean || p99 > TOLERANCE.p99)
			problems.push(`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}`);
		if (Math.abs(ratio - 1) > RATIO)
			problems.push(`level ${level}: the total light differs by ${ratio.toFixed(4)}`);
	});
	result.cubeWrong?.forEach((wrong, level) => {
		if (wrong > 0) problems.push(`level ${level}: ${wrong} texels of the finished cube differ`);
	});
	if (result.tier === 'webgl2' && result.cubeWrong === null)
		lines.push('the device draws into no float target, so the finished cube went unchecked');
	return { lines, problems };
}
