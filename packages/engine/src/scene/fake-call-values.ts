// For unit tests: a stand-in core's setters that take their numbers through the call values, as
// the engine core's setters do, read back into arguments. Each wrapped setter receives its whole
// number arguments, then the call values that the core reads for it, so a test records each call
// as the numbers it gave.

import { CALL_VALUE_COUNT } from '../generated/core';
import { MemoryViews } from '../shared/memory-views';

/** The call values that each setter reads, after its whole-number arguments. */
const READS: Readonly<Record<string, number>> = {
	setLineWidth: 1,
	setBatchOrigin: 3,
	setMaterialValue: 3,
	setMaterialValues: 4,
	setPerspectiveCamera: 3,
	setOrthographicCamera: 6,
	setLightColor: 3,
	setLightValue: 1,
	setLightDefault: 1,
	setBackground: 3,
	setPixelRatio: 1,
	setLevelQuality: 2,
	setShadowQuality: 1,
	setFog: 10,
	setFogVolume: 4,
	setReflectionScale: 1,
};

/** Where the call values sit by default: the last bytes of the first page of a test's memory. */
const ADDRESS = 65_536 - CALL_VALUE_COUNT * 8;

/** The call values that setter `name` reads from `address`, or none for a setter that reads none. */
export function callValueArguments(
	name: string,
	memory: WebAssembly.Memory,
	address = ADDRESS,
): number[] {
	// Every view of the engine's memory is made by the accessor module (hard rule 20).
	return [...new MemoryViews(memory).f64(address, READS[name] ?? 0)];
}

/**
 * Gives `glue` itself `callValues` at `address`, and wraps each of its setters that read call
 * values, so a setter receives the numbers it reads as arguments after its own. A test that
 * replaces one of the stand-in's calls later still reaches the stand-in.
 */
export function withCallValues<T extends object>(
	glue: T,
	memory: WebAssembly.Memory,
	address = ADDRESS,
): T {
	const calls = glue as Record<string, unknown>;
	calls.callValues = () => address;
	for (const name of Object.keys(READS)) {
		const setter = calls[name];
		if (typeof setter !== 'function') continue;
		calls[name] = (...args: unknown[]) =>
			setter(...args, ...callValueArguments(name, memory, address));
	}
	return glue;
}
