// The address a page gives its demo's sketch module, with the page's own switches on it. Vite reads
// a module's language from the text after the id's last dot, the query included, so an address that
// ends in a decimal value, such as `?render-scale=0.333`, is parsed as JavaScript and a sketch's
// type-only imports fail. Every address therefore ends with an inert parameter, which leaves the
// last token a name: a sketch reads its switches by name and ignores this one.

/** The inert parameter that ends every sketch address. */
export const ADDRESS_END = 'null3d-address';

/**
 * The demo's sketch address, with the page's switches in the order given, ended by the inert
 * parameter so no trailing decimal value can be read as the module's extension.
 */
export function sketchAddress(
	sketch: URL,
	switches: Iterable<readonly [string, string]> = [],
): URL {
	const address = new URL(sketch);
	for (const [key, value] of switches) address.searchParams.set(key, value);
	address.searchParams.set(ADDRESS_END, '');
	return address;
}
