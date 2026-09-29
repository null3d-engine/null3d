import { describe, expect, it } from 'bun:test';
import { type ApiSymbol, readApi, renderSymbol } from './api-docs';
import { fixture } from './fixture';

const PARTS = `
/**
 * A base.
 *
 * @category api/objects
 */
export class Base {
	/** Inherited. */
	inherited(): void {}
}

/**
 * A child.
 *
 * @category api/objects
 */
export class Child extends Base {
	/** @internal */
	hiddenInternal = 1;
	private hiddenPrivate = 2;

	constructor(
		/** The name. */
		readonly name: string,
		private readonly secret: number,
	) {
		super();
	}

	/** Moves it. */
	move(x: number, order: 'a' | 'b' = 'a'): void {}

	/** The size. */
	get size(): number {
		return this.secret + this.hiddenPrivate;
	}
}

export function undocumented(): void {}

export interface Hidden {
	x: number;
}

/**
 * Options.
 *
 * @category api/objects
 */
export interface Options {
	/** Documented. */
	a: { b: number; c: [number, number] };
	d: string;
	/** Names a type the index does not export. */
	hidden: Hidden;
}

const TABLE = { alpha: 1, beta: 2 } as const;

/**
 * A code.
 *
 * @category api/objects
 */
export type Code = keyof typeof TABLE;

/**
 * A long union.
 *
 * @category api/objects
 */
export type Long = 'aaaaaaaaaaaaaaaaaaaa' | 'bbbbbbbbbbbbbbbbbbbb' | 'cccccccccccccccccccc' | 'dddddddddddddddddddd' | 'eeeeeeeeeeeeeeeeeeee';
`;

const HELPERS = `
import type { Pair } from './pair';

/** Makes a pair. */
export function make(): [number, number] {
	return [0, 0];
}

/** Adds two pairs into \`out\`. */
export function add<T extends Pair>(out: T, a: Pair, b: Pair): T {
	return out;
}

export function undocumentedHelper(): void {}

export const NOT_A_FUNCTION = 1;
`;

const INDEX = `export { Base, Child, undocumented } from './parts';
export type { Code, Long, Options } from './parts';
export type { Pair } from './pair';

/**
 * Pair helpers.
 *
 * @category api/math
 */
export * as pair from './helpers';
export * as bare from './helpers';
`;

const root = fixture({
	'packages/engine/tsconfig.json': JSON.stringify({
		compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', lib: ['ES2022'] },
	}),
	'packages/engine/src/index.ts': INDEX,
	'packages/engine/src/parts.ts': PARTS,
	'packages/engine/src/helpers.ts': HELPERS,
	'packages/engine/src/pair.ts':
		'/**\n * Two numbers.\n *\n * @category api/math\n */\nexport type Pair = { [index: number]: number };\n',
});
const api = readApi(root);
const named = (name: string) => api.symbols.find((s) => s.name === name) as ApiSymbol;

describe('readApi', () => {
	it('reads a summary, a page and the public members a class declares itself', () => {
		const child = named('Child');
		expect(child).toMatchObject({ kind: 'class', page: 'api/objects', summary: 'A child.' });
		expect(child.extends).toEqual(['Base']);
		expect(child.members.map((m) => m.signature).sort()).toEqual([
			"move(x: number, order: 'a' | 'b' = 'a'): void",
			'readonly name: string',
			'readonly size: number',
		]);
		expect(named('Base').members.map((m) => m.name)).toEqual(['inherited']);
	});

	it('prints member types as the source declares them, on one line', () => {
		expect(named('Options').members[0]?.signature).toBe('a: { b: number; c: [number, number]; }');
	});

	it('reports what keeps an export out of the reference', () => {
		const where = '(packages/engine/src/parts.ts)';
		const helpers = '(packages/engine/src/helpers.ts)';
		expect(api.problems.sort()).toEqual([
			`Options ${where} names Hidden, which the engine does not export`,
			`Options ${where}: member d has no TSDoc summary`,
			`bare ${helpers} has no @category api/<page> tag`,
			`bare ${helpers} has no TSDoc summary`,
			`bare ${helpers}: member NOT_A_FUNCTION is not a function, which a namespace must hold`,
			`bare ${helpers}: member undocumentedHelper has no TSDoc summary`,
			`pair ${helpers}: member NOT_A_FUNCTION is not a function, which a namespace must hold`,
			`pair ${helpers}: member undocumentedHelper has no TSDoc summary`,
			`undocumented ${where} has no @category api/<page> tag`,
			`undocumented ${where} has no TSDoc summary`,
		]);
	});

	it('reads a namespace export: its comment from the export statement, and its functions', () => {
		const pair = named('pair');
		expect(pair).toMatchObject({
			kind: 'namespace',
			page: 'api/math',
			summary: 'Pair helpers.',
			signature: '',
		});
		expect(pair.members.map((m) => [m.signature, m.summary])).toEqual([
			['make(): [number, number]', 'Makes a pair.'],
			['add<T extends Pair>(out: T, a: Pair, b: Pair): T', 'Adds two pairs into `out`.'],
			['undocumentedHelper(): void', ''],
		]);
	});

	it('shows an alias of private parts as the type it resolves to', () => {
		expect(named('Code').signature).toBe("type Code = 'alpha' | 'beta';");
	});

	it('prints a long union one member per line', () => {
		expect(named('Long').signature.split('\n')).toEqual([
			'type Long =',
			"\t| 'aaaaaaaaaaaaaaaaaaaa'",
			"\t| 'bbbbbbbbbbbbbbbbbbbb'",
			"\t| 'cccccccccccccccccccc'",
			"\t| 'dddddddddddddddddddd'",
			"\t| 'eeeeeeeeeeeeeeeeeeee';",
		]);
	});
});

describe('renderSymbol', () => {
	it('renders a class with its base and a table of members, with pipes escaped', () => {
		const text = renderSymbol(named('Child'));
		expect(text).toStartWith('### `Child`\n\nClass `Child`, which extends `Base`.\n\nA child.');
		expect(text).toContain("| `move(x: number, order: 'a' \\| 'b' = 'a'): void` | Moves it. |");
	});

	it('renders a namespace with a table of its functions', () => {
		const text = renderSymbol(named('pair'));
		expect(text).toStartWith('### `pair`\n\nNamespace `pair`.\n\nPair helpers.');
		expect(text).toContain('| `add<T extends Pair>(out: T, a: Pair, b: Pair): T` | Adds two pairs');
	});

	it('renders a type with its declaration', () => {
		expect(renderSymbol(named('Code'))).toBe(
			"### `Code`\n\n```ts\ntype Code = 'alpha' | 'beta';\n```\n\nA code.",
		);
	});
});
