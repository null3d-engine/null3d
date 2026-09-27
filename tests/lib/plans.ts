// Plans for the runner page, and how each page's result is judged. A plan item says which page to
// open with which switches, and what to check in the page's result.
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineResult,
	engineProblems,
} from './engine-checks.ts';
import { compareToReference } from './images.ts';
import type { ItemResult, PlanItem } from './runs.ts';

export type Tier = 'webgpu' | 'webgl2';

export type Check =
	| { kind: 'capabilities' }
	| { kind: 'isolation' }
	| { kind: 'clear'; tier: Tier }
	| { kind: 'engine'; tier: Tier; mode: EngineMode };

const TEST_PAGES = '/tests/pages/';
const TIERS: readonly Tier[] = ['webgpu', 'webgl2'];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The browser checks: the capability report, isolation, clear colors, and the engine in every mode on both GPU paths. */
export function checksPlan(): PlanItem<Check>[] {
	return [
		{
			id: 'capabilities',
			path: `${TEST_PAGES}capabilities.html`,
			timeoutSeconds: 30,
			check: { kind: 'capabilities' },
		},
		{
			id: 'isolation',
			path: `${TEST_PAGES}isolation.html`,
			timeoutSeconds: 30,
			check: { kind: 'isolation' },
		},
		...TIERS.map((tier) => ({
			id: `clear-${tier}`,
			path: `${TEST_PAGES}clear.html?gpu=${tier}`,
			timeoutSeconds: 30,
			check: { kind: 'clear' as const, tier },
		})),
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.map((mode) => ({
				id: `engine-${tier}-${slug(mode.name)}`,
				path: `${TEST_PAGES}engine.html?${[`gpu=${tier}`, 'seconds=2', mode.query].filter(Boolean).join('&')}`,
				timeoutSeconds: 45,
				check: { kind: 'engine' as const, tier, mode },
			})),
		),
	];
}

export const PLANS: Readonly<Record<string, () => PlanItem<Check>[]>> = { checks: checksPlan };

/** True when a page failed because the browser offers no WebGPU at all. */
function missingWebGPU(error: string | undefined): boolean {
	return error === 'no WebGPU adapter' || error?.startsWith('E1301') === true;
}

/**
 * What is wrong with a page's result; empty when nothing is. A missing WebGPU on a WebGPU check is a
 * skip when allowed, because some devices have no WebGPU in any browser.
 */
export function judge(check: Check, result: ItemResult, allowNoWebGPU: boolean): string[] | 'skip' {
	if (!result.ok) {
		if (allowNoWebGPU && 'tier' in check && check.tier === 'webgpu' && missingWebGPU(result.error))
			return 'skip';
		return [result.error ?? 'the page failed without a message'];
	}
	switch (check.kind) {
		case 'capabilities':
			return [];
		case 'isolation': {
			const problems: string[] = [];
			if (!result.crossOriginIsolated) problems.push('the page is not cross-origin isolated');
			if (!result.threaded) problems.push('the threaded build did not load');
			return problems;
		}
		case 'clear':
			try {
				compareToReference(
					'clear',
					check.tier,
					Buffer.from(String(result.pixels ?? ''), 'base64'),
					Number(result.width ?? 0),
					Number(result.height ?? 0),
				);
				return [];
			} catch (e) {
				return [(e as Error).message];
			}
		case 'engine':
			return engineProblems(result as unknown as EngineResult, check.mode, check.tier);
	}
}
