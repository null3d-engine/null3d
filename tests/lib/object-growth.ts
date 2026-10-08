// The object growth plan: the object growth page's timing mode on each GPU path. Each load times the
// create calls that grow the scene's object tables, from the default start of room for 1,023
// objects up to 65,535, and measures the engine memory of a scene of one object with the default
// start and with room for 16,383 objects. D-103 records the results.
import { failureText, type ItemResult, type PlanItem } from './runs.ts';

/** One load of the object growth page's timing mode on one GPU path. */
export interface ObjectGrowthCheck {
	kind: 'object-growth';
	tier: 'webgpu' | 'webgl2';
}

/** A create call that grew the tables: the objects it made the scene hold, and its time. */
export interface Growth {
	objects: number;
	ms: number;
}

/** What the object growth page reports in its timing mode. */
export interface ObjectGrowthResult {
	/** The engine's WebAssembly bytes after the first frame, by start: `default` and `16383`. */
	memory: Record<string, number | null>;
	/** The create calls that grew the tables, and each frame's median create call, in ms. */
	timing?: { growths: Growth[]; medianMs: number[] };
	failures: string[];
}

/** Loads of the page on each GPU path, unless the plan names another number. */
export const OBJECT_GROWTH_RUNS = 3;
/** How long a load may take on a slow device: three engine starts and 50,000 create calls. */
const TIMEOUT_SECONDS = 120;
/** The memory keys of the default start and of room for 16,383 objects from the start. */
const SMALL_START = 'default';
const LARGE_START = '16383';
/** The objects whose create grows the default start's tables first: one past its room. */
export const FIRST_GROWTH = 1_024;

const TIERS = ['webgpu', 'webgl2'] as const;

/** The loads of the page, the GPU paths in turns, so the runs on each path share the device's warmth. */
export function objectGrowthPlan({
	runs = OBJECT_GROWTH_RUNS,
} = {}): PlanItem<ObjectGrowthCheck>[] {
	return Array.from({ length: runs }, (_, k) =>
		TIERS.map((tier) => ({
			id: `object-growth-${tier}-${k + 1}`,
			path: `/tests/pages/object-growth.html?gpu=${tier}&timing`,
			timeoutSeconds: TIMEOUT_SECONDS,
			check: { kind: 'object-growth' as const, tier },
		})),
	).flat();
}

/**
 * What is wrong with a load: a failure, no growth timed, growths that do not double the room from
 * the default start, a time that is not a number, or a default start that takes no less memory than
 * room for 16,383 objects.
 */
export function objectGrowthProblems(result: ObjectGrowthResult): string[] {
	const problems = result.failures.map((failure) => `the engine failed: ${failure}`);
	const growths = result.timing?.growths ?? [];
	if (growths.length === 0) problems.push('the page timed no growth');
	else if (growths.some(({ objects }, k) => objects !== FIRST_GROWTH * 2 ** k))
		problems.push(
			`the tables grew at ${growths.map(({ objects }) => objects).join(', ')} objects, not at ${FIRST_GROWTH} and each doubling after it`,
		);
	if (growths.some(({ ms }) => !(ms >= 0))) problems.push('a growth has no time');
	const small = result.memory[SMALL_START];
	const large = result.memory[LARGE_START];
	if (!(Number(small) > 0 && Number(large) > 0))
		problems.push('the page measured no engine memory');
	else if (Number(small) >= Number(large))
		problems.push('the default start took no less memory than room for 16,383 objects');
	return problems;
}

/** Room before and after the growth that a create call of this many objects made. */
const growthName = (objects: number) =>
	`${(objects - 1).toLocaleString('en-US')} to ${(2 * objects - 1).toLocaleString('en-US')}`;

/** The lowest to the highest of some figures, or a dash for none. */
function range(values: readonly number[], digits: number): string {
	if (values.length === 0) return '-';
	const low = Math.min(...values).toFixed(digits);
	const high = Math.max(...values).toFixed(digits);
	return low === high ? low : `${low} to ${high}`;
}

const MB = 1e6;

/**
 * The object growth report of one runner's results, in D-103's form: for each growth and GPU path,
 * the lowest to the highest create time of the loads, then the engine memory of each start. Loads
 * that failed their check stay out. Undefined when the plan has no such loads. The page's median
 * create of each frame stays out: browsers round the clock to 5 µs or more, so it reads 0.
 */
export function objectGrowthSummary(
	items: readonly PlanItem<{ kind: string }>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const passed = new Map<string, ObjectGrowthResult[]>();
	const loads = new Map<string, number>();
	const failures: string[] = [];
	for (const { id, check } of items) {
		if (check.kind !== 'object-growth') continue;
		const { tier } = check as ObjectGrowthCheck;
		loads.set(tier, (loads.get(tier) ?? 0) + 1);
		const result = resultOf(id);
		const timed = result?.ok ? (result as ItemResult & ObjectGrowthResult) : undefined;
		const problems = timed
			? objectGrowthProblems(timed)
			: [result ? failureText(result) : 'no result'];
		if (problems.length > 0) {
			failures.push(`${id}: ${problems.join('; ')}`);
			continue;
		}
		passed.set(tier, [...(passed.get(tier) ?? []), timed as ObjectGrowthResult]);
	}
	if (loads.size === 0) return undefined;
	const tiers = [...loads.keys()];
	const of = (tier: string) => passed.get(tier) ?? [];
	const steps = [
		...new Set(
			tiers.flatMap((tier) =>
				of(tier).flatMap(({ timing }) => (timing?.growths ?? []).map(({ objects }) => objects)),
			),
		),
	].sort((a, b) => a - b);
	const row = (name: string, cell: (results: ObjectGrowthResult[], tier: string) => string) =>
		`| ${[name, ...tiers.map((tier) => cell(of(tier), tier))].join(' | ')} |`;
	const memory = (key: string) => (results: ObjectGrowthResult[]) =>
		range(
			results.map((result) => Number(result.memory[key]) / MB),
			1,
		);
	return [
		"Each create call that grew the scene's object tables, in ms: the lowest to the highest of the loads that passed. Memory: the engine's WebAssembly memory after a scene of one object's first frame, in MB.",
		'',
		`| Growth | ${tiers.join(' | ')} |`,
		`| --- | ${tiers.map(() => '---').join(' | ')} |`,
		...steps.map((objects) =>
			row(growthName(objects), (results) =>
				range(
					results.flatMap(({ timing }) =>
						(timing?.growths ?? []).filter((each) => each.objects === objects).map(({ ms }) => ms),
					),
					2,
				),
			),
		),
		row('Memory, default start', memory(SMALL_START)),
		row('Memory, room for 16,383', memory(LARGE_START)),
		row('Loads that passed', (results, tier) => `${results.length} of ${loads.get(tier)}`),
		...(failures.length > 0
			? ['', 'Loads that failed their check and stay out:', ...failures]
			: []),
	].join('\n');
}
