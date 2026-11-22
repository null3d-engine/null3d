// A sketch's address carries the page's switches and ends with an inert parameter, so a decimal
// value at its end is never read as the module's extension by the dev server.
import { expect, test } from 'bun:test';
import { ADDRESS_END, sketchAddress } from './sketch-url';

test('the address keeps each switch and ends with the inert parameter', () => {
	const address = sketchAddress(new URL('https://example.test/sketch.ts'), [
		['mood', 'Morning'],
		['render-scale', '0.333'],
	]);
	expect(address.searchParams.get('mood')).toBe('Morning');
	expect(address.searchParams.get('render-scale')).toBe('0.333');
	// The address's last token is a name, never the decimal that Vite would read as an extension.
	expect(address.toString().endsWith(`&${ADDRESS_END}=`)).toBe(true);
});

test('an address with no switches still ends with the inert parameter', () => {
	const address = sketchAddress(new URL('https://example.test/sketch.ts'));
	expect(address.search).toBe(`?${ADDRESS_END}=`);
});
