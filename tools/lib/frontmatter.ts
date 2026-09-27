export interface FrontMatter {
	data: Record<string, unknown>;
	body: string;
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;

/**
 * Splits a Markdown file into its YAML front matter and its body. Returns null when the file has
 * no front matter, and throws when the YAML does not parse or is not a mapping.
 */
export function parseFrontMatter(text: string): FrontMatter | null {
	const match = text.match(FRONT_MATTER);
	if (!match) return null;
	const data: unknown = Bun.YAML.parse(match[1] ?? '');
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('front matter is not a mapping of keys to values');
	}
	return { data: data as Record<string, unknown>, body: text.slice(match[0].length) };
}

const PLAIN_SCALAR = /^[A-Za-z][\w ./-]*$/;
const YAML_KEYWORDS = new Set(['true', 'false', 'yes', 'no', 'on', 'off', 'null']);

/** A YAML scalar for a string: bare when YAML reads it back unchanged, double-quoted otherwise. */
export function yamlString(value: string): string {
	return PLAIN_SCALAR.test(value) && !YAML_KEYWORDS.has(value.toLowerCase())
		? value
		: JSON.stringify(value);
}

/** Front matter block for the given fields, in the given order. */
export function renderFrontMatter(fields: [key: string, value: string][]): string {
	return `---\n${fields.map(([key, value]) => `${key}: ${yamlString(value)}`).join('\n')}\n---\n`;
}
