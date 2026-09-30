// The API reference, read from the engine's public exports and their TSDoc comments with the
// TypeScript compiler, and rendered into the docs page that each export names with its
// `@category api/<page>` tag. The reference therefore always matches the code: `bun run docs`
// rewrites it, and the docs check fails when a committed page differs.
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

/** The engine's public entry point, relative to the repository root. */
export const API_ENTRY = 'packages/engine/src/index.ts';
/** The engine's source folder, relative to the repository root. */
export const API_SOURCE = 'packages/engine/src';
const API_TSCONFIG = 'packages/engine/tsconfig.json';

/** One member of a class or interface in the reference. */
export interface ApiMember {
	name: string;
	/** The member as the source declares it, such as `setPosition(x: number): void`. */
	signature: string;
	summary: string;
}

/** One public export in the reference. */
export interface ApiSymbol {
	name: string;
	kind: 'function' | 'class' | 'interface' | 'namespace' | 'type' | 'const';
	/** The docs page the export belongs on, from its `@category` tag. */
	page: string;
	/** The declaration for functions, types and constants; empty for the kinds that have members. */
	signature: string;
	summary: string;
	/** The classes or interfaces it extends, whose members it also has. */
	extends: string[];
	/** Its own public members, for classes and interfaces, and its functions, for a namespace. */
	members: ApiMember[];
}

const FORMAT =
	ts.TypeFormatFlags.NoTruncation |
	ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
	ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
/** Declarations longer than this print one union member per line. */
const LINE_LENGTH = 100;
const printer = ts.createPrinter({ removeComments: true });

/** Text with its lines joined, so it fits a table cell. */
const flat = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

/** Marks the tuple and object types under a node to print on one line, as the source has them. */
function singleLine(node: ts.Node): void {
	if (ts.isTupleTypeNode(node) || ts.isTypeLiteralNode(node))
		ts.setEmitFlags(node, ts.EmitFlags.SingleLine);
	ts.forEachChild(node, singleLine);
}

/** A node as the source declares it, without comments, on one line. */
function line(node: ts.Node): string {
	singleLine(node);
	return flat(printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()));
}

function tag(symbol: ts.Symbol, checker: ts.TypeChecker, name: string): string | undefined {
	const found = symbol.getJsDocTags(checker).find((t) => t.name === name);
	return found ? ts.displayPartsToString(found.text).trim() : undefined;
}

function isInternal(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	return symbol.getJsDocTags(checker).some((t) => t.name === 'internal');
}

/**
 * The class or interface that declares a member. A constructor's parameter properties belong to its
 * class.
 */
function ownerOf(declaration: ts.Declaration): ts.Node {
	return ts.isParameter(declaration) ? declaration.parent.parent : declaration.parent;
}

function isHidden(declaration: ts.Declaration): boolean {
	const flags = ts.getCombinedModifierFlags(declaration);
	if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return true;
	const name = ts.getNameOfDeclaration(declaration);
	return name !== undefined && ts.isPrivateIdentifier(name);
}

type Callable = ts.FunctionDeclaration | ts.MethodDeclaration | ts.MethodSignature;

/** The declarations a caller sees: the overloads when there are some, else the one declaration. */
function callables(declarations: readonly ts.Declaration[]): Callable[] {
	const all = declarations.filter(
		(d): d is Callable =>
			ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isMethodSignature(d),
	);
	const overloads = all.filter((d) => !('body' in d && d.body));
	return overloads.length > 0 && overloads.length < all.length ? overloads : all;
}

/**
 * A function or method as the source declares it: its type parameters, its parameters and its
 * result. The type nodes it prints go into `used`, for the check of the types they name.
 */
function callableOf(
	declaration: Callable,
	name: string,
	checker: ts.TypeChecker,
	used: ts.Node[],
): string {
	const typeParameters = declaration.typeParameters ?? [];
	used.push(...typeParameters, ...declaration.parameters);
	const generic = typeParameters.length > 0 ? `<${typeParameters.map(line).join(', ')}>` : '';
	let result = 'void';
	if (declaration.type) {
		used.push(declaration.type);
		result = line(declaration.type);
	} else {
		const signature = checker.getSignatureFromDeclaration(declaration);
		if (signature)
			result = checker.typeToString(
				checker.getReturnTypeOfSignature(signature),
				declaration,
				FORMAT,
			);
	}
	return `${name}${generic}(${declaration.parameters.map(line).join(', ')}): ${result}`;
}

/** A property as the source declares it: whether it is read-only or optional, and its type. */
function propertyOf(
	member: ts.Symbol,
	declaration: ts.Declaration,
	checker: ts.TypeChecker,
	used: ts.Node[],
): string {
	const getterOnly =
		ts.isGetAccessorDeclaration(declaration) &&
		!member.declarations?.some((d) => ts.isSetAccessorDeclaration(d));
	const readonly =
		getterOnly || ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly
			? 'readonly '
			: '';
	const optional = member.flags & ts.SymbolFlags.Optional ? '?' : '';
	const typeNode = (declaration as { type?: ts.TypeNode }).type;
	if (typeNode) used.push(typeNode);
	const type = typeNode
		? line(typeNode)
		: checker.typeToString(
				checker.getTypeOfSymbolAtLocation(member, declaration),
				declaration,
				FORMAT,
			);
	return `${readonly}${member.name}${optional}: ${type}`;
}

/**
 * The public members that a class or interface declares itself, with their signatures and
 * summaries. Members it inherits belong to the type that declares them.
 */
function membersOf(
	type: ts.Type,
	checker: ts.TypeChecker,
	at: ts.ClassDeclaration | ts.InterfaceDeclaration,
	used: ts.Node[],
): ApiMember[] {
	const members: ApiMember[] = [];
	for (const member of type.getProperties()) {
		const declarations = member.declarations ?? [];
		const declaration = declarations[0];
		if (!declaration || ownerOf(declaration) !== at) continue;
		if (isHidden(declaration) || isInternal(member, checker)) continue;
		// Symbol-keyed members are markers for the engine's own checks, not API.
		if (member.name.startsWith('__@')) continue;
		const summary = flat(ts.displayPartsToString(member.getDocumentationComment(checker)));
		const methods = callables(declarations);
		if (methods.length === 0)
			members.push({
				name: member.name,
				signature: propertyOf(member, declaration, checker, used),
				summary,
			});
		for (const method of methods)
			members.push({
				name: member.name,
				signature: callableOf(method, member.name, checker, used),
				summary,
			});
	}
	return members;
}

/**
 * The engine's own types that the nodes name but the entry point does not export. A reader of the
 * reference could not look them up.
 */
function unexportedTypes(
	nodes: readonly ts.Node[],
	checker: ts.TypeChecker,
	source: string,
	exported: ReadonlySet<ts.Symbol>,
): string[] {
	const found = new Set<string>();
	const visit = (node: ts.Node): void => {
		const name = ts.isTypeReferenceNode(node)
			? node.typeName
			: ts.isExpressionWithTypeArguments(node)
				? node.expression
				: ts.isTypeQueryNode(node)
					? node.exprName
					: undefined;
		let symbol = name && checker.getSymbolAtLocation(name);
		if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
		const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
		// A type parameter is declared with the signature that names it, which shows it.
		const shown = symbol && symbol.flags & ts.SymbolFlags.TypeParameter;
		if (symbol && !shown && file?.startsWith(source) && !exported.has(symbol))
			found.add(symbol.name);
		ts.forEachChild(node, visit);
	};
	for (const node of nodes) visit(node);
	return [...found].sort();
}

/**
 * A type alias as the source declares it or, when its declaration names private parts of the
 * engine, as the type it resolves to. A long union prints one member per line.
 */
function aliasOf(
	declaration: ts.TypeAliasDeclaration,
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	expand: boolean,
): string {
	const type = checker.getDeclaredTypeOfSymbol(symbol);
	const parts = !expand
		? ts.isUnionTypeNode(declaration.type)
			? declaration.type.types.map(line)
			: [line(declaration.type)]
		: type.isUnion()
			? type.types.map((t) => checker.typeToString(t, undefined, FORMAT))
			: [checker.typeToString(type, undefined, FORMAT | ts.TypeFormatFlags.InTypeAlias)];
	const parameters = declaration.typeParameters
		? `<${declaration.typeParameters.map(line).join(', ')}>`
		: '';
	const head = `type ${symbol.name}${parameters} =`;
	const oneLine = `${head} ${parts.join(' | ')};`;
	return oneLine.length <= LINE_LENGTH || parts.length === 1
		? oneLine
		: `${head}\n${parts.map((part) => `\t| ${part}`).join('\n')};`;
}

/**
 * The summary and the `@category` page of a namespace export, such as `export * as vec3 from ...`,
 * from the comment on its export statement. The compiler gives the namespace itself no comment.
 */
function namespaceDocs(alias: ts.Symbol): { summary: string; page: string | undefined } {
	const statement = alias.declarations?.[0]?.parent;
	const doc = statement
		? ts.getJSDocCommentsAndTags(statement).filter(ts.isJSDoc).at(-1)
		: undefined;
	const category = doc?.tags?.find((t) => t.tagName.text === 'category');
	return {
		summary: flat(ts.getTextOfJSDocComment(doc?.comment) ?? ''),
		page: category ? ts.getTextOfJSDocComment(category.comment)?.trim() : undefined,
	};
}

/**
 * The functions of a namespace export, in the order its module declares them, and the names of its
 * exports that are not functions, which the reference cannot show.
 */
function namespaceMembers(
	module: ts.Symbol,
	checker: ts.TypeChecker,
	used: ts.Node[],
): { members: ApiMember[]; others: string[] } {
	const members: ApiMember[] = [];
	const others: string[] = [];
	for (const exported of checker.getExportsOfModule(module)) {
		const member =
			exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
		const functions = callables(member.declarations ?? []);
		if (functions.length === 0) others.push(exported.name);
		const summary = flat(ts.displayPartsToString(member.getDocumentationComment(checker)));
		for (const declaration of functions)
			members.push({
				name: exported.name,
				signature: callableOf(declaration, exported.name, checker, used),
				summary,
			});
	}
	return { members, others };
}

/** The engine's public exports, and the problems that keep some of them out of the reference. */
export interface ApiReference {
	symbols: ApiSymbol[];
	problems: string[];
}

/**
 * Reads every public export of the engine. The problems are an export with no summary or no
 * `@category` tag, a member with no summary, and a public declaration that names a type the
 * engine does not export.
 */
export function readApi(root: string): ApiReference {
	const tsconfig = join(root, API_TSCONFIG);
	const config = ts.readConfigFile(tsconfig, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfig));
	const entry = join(root, API_ENTRY);
	const program = ts.createProgram({ rootNames: [entry], options: parsed.options });
	const checker = program.getTypeChecker();
	const module = checker.getSymbolAtLocation(program.getSourceFile(entry) as ts.SourceFile);
	if (!module) throw new Error(`${API_ENTRY} is not a module the compiler can read`);
	const source = join(root, API_SOURCE);

	const exports = checker.getExportsOfModule(module).map((exported) => ({
		name: exported.name,
		alias: exported,
		symbol: exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported,
	}));
	const exported = new Set(exports.map((e) => e.symbol));
	const symbols: ApiSymbol[] = [];
	const problems: string[] = [];
	for (const { name, alias, symbol } of exports) {
		const declaration = symbol.declarations?.[0];
		if (!declaration) continue;
		const where = `${name} (${relative(root, declaration.getSourceFile().fileName)})`;
		const isNamespace = ts.isSourceFile(declaration);
		const { summary, page } = isNamespace
			? namespaceDocs(alias)
			: {
					summary: flat(ts.displayPartsToString(symbol.getDocumentationComment(checker))),
					page: tag(symbol, checker, 'category'),
				};
		if (!summary) problems.push(`${where} has no TSDoc summary`);
		if (!page?.startsWith('api/')) problems.push(`${where} has no @category api/<page> tag`);

		const used: ts.Node[] = [];
		let kind: ApiSymbol['kind'];
		let signature = '';
		let bases: string[] = [];
		let members: ApiMember[] = [];
		if (isNamespace) {
			kind = 'namespace';
			const functions = namespaceMembers(symbol, checker, used);
			members = functions.members;
			for (const other of functions.others)
				problems.push(`${where}: member ${other} is not a function, which a namespace must hold`);
		} else if (ts.isFunctionDeclaration(declaration)) {
			kind = 'function';
			signature = callables(symbol.declarations ?? [])
				.map((d) => `function ${callableOf(d, name, checker, used)}`)
				.join('\n');
		} else if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
			kind = ts.isClassDeclaration(declaration) ? 'class' : 'interface';
			const extended = (declaration.heritageClauses ?? [])
				.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
				.flatMap((clause) => clause.types);
			used.push(...extended);
			bases = extended.map((t) => t.expression.getText());
			members = membersOf(checker.getDeclaredTypeOfSymbol(symbol), checker, declaration, used);
		} else if (ts.isTypeAliasDeclaration(declaration)) {
			kind = 'type';
			const expand = unexportedTypes([declaration.type], checker, source, exported).length > 0;
			signature = aliasOf(declaration, symbol, checker, expand);
		} else {
			kind = 'const';
			const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
			signature = `const ${name}: ${checker.typeToString(type, declaration, FORMAT)}`;
		}
		for (const member of members)
			if (!member.summary) problems.push(`${where}: member ${member.name} has no TSDoc summary`);
		for (const hidden of unexportedTypes(used, checker, source, exported))
			problems.push(`${where} names ${hidden}, which the engine does not export`);
		symbols.push({ name, kind, page: page ?? '', signature, summary, extends: bases, members });
	}
	symbols.sort((a, b) => a.name.localeCompare(b.name));
	return { symbols, problems };
}

/** Text for a Markdown table cell, with its pipes escaped. */
export const tableCell = (text: string | undefined) => (text ?? '').replace(/\|/g, '\\|');

/** The word that names each kind of export that the reference shows by its members. */
const MEMBER_KINDS: Partial<Record<ApiSymbol['kind'], string>> = {
	class: 'Class',
	interface: 'Interface',
	namespace: 'Namespace',
};

/** One export as Markdown: its declaration or members, and its summary. */
export function renderSymbol(symbol: ApiSymbol): string {
	const lines = [`### \`${symbol.name}\``, ''];
	if (symbol.signature) lines.push('```ts', symbol.signature, '```', '');
	else {
		const base = symbol.extends.map((name) => `\`${name}\``).join(', ');
		const what = MEMBER_KINDS[symbol.kind];
		lines.push(`${what} \`${symbol.name}\`${base ? `, which extends ${base}` : ''}.`, '');
	}
	if (symbol.summary) lines.push(symbol.summary, '');
	if (symbol.members.length > 0) {
		lines.push('| Member | Description |', '| --- | --- |');
		for (const member of symbol.members)
			lines.push(`| \`${tableCell(member.signature)}\` | ${tableCell(member.summary)} |`);
		lines.push('');
	}
	return lines.join('\n').trimEnd();
}

/** A page's reference: its exports in name order. */
export function renderReference(symbols: readonly ApiSymbol[]): string {
	return symbols.map(renderSymbol).join('\n\n');
}
