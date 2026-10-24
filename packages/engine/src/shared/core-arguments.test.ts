// The engine core's calls take whole numbers as arguments, never fractions, except the calls that
// make content. Wherever the browser does not inline a call into the core, it makes an object of
// each fraction that the call takes as an argument. A setter that a sketch calls in every frame
// would then allocate in every frame, so setters take their numbers through the core's call
// values instead, as `CoreMemory.callValues` says.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The source folder of the crate that exports the core's calls. */
const SOURCES = join(import.meta.dir, '../../../../crates/null3d-wasm/src');

/**
 * Calls that may take fractions: each makes content, which allocates anyway, so no sketch calls
 * one in every frame.
 */
const MAKERS = new Set([
	'createLineBatch',
	'createShapeMesh',
	'createMaterial',
	'addPass',
	'addFullscreenPass',
	'addComputePass',
	'createClip',
	'createClipLater',
	'setReflectionProbe',
	'setMaterialDisplacement',
]);

/** Each call that the core exports, by its JavaScript name, with its Rust parameters. */
function coreCalls(): { name: string; parameters: string }[] {
	const exported =
		/#\[wasm_bindgen(?:\(js_name = (\w+)\))?\]\s*(?:#\[[^\]]*\]\s*)*pub fn (\w+)\s*\(([^)]*)\)/g;
	const calls: { name: string; parameters: string }[] = [];
	for (const file of readdirSync(SOURCES).filter((name) => name.endsWith('.rs'))) {
		const source = readFileSync(join(SOURCES, file), 'utf8');
		for (const [, jsName, rustName, parameters] of source.matchAll(exported))
			calls.push({ name: jsName ?? (rustName as string), parameters: parameters as string });
	}
	return calls;
}

/** True when a call takes a 32-bit or 64-bit float as an argument. */
const takesFraction = (parameters: string) => /:\s*f(?:32|64)\b/.test(parameters);

describe("the engine core's calls", () => {
	const calls = coreCalls();

	test('are found in the crate', () => {
		expect(calls.length).toBeGreaterThan(100);
		expect(calls.map((call) => call.name)).toContain('setLightValue');
	});

	test('take no fraction as an argument, except the calls that make content', () => {
		const taking = calls.filter((call) => takesFraction(call.parameters)).map((call) => call.name);
		expect(taking.filter((name) => !MAKERS.has(name))).toEqual([]);
	});

	test('list as makers only calls that exist and take a fraction', () => {
		const taking = new Set(
			calls.filter((call) => takesFraction(call.parameters)).map((call) => call.name),
		);
		expect([...MAKERS].filter((name) => !taking.has(name))).toEqual([]);
	});
});
