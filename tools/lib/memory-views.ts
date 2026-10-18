// Finds engine code that makes or keeps views of the engine's shared memory outside the rules of
// hard rule 20. Chrome counts each old buffer of a shared memory as a full copy of the memory, so a
// view that outlives a growth inflates the page's memory figure. One module makes every view, and
// an object that keeps views across calls says so and drops them when the memory grows. The check
// reads the TypeScript types, so it finds the memory however code names it:
//
// - Only the accessor module reads a WebAssembly memory's `buffer`, so no other code can make a view
//   of it.
// - No code makes a view of the buffer of a view that the accessor made: such a view would escape
//   the accessor too.
// - Only a class that implements the view holder interface, and registers with its memory, stores
//   the accessor's views on itself.
import ts from 'typescript';

/** The module that makes every view of the engine's memory, from the engine's source folder. */
export const ACCESSOR_MODULE = 'shared/memory-views.ts';

/** The methods of the accessor and of the sketch's core that return views of the memory. */
const VIEW_METHODS = new Set(['view', 'heap', 'f32', 'f64', 'u32', 'i32']);
/** The classes whose view methods return views of the memory. */
const VIEW_CLASSES = new Set(['MemoryViews', 'CoreMemory']);
/** The interface of an object that keeps views and drops them when the memory grows. */
const HOLDER = 'ViewHolder';
/** The method of the holder interface that drops the views. */
const DROP = 'dropViews';
/** The call that registers a holder with its memory. */
const REGISTER = 'holdViews';
/** The operators that store a value on a property. */
const ASSIGNMENTS = new Set([
	ts.SyntaxKind.EqualsToken,
	ts.SyntaxKind.QuestionQuestionEqualsToken,
	ts.SyntaxKind.BarBarEqualsToken,
	ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** One place that breaks a rule: the file, its line, and what is wrong. */
export interface MemoryViewProblem {
	file: string;
	line: number;
	problem: string;
}

/** True when `type`, less null and undefined, is a WebAssembly memory. */
function isMemory(type: ts.Type, checker: ts.TypeChecker): boolean {
	const memory = checker.getNonNullableType(type);
	const symbol = memory.getSymbol() ?? memory.aliasSymbol;
	if (symbol?.getName() !== 'Memory') return false;
	return (symbol.getDeclarations() ?? []).some((declaration) => {
		const parent = declaration.parent;
		return ts.isModuleBlock(parent) && parent.parent.name.getText() === 'WebAssembly';
	});
}

/** True when `node` calls a method of the accessor or of the sketch's core that returns a view. */
function isViewCall(node: ts.Node, checker: ts.TypeChecker): node is ts.CallExpression {
	if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
	if (!VIEW_METHODS.has(node.expression.name.text)) return false;
	const method = checker.getSymbolAtLocation(node.expression.name);
	return (method?.getDeclarations() ?? []).some((declaration) => {
		const owner = declaration.parent;
		return ts.isClassDeclaration(owner) && VIEW_CLASSES.has(owner.name?.text ?? '');
	});
}

/** True when `node`, outside nested functions, holds a call that returns a view. */
function holdsViewCall(node: ts.Node, checker: ts.TypeChecker): boolean {
	if (isViewCall(node, checker)) return true;
	if (ts.isFunctionLike(node)) return false;
	return ts.forEachChild(node, (child) => holdsViewCall(child, checker) || undefined) ?? false;
}

/** True when `node` is a property of `this`, such as `this.rows`. */
function isOwnProperty(node: ts.Node): boolean {
	return (
		(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
		node.expression.kind === ts.SyntaxKind.ThisKeyword
	);
}

/** True when `node` is a class that implements the holder interface and registers itself. */
function isHolder(node: ts.ClassLikeDeclaration): boolean {
	const implementsHolder = (node.heritageClauses ?? []).some(
		(clause) =>
			clause.token === ts.SyntaxKind.ImplementsKeyword &&
			clause.types.some((type) => type.expression.getText() === HOLDER),
	);
	let registers = false;
	const find = (child: ts.Node): void => {
		if (
			ts.isCallExpression(child) &&
			ts.isPropertyAccessExpression(child.expression) &&
			child.expression.name.text === REGISTER &&
			child.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword
		)
			registers = true;
		else ts.forEachChild(child, find);
	};
	ts.forEachChild(node, find);
	return implementsHolder && registers;
}

/** True when the member's own doc comment holds the `@internal` tag. */
function isInternal(member: ts.Node): boolean {
	const file = member.getSourceFile();
	const ranges = ts.getLeadingCommentRanges(file.text, member.getFullStart()) ?? [];
	return ranges.some((range) => /@internal\b/.test(file.text.slice(range.pos, range.end)));
}

/**
 * The `dropViews` method of a class that marks it `@internal`, or undefined. The package build
 * strips such members, so the built declarations would keep the `implements` clause without the
 * method, and a consumer's type check would fail.
 */
function dropViewsMarkedInternal(node: ts.ClassLikeDeclaration): ts.MethodDeclaration | undefined {
	const drop = node.members.find(
		(member): member is ts.MethodDeclaration =>
			ts.isMethodDeclaration(member) && member.name.getText() === DROP,
	);
	return drop !== undefined && isInternal(drop) ? drop : undefined;
}

/** The problems of one source file. */
function problemsOf(file: ts.SourceFile, checker: ts.TypeChecker, accessor: boolean) {
	const problems: MemoryViewProblem[] = [];
	const add = (node: ts.Node, problem: string) =>
		problems.push({
			file: file.fileName,
			line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
			problem,
		});
	const holders: boolean[] = [];
	const visit = (node: ts.Node): void => {
		const isClass = ts.isClassLike(node);
		if (isClass) {
			const holder = isHolder(node);
			holders.push(holder);
			if (holder) {
				const drop = dropViewsMarkedInternal(node);
				if (drop !== undefined)
					add(
						drop,
						`${HOLDER} needs a public ${DROP}: remove its @internal tag, or the built declarations break a consumer's type check`,
					);
			}
		}
		if (!accessor) {
			const named =
				(ts.isPropertyAccessExpression(node) && node.name.text === 'buffer') ||
				(ts.isElementAccessExpression(node) &&
					ts.isStringLiteralLike(node.argumentExpression) &&
					node.argumentExpression.text === 'buffer');
			if (named && isMemory(checker.getTypeAtLocation(node.expression), checker))
				add(node, `reads a WebAssembly memory's buffer outside ${ACCESSOR_MODULE}`);
			if (
				ts.isBindingElement(node) &&
				ts.isObjectBindingPattern(node.parent) &&
				(node.propertyName ?? node.name).getText() === 'buffer' &&
				isMemory(checker.getTypeAtLocation(node.parent), checker)
			)
				add(node, `takes a WebAssembly memory's buffer outside ${ACCESSOR_MODULE}`);
			if (
				ts.isPropertyAccessExpression(node) &&
				node.name.text === 'buffer' &&
				isViewCall(node.expression, checker)
			)
				add(node, "reads the buffer of the accessor's view, which makes views around it");
			const stored =
				(ts.isBinaryExpression(node) &&
					ASSIGNMENTS.has(node.operatorToken.kind) &&
					isOwnProperty(node.left) &&
					holdsViewCall(node.right, checker)) ||
				(ts.isPropertyDeclaration(node) &&
					node.initializer !== undefined &&
					holdsViewCall(node.initializer, checker));
			if (stored && !holders.at(-1))
				add(
					node,
					`keeps a view of the memory in a class that does not implement ${HOLDER} and call ${REGISTER}(this)`,
				);
		}
		ts.forEachChild(node, visit);
		if (isClass) holders.pop();
	};
	visit(file);
	return problems;
}

/**
 * The places in `program`'s files under `sourceRoot` that break the rules, test files left out. The
 * accessor module at `sourceRoot`'s `ACCESSOR_MODULE` may read the memory's buffer.
 */
export function memoryViewProblems(program: ts.Program, sourceRoot: string): MemoryViewProblem[] {
	const checker = program.getTypeChecker();
	const root = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
	return program
		.getSourceFiles()
		.filter((file) => file.fileName.startsWith(root) && !/\.test\.ts$/.test(file.fileName))
		.flatMap((file) => problemsOf(file, checker, file.fileName === `${root}${ACCESSOR_MODULE}`));
}
