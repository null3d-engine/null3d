// Checks of the skinning pass page's result, shared by the Playwright test and the real-browser
// runner. The page runs the WebGPU skinning pass's shader on fixed meshes in several layouts, reads
// back what it wrote and what a draw then reads from it, and reports each case. The engine's own
// layouts must come out right. The other cases each change one thing, so that a device that fails
// shows which input its driver gets wrong; a note records them.

/** A vertex that came out wrong: its part, its number in the part, and what came out and why. */
export interface SkinPassWrong {
	part: number;
	vertex: number;
	got: number[];
	expected: number[];
}

/** One case: the layout it skins, and what came out wrong in the pass and in the draw. */
export interface SkinPassCase {
	name: string;
	/** True for the layouts that the engine makes, which the device must skin right. */
	engine: boolean;
	ok: boolean;
	/** Vertices that the pass wrote wrong, and the first of them. */
	wrong: number;
	first: SkinPassWrong[];
	/** Vertices that a draw from the skinned vertex buffer read wrong, and the first of them. */
	drawnWrong: number;
	drawnFirst: SkinPassWrong[];
}

export interface SkinPassResult {
	tier?: string;
	/** True when the joint texture read back as it was written. */
	jointsRead?: boolean;
	cases: SkinPassCase[];
	errors: string[];
}

/** What went wrong in one case, in a line. */
function caseFault({ name, wrong, first, drawnWrong, drawnFirst }: SkinPassCase): string {
	const show = (list: SkinPassWrong[]) =>
		list
			.slice(0, 2)
			.map(
				({ part, vertex, got, expected }) =>
					`part ${part} vertex ${vertex}: ${got.join(',')} for ${expected.join(',')}`,
			)
			.join('; ');
	const parts = [
		...(wrong > 0 ? [`the pass wrote ${wrong} vertices wrong (${show(first)})`] : []),
		...(drawnWrong > 0 ? [`a draw read ${drawnWrong} vertices wrong (${show(drawnFirst)})`] : []),
	];
	return `${name}: ${parts.join('; ')}`;
}

/** What the engine's layouts skinned wrong, or nothing when they all came out right. */
export function skinPassProblems(result: SkinPassResult): string[] {
	const engine = result.cases.filter((c) => c.engine);
	if (engine.length === 0) return ['the page reported no case of the engine'];
	return [
		...result.errors.map((error) => `WebGPU error: ${error}`),
		...(result.jointsRead === false ? ['the joint texture did not read back as written'] : []),
		...engine.filter(({ ok }) => !ok).map(caseFault),
	];
}

/** Which cases the device skins right, for the run's notes. */
export function skinPassNote(result: SkinPassResult): string {
	const right = result.cases.filter(({ ok }) => ok).map(({ name }) => name);
	const wrong = result.cases.filter(({ ok }) => !ok).map(caseFault);
	return [
		`skinning pass right: ${right.join(', ') || 'none'}`,
		...(wrong.length > 0 ? [`wrong: ${wrong.join(' | ')}`] : []),
	].join('; ');
}
