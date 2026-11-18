import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playwrightNodeOptions, SOURCE_CONDITION } from './source-condition';

describe('the source condition for Playwright', () => {
	it('puts the condition first and keeps the options the caller set', () => {
		expect(playwrightNodeOptions(undefined)).toBe(`--conditions=${SOURCE_CONDITION}`);
		expect(playwrightNodeOptions('--max-old-space-size=8192')).toBe(
			`--conditions=${SOURCE_CONDITION} --max-old-space-size=8192`,
		);
	});

	it('is what the browser tests start Playwright with', () => {
		const manifest = JSON.parse(
			readFileSync(join(import.meta.dirname, '../../tests/package.json'), 'utf8'),
		) as { scripts: Record<string, string> };
		expect(manifest.scripts.test).toContain(`--conditions=${SOURCE_CONDITION}`);
	});
});
