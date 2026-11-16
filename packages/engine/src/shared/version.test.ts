import { beforeEach, describe, expect, it } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	checkAddonVersion,
	checkPluginInterface,
	PLUGIN_INTERFACE_VERSION,
	VERSION,
} from './version';

// The fix text is part of the message only when the thread holds the table, as a page that raised
// its first error does.
beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('checkAddonVersion', () => {
	it('accepts an add-on of this engine version', () => {
		expect(() => checkAddonVersion('@null3d/demo', VERSION)).not.toThrow();
	});

	it('throws E1432, which names the add-on and both versions, and gives the fix', () => {
		let error: unknown;
		try {
			checkAddonVersion('@null3d/controls', '0.1.0');
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(EngineError);
		const { code, message } = error as EngineError;
		expect(code).toBe('E1432');
		expect(message).toStartWith(
			`E1432: @null3d/controls 0.1.0 was built for null3D 0.1.0, and this page runs null3D ${VERSION}. `,
		);
		expect(message).toContain(ERROR_FIXES.E1432);
		expect(message).toContain('/docs/errors/E1432.md');
	});
});

/** The error that an add-on's declaration throws, or undefined when it throws none. */
function thrownBy(
	range: { min: number; max: number },
	name = '@acme/splats',
): EngineError | undefined {
	try {
		checkPluginInterface(name, range);
	} catch (error) {
		return error as EngineError;
	}
	return undefined;
}

describe('checkPluginInterface', () => {
	it('starts the plugin interface at a whole version', () => {
		expect(Number.isInteger(PLUGIN_INTERFACE_VERSION)).toBe(true);
		expect(PLUGIN_INTERFACE_VERSION).toBeGreaterThanOrEqual(1);
	});

	it('accepts a test add-on built for the interface alone', () => {
		expect(
			thrownBy({ min: PLUGIN_INTERFACE_VERSION, max: PLUGIN_INTERFACE_VERSION }),
		).toBeUndefined();
	});

	it('accepts a test add-on whose range holds the interface', () => {
		const first = Math.max(1, PLUGIN_INTERFACE_VERSION - 2);
		expect(thrownBy({ min: first, max: PLUGIN_INTERFACE_VERSION })).toBeUndefined();
		expect(
			thrownBy({ min: PLUGIN_INTERFACE_VERSION, max: PLUGIN_INTERFACE_VERSION + 2 }),
		).toBeUndefined();
	});

	it('refuses a test add-on built for an interface above this engine, and names both', () => {
		const error = thrownBy({
			min: PLUGIN_INTERFACE_VERSION + 1,
			max: PLUGIN_INTERFACE_VERSION + 3,
		});
		expect(error).toBeInstanceOf(EngineError);
		const { code, message } = error as EngineError;
		expect(code).toBe('E1433');
		expect(message).toStartWith(
			`E1433: @acme/splats was built for plugin interface ${PLUGIN_INTERFACE_VERSION + 1} to ${PLUGIN_INTERFACE_VERSION + 3}, and this page has plugin interface ${PLUGIN_INTERFACE_VERSION} (null3D ${VERSION}). `,
		);
		expect(message).toContain(ERROR_FIXES.E1433);
		expect(message).toContain('/docs/errors/E1433.md');
	});

	it('names a range of one version once', () => {
		const error = thrownBy({
			min: PLUGIN_INTERFACE_VERSION + 1,
			max: PLUGIN_INTERFACE_VERSION + 1,
		});
		expect(error?.message).toStartWith(
			`E1433: @acme/splats was built for plugin interface ${PLUGIN_INTERFACE_VERSION + 1}, and this page has plugin interface ${PLUGIN_INTERFACE_VERSION} (null3D ${VERSION}). `,
		);
	});

	it('refuses a declaration that is no range of whole versions', () => {
		for (const range of [
			{ min: 2, max: 1 },
			{ min: 0, max: 2 },
			{ min: 1.5, max: 2 },
			{ min: Number.NaN, max: 2 },
		]) {
			const error = thrownBy(range);
			expect(error).toBeInstanceOf(EngineError);
			expect(error?.code).toBe('E1433');
			expect(error?.message).toStartWith('E1433: @acme/splats declares plugin interface versions');
		}
	});
});
