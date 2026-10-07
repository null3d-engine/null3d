import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { JoinedBuilds } from './effect-join';

describe('JoinedBuilds', () => {
	const warn = spyOn(console, 'warn').mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it('sends a failed build back to separate passes, and warns', () => {
		const joins = new JoinedBuilds(new Map());
		const heard: number[] = [];
		joins.onFailed = (template) => heard.push(template);
		joins.failed(70, new Error('its link failed'));
		expect(heard).toEqual([70]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain('its link failed');
	});

	it('sends shaders that a device without background compiles keeps apart back, and says why once', () => {
		const joins = new JoinedBuilds(new Map());
		const heard: number[] = [];
		joins.onFailed = (template) => heard.push(template);
		joins.keptApart(71);
		joins.keptApart(72);
		expect(heard).toEqual([71, 72]);
		expect(warn).toHaveBeenCalledTimes(1);
		const message = String(warn.mock.calls[0]?.[0]);
		expect(message).toContain('before the first frame');
		expect(message).not.toContain('failed');
	});
});
