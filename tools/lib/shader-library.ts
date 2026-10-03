// The shader library's reference page, from the doc comments of its WGSL modules. Each module in
// the library folder starts with a plain comment that describes it, and gives every function,
// struct and constant a `///` doc comment, which the page shows under the item's declaration.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readIfExists } from './files';
import { renderFrontMatter } from './frontmatter';
import { slugifyHeading } from './links';

/** The folder of library modules. */
export const LIBRARY_DIR = 'crates/null3d-shaders/wgsl/lib';
/** The page that lists the modules. */
export const LIBRARY_PAGE_ID = 'shaders/library';

/**
 * The modules that shaders import, in the order the page shows them. The library's other modules
 * hold what the engine's own shaders share, such as their bindings and output settings. Shaders
 * other than the engine's cannot rely on them, so the page leaves them out.
 */
export const PUBLIC_MODULES = [
	'math',
	'noise',
	'color',
	'lighting',
	'fog',
	'vertex',
	'depth',
	'sdf',
] as const;

export interface LibraryItem {
	kind: 'fn' | 'struct' | 'const';
	name: string;
	/** The declaration as the page shows it: a function without its body, a whole struct or constant. */
	declaration: string;
	/** The doc comment, joined into one paragraph. */
	doc: string;
	/** A struct's fields with their doc comments. */
	fields: { name: string; doc: string }[];
}

export interface LibraryModule {
	/** The import path, such as `null3d::math`. */
	name: string;
	/** The plain comment at the top of the file, joined into one paragraph. */
	summary: string;
	items: LibraryItem[];
}

const DIRECTIVE = /^(?:enable|requires|diagnostic)\b|^#define_import_path\b|^#import\b/;
const DECLARATION = /^(fn|struct|const)\s+([A-Za-z_]\w*)/;

/** The text of consecutive comment lines that start with `marker`, as one paragraph. */
function commentText(lines: readonly string[], marker: '///' | '//'): string {
	return lines
		.map((line) => line.trim().slice(marker.length).trim())
		.join(' ')
		.trim();
}

/** Where the declaration that starts at `start` ends: its closing line. */
function declarationEnd(
	lines: readonly string[],
	start: number,
	kind: LibraryItem['kind'],
): number {
	let end = start;
	if (kind === 'fn') while (end < lines.length && !lines[end]!.trimEnd().endsWith('{')) end++;
	else if (kind === 'struct') while (end < lines.length && lines[end]!.trim() !== '}') end++;
	else while (end < lines.length && !lines[end]!.trimEnd().endsWith(';')) end++;
	return end;
}

/** A function's signature on one line, without its body. */
function signature(lines: readonly string[]): string {
	return lines
		.map((line) => line.trim())
		.join(' ')
		.replace(/\s*\{$/, '')
		.replace(/\(\s+/g, '(')
		.replace(/,\s*\)/g, ')')
		.replace(/\s+/g, ' ');
}

/** Parses one module. `problems` gets each item that lacks a doc comment. */
export function parseModule(
	name: string,
	path: string,
	text: string,
	problems: string[],
): LibraryModule {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	let summary = '';
	const items: LibraryItem[] = [];
	let docs: string[] = [];
	let comments: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith('///')) {
			docs.push(line);
			continue;
		}
		if (line.startsWith('//')) {
			comments.push(line);
			continue;
		}
		if (line.trim() === '' || DIRECTIVE.test(line)) {
			if (!summary && comments.length > 0 && items.length === 0)
				summary = commentText(comments, '//');
			comments = [];
			docs = [];
			continue;
		}
		const match = line.match(DECLARATION);
		if (!match) {
			docs = [];
			comments = [];
			continue;
		}
		const kind = match[1] as LibraryItem['kind'];
		const itemName = match[2]!;
		if (!summary && comments.length > 0 && items.length === 0)
			summary = commentText(comments, '//');
		const end = declarationEnd(lines, i, kind);
		const body = lines.slice(i, end + 1);
		if (docs.length === 0)
			problems.push(`${path}:${i + 1}: ${kind} ${itemName} has no /// doc comment`);
		const fields: LibraryItem['fields'] = [];
		let declaration: string;
		if (kind === 'fn') declaration = signature(body);
		else if (kind === 'struct') {
			let fieldDocs: string[] = [];
			const kept: string[] = [];
			for (const bodyLine of body) {
				const trimmed = bodyLine.trim();
				if (trimmed.startsWith('///')) {
					fieldDocs.push(trimmed);
					continue;
				}
				kept.push(bodyLine);
				const field = trimmed.match(/^([A-Za-z_]\w*)\s*:/);
				if (field && kept.length > 1) {
					if (fieldDocs.length === 0)
						problems.push(`${path}:${i + 1}: field ${itemName}.${field[1]} has no /// doc comment`);
					fields.push({ name: field[1]!, doc: commentText(fieldDocs, '///') });
					fieldDocs = [];
				}
			}
			declaration = kept.join('\n');
		} else declaration = body.join('\n');
		items.push({ kind, name: itemName, declaration, doc: commentText(docs, '///'), fields });
		docs = [];
		comments = [];
		i = end;
	}
	if (!summary) problems.push(`${path}: the module has no comment that describes it`);
	return { name: `null3d::${name}`, summary, items };
}

/** Reads the public modules in page order, and the problems that keep the page from being right. */
export function readLibrary(root: string): { modules: LibraryModule[]; problems: string[] } {
	if (!existsSync(join(root, LIBRARY_DIR)))
		return { modules: [], problems: [`${LIBRARY_DIR} is missing`] };
	const problems: string[] = [];
	const modules = PUBLIC_MODULES.flatMap((name) => {
		const path = `${LIBRARY_DIR}/${name}.wgsl`;
		const text = readIfExists(root, path);
		if (text === null) {
			problems.push(`${path} is missing`);
			return [];
		}
		return [parseModule(name, path, text, problems)];
	});
	return { modules, problems };
}

/** The first sentence of a paragraph. */
function firstSentence(text: string): string {
	return text.match(/^.*?\.(?=\s|$)/)?.[0] ?? text;
}

const INTRO = `The shader library is a set of WGSL modules that ship with the engine. A shader imports a module with an \`#import\` line, and the build adds the functions that the shader calls. The build then translates the shader for WebGL2, so each function works on both GPU paths. The engine's own shaders use the same modules.

\`\`\`wgsl
#import null3d::noise
#import null3d::color::{srgb_to_linear}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let n = null3d::noise::fbm2(uv * 8.0, 4u) * 0.5 + 0.5;
    return vec4f(srgb_to_linear(vec3f(n, 0.4, 0.2)), 1.0);
}
\`\`\`

The modules use only the WGSL features that every browser supports, as [WGSL rules for portable shaders](wgsl-rules.md) lists them. Values are 32-bit floats, and colors are linear unless a function says otherwise.

## Imports

A shader imports a module in one of two ways:

- \`#import null3d::noise\` imports the whole module. Call its items by their full path, such as \`null3d::noise::simplex3(p)\`.
- \`#import null3d::color::{srgb_to_linear, luminance}\` imports the items in the braces. Call them by their names alone, such as \`luminance(c)\`.

The build adds only the functions that the shader calls, and the functions that those call. An import therefore costs nothing when the shader does not use it.

Imported names follow two rules:

- After \`#import null3d::color\`, the build reads the name \`color\` as the module. The shader cannot also give that name to a variable, a parameter or a struct field. This holds for each module that a shader imports whole, such as \`depth\`, \`fog\` and \`vertex\`. Import the items by name instead, or choose another name.
- After \`#import null3d::color::{luminance}\`, the name \`luminance\` belongs to the imported function. Nothing else in the shader can use it.

## Modules

| Module | What it holds |
| --- | --- |`;

const RELATED = `## Related pages

- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the Vite plugin compiles it.
- [Surface functions](surface-functions.md): custom materials, which call these modules.
- [WGSL rules for portable shaders](wgsl-rules.md): what the build rejects, and what it cannot check.
`;

/** The reference page of the library. `summary` is the page's summary in the docs inventory. */
export function libraryPage(
	modules: readonly LibraryModule[],
	title: string,
	summary: string,
): string {
	const rows = modules.map(
		(m) => `| [\`${m.name}\`](#${slugifyHeading(`\`${m.name}\``)}) | ${firstSentence(m.summary)} |`,
	);
	const sections = modules.map((m) => {
		const items = m.items.map((item) => {
			const fields = item.fields.map((f) => `- \`${f.name}\`: ${f.doc}`).join('\n');
			return [
				`### \`${item.name}\``,
				'',
				'```wgsl',
				item.declaration,
				'```',
				'',
				item.doc,
				...(fields ? ['', fields] : []),
			].join('\n');
		});
		return [`## \`${m.name}\``, '', m.summary, '', ...items.flatMap((item) => [item, ''])].join(
			'\n',
		);
	});
	return `${renderFrontMatter([
		['id', LIBRARY_PAGE_ID],
		['title', title],
		['status', 'experimental'],
		['since', '0.1'],
		['summary', summary],
	])}
<!-- Generated by bun run docs from the doc comments of the WGSL library modules. Edit those, not this page. -->

# ${title}

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. A custom material's surface function, vertex offset or full shader can call these modules.

${INTRO}
${rows.join('\n')}

${sections.join('\n')}
${RELATED}`;
}
