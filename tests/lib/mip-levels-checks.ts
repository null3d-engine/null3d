// Checks of the mip levels page's result, shared by the Playwright test and the real-browser runner:
// the engine's way of making mip levels on WebGL2 must write every level of the layer it makes, and
// the other ways the page tries are facts about the device's driver, which a note records.

/** One level of a made layer, as the page read it back. */
export interface MipLevelRead {
	level: number;
	status: string;
	left: number[];
	right: number[];
	wrong: number;
}

/** What one way of making the levels wrote, in one format. */
export interface MipLevelsWay {
	way: string;
	format: string;
	layers: number;
	layer: number;
	levels: MipLevelRead[];
	errors: string[];
	ok: boolean;
	error?: string;
}

export interface MipLevelsResult {
	renderer?: string | null;
	ways: MipLevelsWay[];
	working: string[];
	failing: string[];
}

/** The name of the engine's own way on the page. */
export const ENGINE_WAY = 'engine';

/** What went wrong in one way's levels, in a line. */
function wayFault({ way, format, layers, layer, levels, errors, error }: MipLevelsWay): string {
	const wrong = levels.filter((level) => level.wrong > 0);
	const parts = [
		...(error ? [error] : []),
		...errors.map((code) => `GL error ${code}`),
		...wrong.map(
			({ level, wrong: count, left, right }) =>
				`level ${level}: ${count} wrong texels, ${left.join(',')} | ${right.join(',')}`,
		),
	];
	return `${way} (${format}, layer ${layer} of ${layers}): ${parts.join('; ')}`;
}

/** The engine's ways that wrote a wrong level, or none when every level is right. */
export function mipLevelsProblems(result: MipLevelsResult): string[] {
	const engine = result.ways.filter(({ way }) => way === ENGINE_WAY);
	if (engine.length === 0) return ['the page made no levels the engine way'];
	return engine.filter(({ ok }) => !ok).map(wayFault);
}

/** Which ways of making mip levels work on the device, for the run's notes. */
export function mipLevelsNote(result: MipLevelsResult): string {
	const failing = result.failing.length > 0 ? result.failing.join(', ') : 'none';
	return `mip levels on WebGL2: working ${result.working.join(', ') || 'none'}; failing ${failing}`;
}
