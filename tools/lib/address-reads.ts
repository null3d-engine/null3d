// Finds engine code that reads a memory address from a signed 32-bit array without converting it to
// an unsigned number first (hard rule 31, .dev/implementation-notes.md "Addresses above 2 GiB"). An
// address at 2 GiB or above, read from an `Int32Array` such as the shared control slots, comes back
// negative. A view or a word index made from it then points outside the memory, so the frame fails.
// The page may raise the memory's maximum to 4096 MiB (D-04), so the check refuses every such read.
//
// The check is deliberately narrow. It looks only at:
//   - `Atomics.load(array, index)` calls, and
//   - element reads `array[index]`,
// where the array is a signed 32-bit typed array and the index names a slot constant whose name
// ends in `Address`, with an optional frame parity. An ordinary integer read of another slot is
// left alone. The read must be converted with `>>> 0` at the read site; a value assigned first and
// converted later is refused, so every address has one obvious place to look.
import ts from 'typescript';

/** One place that reads an address without `>>> 0`: the file, its line, and what is wrong. */
export interface AddressReadProblem {
	file: string;
	line: number;
	problem: string;
}

/** The typed arrays whose element reads are signed 32-bit numbers. */
const SIGNED_ARRAYS = new Set(['Int32Array']);
/** A slot constant that holds an address: a name ending in `Address`, with an optional parity. */
const ADDRESS_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*Address\d*/;
/** The name of the `Atomics` method that reads one value from a shared array. */
const ATOMICS_LOAD = 'load';

/** True when `node`'s type, less null and undefined, is a signed 32-bit typed array. */
function isSignedArray(node: ts.Expression, checker: ts.TypeChecker): boolean {
	const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
	const symbol = type.getSymbol() ?? type.aliasSymbol;
	return symbol !== undefined && SIGNED_ARRAYS.has(symbol.getName());
}

/** True when the index expression names an address slot, such as `Slot.DrawListAddress0 + parity`. */
function namesAddress(node: ts.Expression): boolean {
	return ADDRESS_TOKEN.test(node.getText());
}

/** True when `node` is the `Atomics.load(array, index)` call of an address slot. */
function isAddressLoad(node: ts.Node, checker: ts.TypeChecker): boolean {
	if (
		!ts.isCallExpression(node) ||
		!ts.isPropertyAccessExpression(node.expression) ||
		node.expression.expression.getText() !== 'Atomics' ||
		node.expression.name.text !== ATOMICS_LOAD
	)
		return false;
	const array = node.arguments[0];
	const index = node.arguments[1];
	return (
		array !== undefined &&
		index !== undefined &&
		isSignedArray(array, checker) &&
		namesAddress(index)
	);
}

/** True when `node` is an element read `array[index]` of an address slot. */
function isAddressIndex(node: ts.Node, checker: ts.TypeChecker): boolean {
	if (!ts.isElementAccessExpression(node)) return false;
	const index = node.argumentExpression;
	return isSignedArray(node.expression, checker) && namesAddress(index);
}

/** True when the read is converted with `>>> 0` at the read site. */
function isConverted(node: ts.Node): boolean {
	const parent = node.parent;
	return (
		ts.isBinaryExpression(parent) &&
		parent.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken &&
		parent.left === node &&
		ts.isNumericLiteral(parent.right) &&
		parent.right.text === '0'
	);
}

/** The address reads of one source file that lack `>>> 0`. */
function fileProblems(file: ts.SourceFile, checker: ts.TypeChecker): AddressReadProblem[] {
	const problems: AddressReadProblem[] = [];
	const visit = (node: ts.Node): void => {
		if ((isAddressLoad(node, checker) || isAddressIndex(node, checker)) && !isConverted(node)) {
			problems.push({
				file: file.fileName,
				line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
				problem:
					'reads an address from a signed Int32Array without converting it with >>> 0 (hard rule 31)',
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return problems;
}

/**
 * The places in `program`'s files under `sourceRoot` that read an address without `>>> 0`, test
 * files left out.
 */
export function addressReadProblems(program: ts.Program, sourceRoot: string): AddressReadProblem[] {
	const checker = program.getTypeChecker();
	const root = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
	return program
		.getSourceFiles()
		.filter((file) => file.fileName.startsWith(root) && !/\.test\.ts$/.test(file.fileName))
		.flatMap((file) => fileProblems(file, checker));
}
