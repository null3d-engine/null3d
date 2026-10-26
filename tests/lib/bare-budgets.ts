// Finds a time budget that a test file states without `scaledBudget`. Bun lets a check, a setup or
// teardown hook, or a whole file state a budget of its own, and that budget wins over the run's.
// The run's budget grows with the machine's load (`tests/lib/run-budget.ts`), so a budget that does
// not grow with it stays put while the run's grows, and on a loaded machine it can be the smaller
// of the two. So a stated budget is a call of `scaledBudget` or a constant of the same file that
// holds one. Anything else fails: a number, a constant that holds a number, or arithmetic on one.
import ts from 'typescript';

/** Bun's test calls that take a budget, by the budget's place among their arguments. */
const BUDGET_ARGUMENT: Readonly<Record<string, number>> = {
	it: 2,
	test: 2,
	setDefaultTimeout: 0,
	beforeAll: 1,
	beforeEach: 1,
	afterAll: 1,
	afterEach: 1,
	onTestFinished: 1,
};

/** The helper that grows a stated budget with the run's load. */
const SCALED = 'scaledBudget';

/**
 * The name at the root of a callee: `it` for `it.skip` or `it.if(ok)`, `test` for `test.each(x)`.
 */
function rootName(callee: ts.Expression): string | undefined {
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return rootName(callee.expression);
	if (ts.isCallExpression(callee)) return rootName(callee.expression);
	return undefined;
}

/** True for a call of the helper that grows a budget. */
const isScaledCall = (node: ts.Expression): boolean =>
	ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === SCALED;

/** The constants of a file whose value is a scaled budget. */
function scaledConstants(source: ts.SourceFile): Set<string> {
	const names = new Set<string>();
	const visit = (node: ts.Node) => {
		if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const)
			for (const { name, initializer } of node.declarations)
				if (ts.isIdentifier(name) && initializer && isScaledCall(initializer)) names.add(name.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return names;
}

/** True for a budget that grows with the run's load: a scaled call, or a constant that holds one. */
function scales(budget: ts.Expression, scaled: ReadonlySet<string>): boolean {
	if (isScaledCall(budget)) return true;
	if (ts.isIdentifier(budget)) return scaled.has(budget.text);
	if (!ts.isObjectLiteralExpression(budget)) return false;
	// An options object: its timeout, when it names one, must scale, and a spread or a computed
	// name could hide one.
	return budget.properties.every((property) => {
		if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) return false;
		const key = property.name;
		const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
		if (name !== 'timeout') return true;
		if (ts.isPropertyAssignment(property)) return scales(property.initializer, scaled);
		if (ts.isShorthandPropertyAssignment(property)) return scaled.has(property.name.text);
		return false;
	});
}

/**
 * The local names that a file gives to Bun's calls that take a budget, with the call each one names:
 * `it` for `import { it }` and for `import { it as check }`. A file's own function that is called
 * `test` is not one of them.
 */
function budgetCalls(source: ts.SourceFile): Map<string, string> {
	const calls = new Map<string, string>();
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const from = statement.moduleSpecifier;
		const bindings = statement.importClause?.namedBindings;
		if (!ts.isStringLiteral(from) || from.text !== 'bun:test' || !bindings) continue;
		if (!ts.isNamedImports(bindings)) continue;
		for (const { name, propertyName } of bindings.elements) {
			const imported = (propertyName ?? name).text;
			if (imported in BUDGET_ARGUMENT) calls.set(name.text, imported);
		}
	}
	return calls;
}

/** The lines, counted from 1, at which a test file states a budget that does not grow with load. */
export function bareBudgetLines(file: string, text: string): number[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
	const calls = budgetCalls(source);
	const scaled = scaledConstants(source);
	const lines: number[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node)) {
			const local = rootName(node.expression);
			const call = local === undefined ? undefined : calls.get(local);
			const budget = call === undefined ? undefined : node.arguments[BUDGET_ARGUMENT[call] ?? -1];
			if (budget && !scales(budget, scaled))
				lines.push(source.getLineAndCharacterOfPosition(budget.getStart(source)).line + 1);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return lines;
}
