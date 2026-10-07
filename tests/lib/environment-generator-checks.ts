// Checks of the environment generator page's result, shared by the Playwright test and the
// real-browser runner: an environment map that the engine makes on the GPU, against the asset
// tool's map of the same source. The source is the built-in room, or the panorama of an HDR file
// that `assets.loadEnvironment` reads. Both follow the same steps (D-19). The room starts with a
// trace and a blur of 0.04 radians, and a panorama with its light mapped onto the cube; then come
// the chain of halved levels and the GGX filter of each level. The tool works in 32-bit floats on
// the CPU, and the GPU keeps each step's texels as shared-exponent floats and filters with the
// GPU's own precision, so the two differ by small steps. The comparison tone maps each channel of
// each texel first, as the parity test does, so it counts a difference as much as a picture shows
// it. For a file, the readers' diffuse light must match the tool's too. On WebGL2 the finished cube
// must also hold the very texels that went into it.
import { readFileSync } from 'node:fs';
import { readEnvironment } from '../../packages/cli/src/assets/env.js';
import { environmentMap } from '../../packages/cli/src/assets/formats.js';
import { fromRgb9e5, reinhardSteps, words } from './environment-maps.ts';

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
	/** For a file: the readers' nine diffuse coefficients, their time, and the panorama's gain. */
	sh: number[];
	readTime: number;
	gain: number;
}

/** How far each level may lie from the tool's, in steps of 1/255 after tone mapping: mean / p99. */
const TOLERANCE = { mean: 0.25, p99: 1 };
/** How far each level's total light may lie from the tool's. */
const RATIO = 0.005;
/** How far the readers' diffuse light may lie from the tool's: a share of the first coefficient. */
const SH_TOLERANCE = 0.01;

/** The tool's map of each source, by the file's path or the room's name, made on first use. */
const toolMaps = new Map<string, { tool: Uint8Array; env: ReturnType<typeof readEnvironment> }>();

function toolMap(file?: string) {
	const key = file ?? 'room';
	let map = toolMaps.get(key);
	if (!map) {
		const from = file ? { file: readFileSync(file) } : { builtin: 'room' as const };
		const tool = environmentMap(from, { size: 256, format: 'rgb9e5ufloat' });
		map = { tool, env: readEnvironment(tool) };
		toolMaps.set(key, map);
	}
	return map;
}

/**
 * Compares the page's map with the tool's map of the HDR file at the path `file`, or of the room
 * without one, level by level. Returns a line per level for the log, and what is wrong, or nothing
 * when the map matches.
 */
export function generatorReport(
	result: GeneratorResult,
	file?: string,
): { lines: string[]; problems: string[] } {
	if (result.error) return { lines: [], problems: [result.error] };
	const { tool, env } = toolMap(file);
	const tone = reinhardSteps(env.sh);
	const lines: string[] = [];
	const problems = result.errors.map((error) => `GPU error: ${error}`);
	if (result.levels.length !== env.levels.length)
		problems.push(`the page read ${result.levels.length} levels, not ${env.levels.length}`);
	result.levels.forEach((base64, level) => {
		const ours = words(base64);
		const { offset, length } = env.levels[level] as { offset: number; length: number };
		const theirs = new Uint32Array(tool.slice(offset, offset + length).buffer);
		if (ours.length !== theirs.length) {
			problems.push(`level ${level}: ${ours.length} texels, not ${theirs.length}`);
			return;
		}
		const steps = new Float64Array(3 * ours.length);
		let [sumOurs, sumTheirs] = [0, 0];
		for (let k = 0; k < ours.length; k++) {
			const a = fromRgb9e5(ours[k] as number);
			const b = fromRgb9e5(theirs[k] as number);
			for (let c = 0; c < 3; c++) {
				steps[3 * k + c] = Math.abs(tone(a[c] as number) - tone(b[c] as number));
				sumOurs += a[c] as number;
				sumTheirs += b[c] as number;
			}
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
	if (file) {
		const scale = Math.abs(env.sh[0] as number);
		const most = Math.max(...result.sh.map((c, k) => Math.abs(c - (env.sh[k] as number))));
		lines.push(
			`diffuse light: largest difference ${(most / scale).toFixed(4)} of the first coefficient; gain ${result.gain}; readers ${result.readTime.toFixed(0)} ms`,
		);
		if (most > SH_TOLERANCE * scale)
			problems.push(`the diffuse light differs by ${(most / scale).toFixed(4)}`);
	}
	result.cubeWrong?.forEach((wrong, level) => {
		if (wrong > 0) problems.push(`level ${level}: ${wrong} texels of the finished cube differ`);
	});
	if (result.tier === 'webgl2' && result.cubeWrong === null)
		lines.push('the device draws into no float target, so the finished cube went unchecked');
	return { lines, problems };
}
