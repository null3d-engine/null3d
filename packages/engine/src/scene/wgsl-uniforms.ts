// The types of the uniforms that custom WGSL declares in `struct Uniforms`, so that the type check
// catches a wrong uniform name or a value of the wrong kind. Types only: nothing here runs.
//
// WGSL reaches the engine in two forms, and the types come from each in its own way:
// - A `.wgsl` file that a module imports. TypeScript cannot read the file, so the null3D Vite plugin
//   writes a declaration beside it, whose compiled WGSL lists each uniform's name and type.
// - A template literal that a `/* wgsl */` comment tags. TypeScript sees the literal's text as its
//   type, so the types below read `struct Uniforms` from that text, as the shader build reads it.
// WGSL whose uniforms TypeScript cannot see, such as text in a `string` variable, takes any name, and
// the engine's run-time check stays the only check.

import type { ColorInput } from './color';

/**
 * A type that a uniform of custom WGSL can have, as a field of its `struct Uniforms`.
 *
 * @category api/materials
 */
export type UniformType = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'vec4f';

/**
 * The value that a uniform of each type takes. An `f32`, `i32` or `u32` uniform takes a number, and
 * `i32` and `u32` take whole numbers. A `vec2f` or `vec4f` uniform takes 2 or 4 numbers. A `vec3f`
 * uniform takes 3 numbers, or an sRGB color as `color` takes it, which the engine converts to
 * linear.
 *
 * @category api/materials
 */
export interface UniformValueByType {
	/** A number. */
	f32: number;
	/** A whole number. */
	i32: number;
	/** A whole number, 0 or more. */
	u32: number;
	/** Two numbers. */
	vec2f: readonly [number, number];
	/** Three numbers, or a color. */
	vec3f: ColorInput;
	/** Four numbers. */
	vec4f: readonly [number, number, number, number];
}

/**
 * The value of a uniform whose type TypeScript cannot see. An `f32`, `i32` or `u32` uniform takes
 * a number, and a `vec2f`, `vec3f` or `vec4f` uniform takes an array of 2, 3 or 4 numbers. A
 * `vec3f` uniform also takes an sRGB color as `color` takes it, which the engine converts to linear.
 *
 * @category api/materials
 */
export type UniformValue = number | string | readonly number[];

/** Uniforms whose names TypeScript cannot see: any name, of any type. */
type AnyUniforms = { readonly [name: string]: UniformType };

/** The marker that the steps below give for text that they cannot read. */
type Unread = 'unread';

/** A white space character in WGSL. */
type Space = ' ' | '\n' | '\t' | '\r';

/** Text without the white space at its start. */
type TrimStart<Text extends string> = Text extends `${Space}${infer Rest}` ? TrimStart<Rest> : Text;

/** Text without the white space at its end. */
type TrimEnd<Text extends string> = Text extends `${infer Rest}${Space}` ? TrimEnd<Rest> : Text;

/** Text without the white space at either end. */
type Trim<Text extends string> = TrimEnd<TrimStart<Text>>;

/** Text without any white space, such as a field's type spelled `vec3< f32 >`. */
type Squeeze<
	Text extends string,
	Done extends string = '',
> = Text extends `${infer Head}${Space}${infer Rest}`
	? Squeeze<Rest, `${Done}${Head}`>
	: `${Done}${Text}`;

/** Each spelling of a uniform's type in WGSL, and the type it names. */
interface Spellings {
	f32: 'f32';
	i32: 'i32';
	u32: 'u32';
	vec2f: 'vec2f';
	vec3f: 'vec3f';
	vec4f: 'vec4f';
	'vec2<f32>': 'vec2f';
	'vec3<f32>': 'vec3f';
	'vec4<f32>': 'vec4f';
}

/**
 * The text after the opening brace of `struct Uniforms`, in text that holds no comment, or never
 * when the text does not declare it.
 */
type OpenStruct<Text extends string> = Text extends `${string}struct${Space}${infer Rest}`
	? TrimStart<Rest> extends `Uniforms${infer Name}`
		? TrimStart<Name> extends `{${infer Body}`
			? Body
			: OpenStruct<Rest>
		: OpenStruct<Rest>
	: never;

/** The text after a comment, given the text after the comment's first slash. */
type AfterComment<Rest extends string> = Rest extends `/${string}`
	? Rest extends `${string}\n${infer After}`
		? After
		: ''
	: Rest extends `*${string}*/${infer After}`
		? After
		: '';

/**
 * The fields of `struct Uniforms` as text, without comments, or null when the WGSL declares no
 * such struct. It reads the WGSL one slash at a time up to the struct, so a comment that names the
 * struct does not count, and a long shader after the struct costs nothing.
 */
type StructFields<Wgsl extends string> = Wgsl extends `${infer Head}/${infer Rest}`
	? [OpenStruct<Head>] extends [never]
		? Rest extends `/${string}` | `*${string}`
			? StructFields<AfterComment<Rest>>
			: StructFields<Rest>
		: FieldsText<`${OpenStruct<Head>}/${Rest}`>
	: [OpenStruct<Wgsl>] extends [never]
		? null
		: FieldsText<OpenStruct<Wgsl>>;

/** The text up to the struct's closing brace, without comments. */
type FieldsText<
	Text extends string,
	Done extends string = '',
> = Text extends `${infer Head}/${infer Rest}`
	? Head extends `${infer Fields}}${string}`
		? `${Done}${Fields}`
		: Rest extends `/${string}` | `*${string}`
			? FieldsText<AfterComment<Rest>, `${Done}${Head} `>
			: Unread
	: Text extends `${infer Fields}}${string}`
		? `${Done}${Fields}`
		: Unread;

/** One field, `name: type`, as a record of its name and type. */
type Field<Text extends string> =
	Trim<Text> extends ''
		? unknown
		: Trim<Text> extends `${infer Name}:${infer Type}`
			? Squeeze<Type> extends keyof Spellings
				? { readonly [Key in Trim<Name>]: Spellings[Squeeze<Type>] }
				: Unread
			: Unread;

/** The fields of the struct's text, separated by commas, as one record. */
type Fields<Text extends string, Done = unknown> = Text extends `${infer First},${infer Rest}`
	? Field<First> extends infer Read
		? Read extends Unread
			? Unread
			: Fields<Rest, Done & Read>
		: never
	: Field<Text> extends infer Read
		? Read extends Unread
			? Unread
			: Done & Read
		: never;

/** A record as one flat object type, which editors show by its fields. */
type Flat<Record> = { readonly [Key in keyof Record]: Record[Key] };

/**
 * The uniforms of WGSL text. A field of a type that uniforms cannot have stops the shader build,
 * so text that these steps cannot read takes any name rather than failing the type check.
 */
type TextUniforms<Wgsl extends string> = string extends Wgsl
	? AnyUniforms
	: StructFields<Wgsl> extends infer Text extends string
		? Text extends Unread
			? AnyUniforms
			: Fields<Text> extends infer Read
				? Read extends Unread
					? AnyUniforms
					: Flat<Read>
				: never
		: Record<never, never>;

/** The uniforms that compiled WGSL lists, each with its name and type. */
type CompiledUniforms<Wgsl> = Wgsl extends {
	readonly uniforms: readonly (infer Uniform extends { name: string; type: UniformType })[];
}
	? string extends Uniform['name']
		? AnyUniforms
		: Flat<{ [Each in Uniform as Each['name']]: Each['type'] }>
	: AnyUniforms;

/**
 * The uniforms that WGSL declares as the fields of its `struct Uniforms`, each name with its type,
 * such as `{ tint: 'vec3f'; width: 'f32' }`. TypeScript sees them in a template literal that a
 * `wgsl` block comment tags, and in a `.wgsl` file once the null3D Vite plugin has written the
 * file's declaration. WGSL whose uniforms TypeScript cannot see, such as text in a `string`
 * variable, gives a record that takes any name.
 *
 * @category api/materials
 */
export type WgslUniforms<Wgsl> = [Wgsl] extends [string]
	? TextUniforms<Wgsl>
	: CompiledUniforms<Wgsl>;

/**
 * The values of WGSL's uniforms by name, each optional and of the kind that its type takes, as the
 * `uniforms` option and `set` of a custom material take them. A name that the WGSL does not declare
 * fails the type check. WGSL whose uniforms TypeScript cannot see takes any name, and the engine
 * checks the names when it runs.
 *
 * @category api/materials
 */
export type UniformValues<Wgsl> =
	WgslUniforms<Wgsl> extends infer Uniforms extends { readonly [name: string]: UniformType }
		? string extends keyof Uniforms
			? { readonly [name: string]: UniformValue | undefined }
			: { readonly [Name in keyof Uniforms]?: UniformValueByType[Uniforms[Name]] }
		: never;
