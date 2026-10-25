import { describe, expect, it } from 'bun:test';
import { exactTestPath } from './test-paths.ts';

describe('exactTestPath', () => {
	it('puts ./ in front of a relative path, so bun test takes it exactly rather than as a filter', () => {
		expect(exactTestPath('tools')).toBe('./tools');
		expect(exactTestPath('tests/lib/shader-set.test.ts')).toBe('./tests/lib/shader-set.test.ts');
	});

	it('keeps a path that bun test already takes exactly', () => {
		expect(exactTestPath('./tools')).toBe('./tools');
		expect(exactTestPath('/repo/tools')).toBe('/repo/tools');
	});
});
