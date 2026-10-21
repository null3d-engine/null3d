import { beforeEach, describe, expect, it } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { checkAddonVersion, VERSION } from './version';

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
