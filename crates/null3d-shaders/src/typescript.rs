//! The generated TypeScript modules. Keys are sorted and the layout is fixed, so two builds of the
//! same inputs write the same bytes. The layout is the one the repository's formatter (Biome)
//! produces: tabs, single quotes, every object literal expanded, and shader sources as template
//! literals.
//!
//! The main module holds the types, every shader that the manifest does not load by device, and
//! the loader of the device modules. Each of those shaders is an export of its own, so a bundle
//! keeps only the shaders that its code imports: the engine's download holds none of the test
//! shaders. The shaders that load by device go into one device module for each target and each
//! value of the permutation bits that a device fixes. Each is a file of its own that the loader
//! imports on demand, so a page downloads only the builds its device draws with. The builds of a
//! feature that loads on first use go into device modules of the feature's own, one for each
//! target and each value of the device's bits that those builds vary in. A page loads one of them
//! the first time a pipeline asks for one of the feature's builds, so a page that never uses the
//! feature downloads none of them.
//!
//! Many builds share a stage's source: a vertex shader stays the same across bits that change only
//! the fragment shader. Each module writes a source that several of its builds use once, as a
//! constant at its top, and those builds name the constant. The browser then parses each text once.
//!
//! Sources that differ still share most of their text: the same structs, uniforms and functions,
//! with a few that differ by the build's bits. Each device module also writes a paragraph (the text
//! between two blank lines) that several of its sources hold once, as a constant before the
//! sources, and each source names it in its template literal. A module is then several times
//! smaller before compression, and the browser parses less text. The page joins the paragraphs back
//! into each source when it evaluates the module. The main module shares whole sources only: a
//! bundle keeps just the exports it imports, and a minifier keeps a template literal that names a
//! constant even where nothing reads it.
//!
//! The same paragraph also appears in many device modules, which repeat it once per module. One
//! kind of device module, a target and one value of the bits a device fixes, gains a table of its
//! own when at least [SHARED_PARAGRAPH_MIN_USES] of its feature-set modules name one paragraph.
//! The table holds each such paragraph once, and the modules that use it name its exports instead
//! of writing the text. The start's module of that kind never names the table, so a page's first
//! download holds none of it: the build leaves the table to the modules of the features that load
//! on first use, as the list of a build's files for offline play groups them.
//!
//! A shader that loads on a feature's first use as a whole (`first_use = true` in the manifest),
//! such as the room's generator, has a module of its own for each target, which the feature's code
//! imports, so no page downloads it before it uses the feature.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use null3d_gpu::drawlist::permutation;

use crate::glsl::DEPTH_MAPPING_UNIFORM;
use crate::{FEATURE_JOIN, FirstUseFeatures, GlslStage, Output, Target, VariantOutput};

/// The formatter's line width, and the width it counts for one tab.
const LINE_WIDTH: usize = 100;
const TAB_WIDTH: usize = 2;

/// The file name of the main module, without its extension.
pub(crate) const MAIN_MODULE: &str = "shaders";

/// The file name of the module that names the features that load on first use, without its
/// extension. The page imports it alone, so it holds no shader text.
pub(crate) const FEATURES_MODULE: &str = "shader-features";

/// The file name of the module that names the permutation words a narrowed build made, without its
/// extension. The engine's shader lookup imports it with the main module's types, so the page and
/// each worker keep the start shader data out of their bundles.
pub(crate) const PERMUTATIONS_MODULE: &str = "shader-permutations";

/// The extension of each device module's file: plain JavaScript, which the main module imports by
/// address, so that a bundler copies it as it is.
pub(crate) const DEVICE_MODULE_EXTENSION: &str = "js";

/// The start of each device module's file name.
pub(crate) const DEVICE_MODULE_PREFIX: &str = "shaders-";

/// The start of the file name of a target's table of shared paragraphs, with the separator that the
/// target's name follows: `shader-paragraphs-glsl` and `shader-paragraphs-glsl-draw-index`. It
/// starts with no `shaders-`, so the list of a build's files for offline play reads a table as no
/// shader feature of its own.
pub(crate) const PARAGRAPHS_MODULE_PREFIX: &str = "shader-paragraphs-";

/// How many feature-set device modules of one kind, a target and one value of the bits a device
/// fixes, must name a paragraph before the build writes it once in that kind's table instead of
/// inside each module that uses it.
///
/// The count is the dial on a table's size, which is a file of its own that a page downloads before
/// it draws the first feature that names it. Measured on one WebGL2 kind, whose 140 feature-set
/// device modules hold 100 MB, a table at 20 comes to about 0.6 MB uncompressed and 33 KB after
/// Brotli, inside the per-file budget of D-56, and keeps 20 MB of the target's repeated text, about
/// a fifth of what sharing every repeated paragraph would save. Lowering it saves more text and
/// grows the table; raising it shrinks both.
pub(crate) const SHARED_PARAGRAPH_MIN_USES: usize = 20;

/// The comment at the top of every module.
const HEADER: &str = r"// Generated by `bun run shaders` (cargo run -p null3d-shaders --bin shader-build) from
// crates/null3d-shaders/shaders.toml and the WGSL files beside it. Do not edit this file: git
// ignores it, and the next build replaces it.
";

/// The types of the records.
const TYPES: &str = r"
/** The WGSL bind group and binding of a resource. */
export interface ShaderBinding {
	readonly group: number;
	readonly binding: number;
}

/** A uniform block of one GLSL shader, and the WGSL uniform buffer it stands for. */
export interface GlslUniformBlock extends ShaderBinding {
	/** The block name, for `getUniformBlockIndex`. */
	readonly name: string;
}

/**
 * A texture uniform of one GLSL shader. GLSL ES 3.00 joins a texture and its sampler in one
 * uniform, so the record names the WGSL texture and the WGSL sampler.
 */
export interface GlslTexture extends ShaderBinding {
	/** The uniform name, for `getUniformLocation`. */
	readonly name: string;
	/** The sampler the shader samples the texture with, or null when it only loads texels. */
	readonly sampler: ShaderBinding | null;
}

/**
 * One GLSL ES 3.00 shader. GLSL ES 3.00 has no binding numbers, so the WebGL2 backend binds each
 * uniform block and texture by the name it has in this shader.
 */
export interface GlslStage {
	readonly source: string;
	readonly uniformBlocks: readonly GlslUniformBlock[];
	readonly textures: readonly GlslTexture[];
}

/**
 * The shaders of one render pipeline, to link into one WebGL2 program. The vertex shader maps
 * depth through the uniform that `DEPTH_MAPPING_UNIFORM` names, and keeps GL's row order: the
 * canvas shows the image the right way up, a pixel read returns the bottom row first, and front
 * faces wind counter-clockwise, as on WebGPU. A vertex shader that reads the instance or draw
 * index also declares the uniform `naga_vs_first_instance`, which the backend leaves unset
 * because WebGL2 draws have no first instance.
 */
export interface GlslProgram {
	readonly vertex: GlslStage;
	readonly fragment: GlslStage;
}

/** The WGSL entry points of one render pipeline. */
export interface WgslPipeline {
	readonly vertex: string;
	readonly fragment: string;
}

/** One WGSL module for WebGPU, and the entry points of its render pipelines. */
export interface WgslShader<Pipeline extends string = string> {
	readonly source: string;
	readonly pipelines: Readonly<Record<Pipeline, WgslPipeline>>;
}

/** One variant of a shader, with its output for each backend it targets. */
export interface ShaderVariant<Pipeline extends string = string> {
	/**
	 * The permutation bits that the variant was built with, as a render pipeline's permutation
	 * word holds them: 0 for a variant without permutation bits.
	 */
	readonly permutation: number;
	/** WGSL for WebGPU, or null when the variant does not target WebGPU. */
	readonly wgsl: WgslShader<Pipeline> | null;
	/** GLSL programs for WebGL2 by pipeline, or null when the variant does not target WebGL2. */
	readonly glsl: Readonly<Record<Pipeline, GlslProgram>> | null;
}

/** A shader's variants by name. */
export type ShaderVariants<Pipeline extends string = string> = Readonly<
	Record<string, ShaderVariant<Pipeline>>
>;
";

/// The types of the loader tables, before them.
const LOADER_TYPE: &str = r"
/** Loaders of device modules, by the permutation bits that a device fixes. */
type DeviceModules = Readonly<Record<number, () => Promise<{ SHADERS: DeviceShaders }>>>;

/**
 * The device modules of the builds that need one set of features that load on first use, for one
 * target: the permutation bits that a device fixes and that those builds vary in, and the loader of
 * the module of each value of those bits.
 */
export interface FirstUseFiles {
	readonly bits: number;
	readonly modules: Readonly<Record<number, () => Promise<{ SHADERS: FirstUseShaders }>>>;
}

/**
 * Imports a device module by its address. A bundler copies the file that an address names once,
 * however many bundles name it, so the page's bundle and each worker's share one copy of each
 * module. The null3D Vite plugin keeps Vite from turning a small module into a data: address,
 * which a strict Content Security Policy blocks.
 */
function importShaders<Shaders>(url: URL): Promise<{ SHADERS: Shaders }> {
	return import(/* @vite-ignore */ url.href);
}
";

/// The start of each module of a shader that loads on first use.
const FIRST_USE_HEADER: &str = r"
import type { ShaderVariant } from './shaders';
";

/// The start of each module of a target's loader table of the device modules of builds that need
/// several features.
const COMBINED_HEADER: &str = r"
import type { FirstUseFiles, FirstUseShaders } from './shaders';

/** Imports a device module by its address, as the main module's loaders do. */
function importShaders(url: URL): Promise<{ SHADERS: FirstUseShaders }> {
	return import(/* @vite-ignore */ url.href);
}
";

/// The loaders of the device modules, after the loader tables. Each target has a table and a
/// function of its own, so a bundle that loads one target's shaders holds none of the other's.
const LOADERS: &str = r"
function loadDeviceModule(modules: DeviceModules, target: string, bits: number) {
	const load = modules[bits];
	if (!load) {
		const message = `no shader module holds the ${target} builds with permutation bits ${bits}`;
		return Promise.reject(new Error(message));
	}
	return load().then((module) => module.SHADERS);
}

/**
 * Loads the WGSL builds of the shaders that load by device, with the permutation bits `bits`,
 * which holds only bits that a device fixes. Each value of those bits is a module of its own, so a
 * page downloads one.
 */
export function loadWgslShaders(bits: number): Promise<DeviceShaders> {
	return loadDeviceModule(WGSL_MODULES, 'WGSL', bits);
}

/**
 * Loads the GLSL builds of the shaders that load by device, with the permutation bits `bits`,
 * which holds only bits that a device fixes. Each value of those bits is a module of its own, so a
 * page downloads one.
 */
export function loadGlslShaders(bits: number): Promise<DeviceShaders> {
	return loadDeviceModule(GLSL_MODULES, 'GLSL', bits);
}

/**
 * The key of the device modules that hold the build of `shader` with the permutation word
 * `permutation`: the names of the features that load on first use and that the build needs, its
 * shader's and those of the word's bits, sorted and joined by `FEATURE_JOIN`. Undefined for a
 * build that the device modules of the start hold. A value that names a feature another template
 * names too counts only for a template that lists its name (`FEATURE_MASKS`), because a shared
 * value names a different feature in each template (decision record D-156).
 */
export function firstUseFile(shader: string, permutation: number): string | undefined {
	const features = new Set<string>();
	const own = SHADER_FEATURES[shader];
	if (own !== undefined) features.add(own);
	const listed = permutation & ((FEATURE_MASKS[shader] ?? 0) | FEATURE_UNSHARED);
	for (const [bit, name] of FEATURE_BITS) if ((listed & bit) !== 0) features.add(name);
	return features.size === 0 ? undefined : [...features].sort().join(FEATURE_JOIN);
}

/** A target's device modules of features that load on first use, and the keys that pages asked for. */
interface FirstUseTarget {
	readonly name: string;
	/** The modules of each feature, by its name. */
	readonly files: Readonly<Record<string, FirstUseFiles>>;
	/** The keys of the modules of builds that need several features. */
	readonly combined: readonly string[];
	/** Loads the table of one family of builds that need several features, for a device whose fixed
	 * bits are `bits`: the half-precision builds sit in a table of their own. */
	readonly loadCombined: (
		bits: number,
		file: string,
	) => Promise<Readonly<Record<string, FirstUseFiles>>>;
	/** The features whose own modules a page asked for. */
	readonly asked: Set<string>;
}

const WGSL_TARGET: FirstUseTarget = {
	name: 'WGSL',
	files: WGSL_FIRST_USE,
	combined: WGSL_COMBINED,
	loadCombined: loadWgslCombined,
	asked: new Set(),
};

const GLSL_TARGET: FirstUseTarget = {
	name: 'GLSL',
	files: GLSL_FIRST_USE,
	combined: GLSL_COMBINED,
	loadCombined: loadGlslCombined,
	asked: new Set(),
};

/**
 * Loads the builds of `file`, a key that `firstUseFile` gives, for a device whose fixed bits are
 * `bits`. A key of several features loads the table of their modules first. Once a page has asked
 * for the module of each feature of such a key, that table starts to load beside it, so a build of
 * several features then waits for its own module alone.
 */
function loadFirstUse(target: FirstUseTarget, file: string, bits: number) {
	const combined = file.includes(FEATURE_JOIN);
	if (!combined && !target.asked.has(file)) {
		target.asked.add(file);
		const needs = (key: string) => key.split(FEATURE_JOIN).every((one) => target.asked.has(one));
		for (const key of target.combined)
			if (needs(key)) target.loadCombined(bits, key).catch(() => undefined);
	}
	const table = combined ? target.loadCombined(bits, file) : Promise.resolve(target.files);
	return table.then((loaded) => {
		const of = loaded[file];
		const load = of?.modules[bits & of.bits];
		if (!load)
			throw new Error(
				`no shader module holds the ${target.name} builds of ${file} with permutation bits ${bits}`,
			);
		return load().then((module) => module.SHADERS);
	});
}

/**
 * Loads the WGSL builds that need the features of `file`, a key that `firstUseFile` gives, for a
 * device whose fixed permutation bits are `bits`. Its module holds only those builds.
 */
export function loadWgslFeature(file: string, bits: number): Promise<FirstUseShaders> {
	return loadFirstUse(WGSL_TARGET, file, bits);
}

/**
 * Loads the GLSL builds that need the features of `file`, a key that `firstUseFile` gives, for a
 * device whose fixed permutation bits are `bits`. Its module holds only those builds.
 */
export function loadGlslFeature(file: string, bits: number): Promise<FirstUseShaders> {
	return loadFirstUse(GLSL_TARGET, file, bits);
}

/**
 * The key of each WGSL device module of features that load on first use. A key of several
 * features names the module of the builds that need each of them.
 */
export function wgslFirstUseFiles(): string[] {
	return [...Object.keys(WGSL_FIRST_USE), ...WGSL_COMBINED];
}

/**
 * The key of each GLSL device module of features that load on first use. A key of several
 * features names the module of the builds that need each of them.
 */
export function glslFirstUseFiles(): string[] {
	return [...Object.keys(GLSL_FIRST_USE), ...GLSL_COMBINED];
}

/**
 * Every shader variant, by shader name and variant name: those of this module and those of every
 * device module, the modules of features that load on first use among them, for the tests that
 * check them all. With `part` and `parts`, it gives only part `part` (from 1) of `parts`: every
 * `parts`-th variant of this module and every `parts`-th device module, starting at that part's
 * place, so that pages which share the check each download only their own modules.
 */
export async function everyShader(part = 1, parts = 1): Promise<Record<string, ShaderVariants>> {
	const mine = <T>(items: readonly T[]) => items.filter((_, i) => i % parts === part - 1);
	const every: Record<string, ShaderVariants> = {};
	const variants = Object.entries(SHADERS).flatMap(([name, of]) =>
		Object.entries(of).map(([variant, build]) => [name, variant, build] as const),
	);
	for (const [name, variant, build] of mine(variants)) {
		every[name] = { ...every[name], [variant]: build };
	}
	// The builds of both halves of the fixed bits: a page loads the table of its own half alone,
	// while these tests need every build. Each family's table holds a prefix of the features of
	// the keys that it names.
	const tables = [
		WGSL_FIRST_USE,
		GLSL_FIRST_USE,
		...(await Promise.all([
			...[...new Set(WGSL_COMBINED.map(WgslCombinedFamily))].flatMap((family) => [
				loadWgslCombined(0, family),
				loadWgslCombined(HALF, family),
			]),
			...[...new Set(GLSL_COMBINED.map(GlslCombinedFamily))].flatMap((family) => [
				loadGlslCombined(0, family),
				loadGlslCombined(HALF, family),
			]),
		])),
	];
	const loads = [
		...Object.values(WGSL_MODULES),
		...Object.values(GLSL_MODULES),
		...tables.flatMap((table) =>
			Object.values(table).flatMap((files) => Object.values(files.modules)),
		),
		...FIRST_USE,
	];
	// The modules download at once, and their builds join in the order of the list.
	for (const module of await Promise.all(mine(loads).map((load) => load()))) {
		for (const [name, variants] of Object.entries(module.SHADERS)) {
			every[name] = { ...every[name], ...variants };
		}
	}
	return every;
}
";

/// A device module: the builds of the shaders that load by device for one target, with one value
/// of the permutation bits that a device fixes. A module of features that load on first use holds
/// only the builds that need just those features, and the modules without one hold the builds of
/// the start.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct DeviceModule {
    /// The key of the features that the module's builds need, as [`FirstUseFeatures::file_of`]
    /// gives it, or None for a module of the start.
    file: Option<String>,
    target: Target,
    bits: u32,
}

/// The text that joins the names of the features that a module's builds need, in its file name.
const FEATURE_JOIN_IN_NAMES: &str = "-and-";

impl DeviceModule {
    /// The module that holds a build of `shader`, which loads by device. Such a build has one
    /// target.
    fn of(shader: &str, variant: &VariantOutput, first_use: &FirstUseFeatures) -> Self {
        let target = if variant.wgsl.is_some() {
            Target::Wgsl
        } else {
            Target::Glsl
        };
        Self {
            file: first_use.file_of(shader, variant.permutation),
            target,
            bits: variant.permutation & permutation::DEVICE,
        }
    }

    /// The names of the module's bits, in bit order.
    fn bit_names(&self) -> impl Iterator<Item = &'static str> {
        let bits = self.bits;
        permutation::NAMES
            .into_iter()
            .filter(move |&(_, value)| bits & value != 0)
            .map(|(name, _)| name)
    }

    /// The file name without its extension: the prefix, the names of the features that load on
    /// first use that its builds need, joined with `-and-`, the target, then each bit's name in
    /// lowercase, all joined with hyphens, such as `shaders-glsl-draw-index`,
    /// `shaders-sprites-glsl-draw-index` or `shaders-hash-and-skinning-wgsl`.
    fn stem(&self) -> String {
        self.stem_with(DEVICE_MODULE_PREFIX)
    }

    /// The same name under another prefix. A target and one value of the device's bits have a
    /// shared table of paragraphs, whose file name is the start's module under the table's prefix.
    fn stem_with(&self, prefix: &str) -> String {
        let mut stem = prefix.to_owned();
        if let Some(file) = &self.file {
            let names = file
                .replace('_', "-")
                .replace(FEATURE_JOIN, FEATURE_JOIN_IN_NAMES);
            stem.push_str(&names);
            stem.push('-');
        }
        stem.push_str(self.target.name());
        for name in self.bit_names() {
            stem.push('-');
            stem.push_str(&name.to_ascii_lowercase().replace('_', "-"));
        }
        stem
    }
}

/// Builds by shader name, then by variant name.
type Builds<'a> = BTreeMap<&'a str, BTreeMap<&'a str, &'a VariantOutput>>;

/// A build of a shader that loads by device: its name, its output and the module that holds it.
type Placed<'a> = (&'a str, &'a VariantOutput, DeviceModule);

/// The builds of the shaders that load by device, by device module. A target has a module of the
/// start for each combination of the device's bits that any of its shaders varies in. Each set of
/// features that load on first use and that a build needs has a module for each combination of the
/// device's bits that its builds vary in, so no set without builds has one. Each module holds, of
/// each shader, the builds of its features, or of the start, that a device with the module's bits
/// asks for: those with the module's bits that those builds vary in, so a shader whose builds vary
/// in none is in every module of its target. Each module of the start lists every shader that loads
/// by device, with or without builds in it, and a features' module lists the shaders that have
/// builds in it.
fn device_builds(output: &Output) -> BTreeMap<DeviceModule, Builds<'_>> {
    // Each shader that loads by device, with each of its builds and the module that holds it.
    let placed: Vec<(&str, Vec<Placed<'_>>)> = output
        .by_device
        .iter()
        .filter_map(|shader| {
            let variants = output.shaders.get(shader)?;
            let builds = variants
                .iter()
                .map(|(name, variant)| {
                    let module = DeviceModule::of(shader, variant, &output.first_use);
                    (name.as_str(), variant, module)
                })
                .collect();
            Some((shader.as_str(), builds))
        })
        .collect();
    let mut varies: BTreeMap<(&str, Option<&str>, Target), u32> = BTreeMap::new();
    let mut groups: BTreeMap<(Option<&str>, Target), u32> = BTreeMap::new();
    for (shader, builds) in &placed {
        for (_, _, of) in builds {
            let file = of.file.as_deref();
            *varies.entry((shader, file, of.target)).or_default() |= of.bits;
            *groups.entry((file, of.target)).or_default() |= of.bits;
            // A device loads a module of the start for its bits, whichever builds vary in them.
            *groups.entry((None, of.target)).or_default() |= of.bits;
        }
    }
    let mut modules = BTreeMap::new();
    for (&(file, target), &all) in &groups {
        let mut bits = all;
        loop {
            let mut held = Builds::new();
            for (shader, builds) in &placed {
                let Some(&varied) = varies.get(&(shader, file, target)) else {
                    if file.is_none() {
                        held.insert(shader, BTreeMap::new());
                    }
                    continue;
                };
                let wanted = bits & varied;
                held.insert(
                    shader,
                    builds
                        .iter()
                        .filter(|(_, _, of)| {
                            of.file.as_deref() == file && of.target == target && of.bits == wanted
                        })
                        .map(|&(name, variant, _)| (name, variant))
                        .collect(),
                );
            }
            let module = DeviceModule {
                file: file.map(str::to_owned),
                target,
                bits,
            };
            modules.insert(module, held);
            if bits == 0 {
                break;
            }
            bits = (bits - 1) & all;
        }
    }
    modules
}

/// The paragraphs that enough device modules of one kind and family share, and the table module
/// that holds them. A kind is a target and one value of the permutation bits that a device fixes,
/// which is what a device module is built for. A family is the feature that every module naming
/// one of the table's paragraphs needs. The base family has no name: its paragraphs are those that
/// modules of several features share, so no feature alone can claim them.
struct SharedParagraphs {
    /// The table's file name without its extension, such as `shader-paragraphs-glsl-draw-index`, or
    /// with its family, such as `shader-paragraphs-glsl-draw-index-bump`.
    stem: String,
    /// Each shared paragraph with the name the table exports it as, in the order the kind's
    /// modules first name them.
    paragraphs: Vec<(String, String)>,
    /// The export name of each shared paragraph, by its text.
    names: HashMap<String, String>,
}

/// One feature-set module of a kind, as the choice of a table needs it: the features its builds
/// need, and the paragraphs its sources hold, each once.
struct ParagraphModule<'a> {
    features: BTreeSet<&'a str>,
    paragraphs: BTreeSet<&'a str>,
}

/// The paragraphs that at least [`SHARED_PARAGRAPH_MIN_USES`] feature-set device modules of one
/// kind and one family name, by kind. A paragraph goes to the family of the one feature that every
/// module naming it needs, and to the base family when no single feature covers them all. So the
/// relief features' text sits in tables of its own, and a page that draws no relief material
/// downloads none of it.
///
/// The start's modules are left out: only a module of a feature that loads on first use takes part,
/// so a table never joins a page's first download.
///
/// A table belongs to one kind and not to a whole target, because the devices differ in their bits:
/// a table of a target's every module would be tens of times over the limit of one shader file
/// ([D-56]). A kind or family with no such paragraph has no entry, and then no table and no module
/// names one.
fn shared_paragraphs(
    devices: &BTreeMap<DeviceModule, Builds<'_>>,
) -> BTreeMap<(Target, u32), Vec<SharedParagraphs>> {
    let mut kinds: BTreeMap<(Target, u32), Vec<ParagraphModule<'_>>> = BTreeMap::new();
    for (module, builds) in devices {
        let Some(file) = module.file.as_deref() else {
            continue;
        };
        let held = first_use_counts(
            first_use_counts(
                builds
                    .values()
                    .flat_map(|variants| variants.values().copied())
                    .flat_map(sources),
            )
            .iter()
            .flat_map(|&(source, _)| source.split(PARAGRAPH_BREAK)),
        );
        kinds
            .entry((module.target, module.bits))
            .or_default()
            .push(ParagraphModule {
                features: file.split(FEATURE_JOIN).collect(),
                // A module counts once for each paragraph it holds, however many of its sources
                // hold it.
                paragraphs: held.into_iter().map(|(paragraph, _)| paragraph).collect(),
            });
    }
    let mut tables = BTreeMap::new();
    for ((target, bits), modules) in kinds {
        // Each paragraph's modules, in the order the kind's modules first name it, with the
        // features that every one of them needs.
        let mut at: HashMap<&str, usize> = HashMap::new();
        let mut counts: Vec<(&str, usize, Option<BTreeSet<&str>>)> = Vec::new();
        for module in &modules {
            for &paragraph in &module.paragraphs {
                let position = *at.entry(paragraph).or_insert_with(|| {
                    counts.push((paragraph, 0, None));
                    counts.len() - 1
                });
                let count = &mut counts[position];
                count.1 += 1;
                count.2 = Some(match count.2.take() {
                    None => module.features.clone(),
                    Some(common) => common.intersection(&module.features).copied().collect(),
                });
            }
        }
        // Each family's table, in name order: the base family first, then each feature.
        let mut families: BTreeMap<Option<&str>, Vec<(String, String)>> = BTreeMap::new();
        for (paragraph, count, common) in counts {
            if count < SHARED_PARAGRAPH_MIN_USES {
                continue;
            }
            let family = common.and_then(|common| common.into_iter().next());
            let table = families.entry(family).or_default();
            let name = match family {
                None => format!("SHARED_{}", table.len()),
                Some(feature) => format!("{}_SHARED_{}", feature.to_ascii_uppercase(), table.len()),
            };
            // A paragraph no longer than its name and the `${}` around it would not shrink.
            if paragraph.len() > name.len() + 3 {
                table.push((paragraph.to_owned(), name));
            }
        }
        let mut kind_tables = Vec::new();
        for (family, paragraphs) in families {
            if paragraphs.is_empty() {
                continue;
            }
            let names = paragraphs
                .iter()
                .map(|(paragraph, name)| (paragraph.clone(), name.clone()))
                .collect();
            // The table is named as the start's module of the same kind is, then its family, so a
            // reader can tell which devices and which feature download it.
            let mut stem = DeviceModule {
                file: None,
                target,
                bits,
            }
            .stem_with(PARAGRAPHS_MODULE_PREFIX);
            if let Some(feature) = family {
                stem.push('-');
                stem.push_str(&feature.replace('_', "-"));
            }
            kind_tables.push(SharedParagraphs {
                stem,
                paragraphs,
                names,
            });
        }
        if !kind_tables.is_empty() {
            tables.insert((target, bits), kind_tables);
        }
    }
    tables
}

/// The table module of one kind: one constant for each paragraph that enough of the kind's device
/// modules share, in the order the modules first name them. The modules that name a constant import
/// it from this file by its name beside theirs, so a bundler that copies a device module as it is
/// keeps the import, and the Vite plugin emits this file beside it.
fn paragraphs_module(table: &SharedParagraphs) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.line("");
    ts.line("/**");
    ts.line(
        " * The paragraphs that many of this kind's device modules share, each written once. A",
    );
    ts.line(
        " * device module imports the ones it uses from this file and names them in its sources.",
    );
    ts.line(
        " * Nothing else imports this file, and the start's device module never does, so a page",
    );
    ts.line(" * downloads it with the first feature whose builds need it.");
    ts.line(" */");
    for (paragraph, name) in &table.paragraphs {
        ts.literal(&format!("export const {name} = "), paragraph, ";");
    }
    ts.out
}

/// The modules that a build makes, named and ready to render one at a time. It computes the work
/// that every module shares once, and lists the modules' names without rendering any text, so a
/// caller that writes each module to its own file never holds the whole set's text at once.
pub struct ModuleSet<'a> {
    /// The build whose text the modules render from.
    output: &'a Output,
    /// The builds of the shaders that load by device, by device module.
    devices: BTreeMap<DeviceModule, Builds<'a>>,
    /// The tables of shared paragraphs of each kind, in the order of their families.
    shared: BTreeMap<(Target, u32), Vec<SharedParagraphs>>,
    /// The kind of module that each file name holds.
    plan: BTreeMap<String, ModuleKind<'a>>,
}

/// The kind of one module of a build: what its text renders from.
enum ModuleKind<'a> {
    /// The main module.
    Main,
    /// The module that names the features that load on first use.
    Features,
    /// The module that names the permutation words of a narrowed build.
    Permutations,
    /// A device module, by its name and the builds it holds.
    Device(DeviceModule),
    /// One table of shared paragraphs: a target, one value of the device's bits, and the table's
    /// place in that kind's list.
    Paragraphs(Target, u32, usize),
    /// A module of a shader that loads on first use, by the shader and the target.
    FirstUse(&'a str, Target),
    /// The loader table of one family of a target's device modules of builds that need several
    /// features, of the half-precision builds or of the rest.
    Combined(Target, bool, String),
}

impl<'a> ModuleSet<'a> {
    /// The modules that `output` makes. This computes the device modules and their shared
    /// paragraphs once, and names every module without rendering it.
    pub fn new(output: &'a Output) -> Self {
        let devices = device_builds(output);
        let shared = shared_paragraphs(&devices);
        let mut plan = BTreeMap::from([
            (format!("{MAIN_MODULE}.ts"), ModuleKind::Main),
            (format!("{FEATURES_MODULE}.ts"), ModuleKind::Features),
            (
                format!("{PERMUTATIONS_MODULE}.ts"),
                ModuleKind::Permutations,
            ),
        ]);
        for module in devices.keys() {
            plan.insert(
                format!("{}.{DEVICE_MODULE_EXTENSION}", module.stem()),
                ModuleKind::Device(module.clone()),
            );
        }
        for (&(target, bits), tables) in &shared {
            for (index, table) in tables.iter().enumerate() {
                plan.insert(
                    format!("{}.{DEVICE_MODULE_EXTENSION}", table.stem),
                    ModuleKind::Paragraphs(target, bits, index),
                );
            }
        }
        for (stem, shader, target) in first_use_modules(output) {
            plan.insert(format!("{stem}.ts"), ModuleKind::FirstUse(shader, target));
        }
        for target in [Target::Wgsl, Target::Glsl] {
            let combined = first_use_files(&devices, target, true);
            let depths = combined_depths(target, &combined);
            for half in [false, true] {
                let files = split_by_half(&combined, half);
                for family in combined_families(&depths, &files).keys() {
                    plan.insert(
                        format!("{}.ts", combined_module_name(target, half, family)),
                        ModuleKind::Combined(target, half, family.clone()),
                    );
                }
            }
        }
        Self {
            output,
            devices,
            shared,
            plan,
        }
    }

    /// The file name of each module, in order.
    pub fn names(&self) -> impl Iterator<Item = &str> + '_ {
        self.plan.keys().map(String::as_str)
    }

    /// The text of the module named `name`, or None when the build makes no such module.
    pub fn text(&self, name: &str) -> Option<String> {
        match self.plan.get(name)? {
            ModuleKind::Main => Some(main_module(self.output, &self.devices)),
            ModuleKind::Features => Some(features_module(self.output)),
            ModuleKind::Permutations => Some(permutations_module(self.output)),
            ModuleKind::Device(module) => {
                // A module of the start keeps its own paragraphs and names no table: a page
                // downloads one of them before its first frame, and the table belongs to the
                // features that load on first use. `offlineFiles` in the Vite plugin groups the
                // table by the modules that name it.
                let tables: &[SharedParagraphs] = if module.file.is_some() {
                    self.shared
                        .get(&(module.target, module.bits))
                        .map_or(&[], Vec::as_slice)
                } else {
                    &[]
                };
                Some(device_module(module, &self.devices[module], tables))
            }
            ModuleKind::Paragraphs(target, bits, index) => Some(paragraphs_module(
                self.shared.get(&(*target, *bits))?.get(*index)?,
            )),
            ModuleKind::FirstUse(shader, target) => {
                Some(first_use_module(self.output, shader, *target))
            }
            ModuleKind::Combined(target, half, family) => {
                let combined = first_use_files(&self.devices, *target, true);
                let depths = combined_depths(*target, &combined);
                let files = split_by_half(&combined, *half);
                let of_family = combined_families(&depths, &files)
                    .remove(family)
                    .expect("a planned family holds at least one key");
                Some(combined_module(*target, &of_family))
            }
        }
    }

    /// Renders every module and hands each, with its name, to `each`, whose results come back in
    /// the order of the names. A module's text is `each`'s to keep or drop, so a caller that
    /// writes each module and drops it holds only the modules being rendered, never the set.
    ///
    /// Rendering a module reads the build without changing it, and the largest modules take
    /// seconds, so the modules render on every core. Each thread takes every nth name, which
    /// spreads the large device modules between them.
    pub fn render_each<T: Send>(&self, each: impl Fn(&str, String) -> T + Sync) -> Vec<T> {
        let names: Vec<&str> = self.names().collect();
        let render = |name: &str| {
            let text = self
                .text(name)
                .expect("a module that the set names has text");
            each(name, text)
        };
        let threads = std::thread::available_parallelism()
            .map_or(1, |count| count.get())
            .min(names.len());
        if threads <= 1 {
            return names.into_iter().map(render).collect();
        }
        let (names, render) = (&names, &render);
        let mut rendered: Vec<(usize, T)> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..threads)
                .map(|at| {
                    scope.spawn(move || {
                        names
                            .iter()
                            .enumerate()
                            .skip(at)
                            .step_by(threads)
                            .map(|(place, name)| (place, render(name)))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            handles
                .into_iter()
                .flat_map(|handle| handle.join().expect("a module renderer"))
                .collect()
        });
        rendered.sort_unstable_by_key(|&(place, _)| place);
        rendered.into_iter().map(|(_, result)| result).collect()
    }
}

/// Renders every module, by file name: the main module, TypeScript, and each device module, plain
/// JavaScript. A caller that writes the modules one at a time uses [`ModuleSet::render_each`]
/// instead, since the whole set's text is several gigabytes.
pub(crate) fn modules(output: &Output) -> BTreeMap<String, String> {
    ModuleSet::new(output)
        .render_each(|name, text| (name.to_owned(), text))
        .into_iter()
        .collect()
}

/// The device modules of `files` whose fixed bits hold the half-precision bit, or those that do
/// not, so that the loader table of one device's builds is one file that fits its budget.
fn split_by_half<'a>(
    files: &BTreeMap<&'a str, (u32, Vec<&'a DeviceModule>)>,
    half: bool,
) -> BTreeMap<&'a str, (u32, Vec<&'a DeviceModule>)> {
    let mask = permutation::bit("HALF").unwrap_or(0);
    let mut out: BTreeMap<&str, (u32, Vec<&DeviceModule>)> = BTreeMap::new();
    for (file, (_, modules)) in files {
        let kept: Vec<&DeviceModule> = modules
            .iter()
            .copied()
            .filter(|module| (module.bits & mask != 0) == half)
            .collect();
        if kept.is_empty() {
            continue;
        }
        let bits = kept.iter().fold(0u32, |bits, module| bits | module.bits);
        out.insert(file, (bits, kept));
    }
    out
}

/// How large one combination loader may grow before the build splits its family further, in bytes
/// of its rendered text. The budget of such a file is 96 KB uncompressed (D-14), so a table that
/// the build writes stays well inside it and a later feature's keys need to add a third of the
/// budget before a family overflows.
const COMBINED_TABLE_TARGET: usize = 64 * 1024;

/// The family of a key: its first `depth` feature names, joined. The key's names are sorted, so a
/// family is always a prefix of every key in it.
fn combined_family(file: &str, depth: usize) -> String {
    file.split(FEATURE_JOIN)
        .take(depth)
        .collect::<Vec<_>>()
        .join(&FEATURE_JOIN.to_string())
}

/// The number of a key's first features that name its combination table, by the key's first
/// feature: the fewest that keep every table of that family within [`COMBINED_TABLE_TARGET`]. A
/// family whose keys have no more features left keeps its table as it is. The runtime reads these
/// numbers, so a page loads the table of the family of the build it asks for alone.
fn combined_depths(
    target: Target,
    files: &BTreeMap<&str, (u32, Vec<&DeviceModule>)>,
) -> BTreeMap<String, usize> {
    let mut roots: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for &file in files.keys() {
        roots
            .entry(combined_family(file, 1))
            .or_default()
            .push(file);
    }
    let mut depths = BTreeMap::new();
    for (root, keys) in roots {
        let longest = keys
            .iter()
            .map(|file| file.split(FEATURE_JOIN).count())
            .max()
            .unwrap_or(1);
        let mut depth = 1;
        while depth < longest {
            let mut groups: BTreeMap<String, BTreeMap<&str, (u32, Vec<&DeviceModule>)>> =
                BTreeMap::new();
            for &file in &keys {
                groups
                    .entry(combined_family(file, depth))
                    .or_default()
                    .insert(file, files[file].clone());
            }
            if groups
                .values()
                .all(|group| combined_module(target, group).len() <= COMBINED_TABLE_TARGET)
            {
                break;
            }
            depth += 1;
        }
        depths.insert(root, depth);
    }
    depths
}

/// `files`, grouped by the family that `depths` names for each key's first feature.
fn combined_families<'a>(
    depths: &BTreeMap<String, usize>,
    files: &BTreeMap<&'a str, (u32, Vec<&'a DeviceModule>)>,
) -> BTreeMap<String, BTreeMap<&'a str, (u32, Vec<&'a DeviceModule>)>> {
    let mut families: BTreeMap<String, BTreeMap<&str, (u32, Vec<&DeviceModule>)>> = BTreeMap::new();
    for (&file, (bits, modules)) in files {
        let root = combined_family(file, 1);
        let depth = depths.get(&root).copied().unwrap_or(1);
        families
            .entry(combined_family(file, depth))
            .or_default()
            .insert(file, (*bits, modules.clone()));
    }
    families
}

/// The name of the module, without its extension, that holds the loader table of one family of a
/// target's device modules of builds that need several features, such as
/// `shaders-wgsl-combos-bump` or `shaders-wgsl-combos-area-lights-and-bump`.
fn combined_module_name(target: Target, half: bool, family: &str) -> String {
    let suffix = if half { "-half" } else { "" };
    format!(
        "{MAIN_MODULE}-{}-combos-{}{suffix}",
        target.name(),
        family.replace('_', "-").replace(FEATURE_JOIN, "-and-")
    )
}

/// A target's device modules of features that load on first use, by `firstUseFile`'s key, with the
/// bits that each key's modules vary in: those of single features, or of sets of several features
/// when `combined` is true.
fn first_use_files<'a>(
    devices: &'a BTreeMap<DeviceModule, Builds<'_>>,
    target: Target,
    combined: bool,
) -> BTreeMap<&'a str, (u32, Vec<&'a DeviceModule>)> {
    let mut files: BTreeMap<&str, (u32, Vec<&DeviceModule>)> = BTreeMap::new();
    for module in devices.keys().filter(|module| module.target == target) {
        if let Some(file) = &module.file
            && file.contains(FEATURE_JOIN) == combined
        {
            let (bits, modules) = files.entry(file).or_default();
            *bits |= module.bits;
            modules.push(module);
        }
    }
    files
}

/// Writes a loader table of device modules of features that load on first use, by their key.
fn files_table(
    ts: &mut Writer,
    declaration: &str,
    files: &BTreeMap<&str, (u32, Vec<&DeviceModule>)>,
) {
    if files.is_empty() {
        ts.line(&format!("{declaration} {{}};"));
        return;
    }
    ts.open(&format!("{declaration} {{"));
    for (file, (bits, modules)) in files {
        ts.open(&format!("{}: {{", property(file)));
        ts.line(&format!("bits: {bits},"));
        ts.open("modules: {");
        for module in modules {
            ts.line(&loader_entry(module));
        }
        ts.close("},");
        ts.close("},");
    }
    ts.close("};");
}

/// The module of a target's loader table of the device modules of builds that need several
/// features that load on first use. The main module loads it the first time a pipeline or a
/// preload asks for one of those builds, so the table's addresses add nothing to the start.
fn combined_module(target: Target, files: &BTreeMap<&str, (u32, Vec<&DeviceModule>)>) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.out.push_str(COMBINED_HEADER);
    let name = target.name().to_ascii_uppercase();
    ts.line("");
    ts.line(&format!(
        "/** The {name} device modules of builds that need several features, by `firstUseFile`'s key. */"
    ));
    files_table(
        &mut ts,
        "export const FILES: Readonly<Record<string, FirstUseFiles>> =",
        files,
    );
    ts.out
}

/// The module that names the permutation words that a narrowed build made, or null when it made
/// every word. It holds no shader text, so the shader lookup that reads it adds no data to a page's
/// bundle.
fn permutations_module(output: &Output) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.line("");
    ts.line("/**");
    ts.line(" * The permutation words that this build made, or null when it made every word. A pipeline");
    ts.line(
        " * that asks for a word that is missing here draws a shader that this set lacks, so the",
    );
    ts.line(" * engine names the word and the list that must carry it.");
    ts.line(" */");
    if output.listed.is_empty() {
        ts.line("export const LISTED_PERMUTATIONS: readonly number[] | null = null;");
    } else {
        let words: Vec<String> = output.listed.iter().map(|word| word.to_string()).collect();
        ts.line(&format!(
            "export const LISTED_PERMUTATIONS: readonly number[] | null = [{}];",
            words.join(", ")
        ));
    }
    ts.out
}

/// The module that names the features that load on first use, which a page may preload: no shader
/// text, so the page that checks a preload list downloads none.
fn features_module(output: &Output) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.line("");
    ts.line("/** The features whose shader builds load on first use, as the shader manifest names them. */");
    let features = &output.first_use;
    let names: std::collections::BTreeSet<String> = (features.shaders.values())
        .chain(features.bits.values())
        .map(|name| quote(name))
        .collect();
    let names: Vec<String> = names.into_iter().collect();
    ts.line(&format!(
        "export const SHADER_FEATURES = [{}] as const;",
        names.join(", ")
    ));
    ts.line("");
    ts.line("/**");
    ts.line(" * A feature whose shader builds load on first use, which `createEngine`'s `preload` lists.");
    ts.line(" *");
    ts.line(" * @category api/engine");
    ts.line(" */");
    ts.line("export type ShaderFeature = (typeof SHADER_FEATURES)[number];");
    ts.out
}

/// Each module of the shaders that load on first use: its file name without its extension, the
/// shader and the target. The name is the main module's, the shader's name with hyphens, and the
/// target, such as `shaders-environment-wgsl`.
fn first_use_modules(output: &Output) -> Vec<(String, &str, Target)> {
    let mut modules = Vec::new();
    for shader in &output.first_use_shaders {
        let Some(variants) = output.shaders.get(shader) else {
            continue;
        };
        for target in [Target::Wgsl, Target::Glsl] {
            if variants.values().any(|variant| has_target(variant, target)) {
                let stem = format!(
                    "{MAIN_MODULE}-{}-{}",
                    shader.replace('_', "-"),
                    target.name()
                );
                modules.push((stem, shader.as_str(), target));
            }
        }
    }
    modules
}

/// True when a build has output for `target`.
fn has_target(variant: &VariantOutput, target: Target) -> bool {
    match target {
        Target::Wgsl => variant.wgsl.is_some(),
        Target::Glsl => variant.glsl.is_some(),
    }
}

/// A module of a shader that loads on first use: the builds of one target, as the shader's own
/// export, and `SHADERS`, which gathers it by name.
fn first_use_module(output: &Output, shader: &str, target: Target) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.out.push_str(FIRST_USE_HEADER);
    let pipelines = output.pipelines.get(shader).map_or(&[][..], Vec::as_slice);
    let variants: Vec<(&String, &VariantOutput)> = output.shaders[shader]
        .iter()
        .filter(|(_, variant)| has_target(variant, target))
        .collect();
    ts.line("");
    ts.line(&format!(
        "/** The {} builds of the `{shader}` shader, which loads on its first use. */",
        target.name().to_ascii_uppercase()
    ));
    ts.open(&format!("export const {}: {{", export_name(shader)));
    for (name, _) in &variants {
        ts.variant_type(name, pipelines);
    }
    ts.depth -= 1;
    ts.open("} = {");
    for (name, variant) in &variants {
        ts.open(&format!("{name}: {{"));
        ts.variant(variant);
        ts.close("},");
    }
    ts.close("};");
    ts.line("");
    ts.line("/** The shader above, by name. */");
    ts.line(&format!(
        "export const SHADERS = {{ {shader}: {} }} as const;",
        export_name(shader)
    ));
    ts.out
}

/// The main module: the types, one export per shader that does not load by device, `SHADERS`,
/// which gathers them by name, and the loaders of the device modules, those of the features that
/// load on first use among them.
fn main_module(output: &Output, devices: &BTreeMap<DeviceModule, Builds<'_>>) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.out.push_str(TYPES);
    ts.line("");
    ts.line("/**");
    ts.line(
        " * The shaders that load by device, each as its variants by name. A device module holds the",
    );
    ts.line(
        " * builds of one target with one value of the permutation bits that a device fixes, and a",
    );
    ts.line(" * shader without builds there has no variants in it.");
    ts.line(" */");
    ts.open("export interface DeviceShaders {");
    for shader in &output.by_device {
        let pipelines = output.pipelines.get(shader).map_or(&[][..], Vec::as_slice);
        ts.line(&format!(
            "readonly {shader}: ShaderVariants<{}>;",
            pipeline_union(pipelines)
        ));
    }
    ts.close("}");
    ts.line("");
    ts.line(
        "/** The builds of a feature that loads on first use, in one of the feature's device modules. */",
    );
    ts.line("export type FirstUseShaders = Partial<DeviceShaders>;");
    ts.line("");
    ts.line("/**");
    ts.line(
        " * The uniform through which each GLSL vertex shader maps WebGPU's clip depth: the shader",
    );
    ts.line(" * writes `z * mapping.x + w * mapping.y` as its clip depth, where `mapping` is this vec2.");
    ts.line(" * The WebGL2 backend sets it once per program, for the depth mode it draws with.");
    ts.line(" */");
    ts.line(&format!(
        "export const DEPTH_MAPPING_UNIFORM = {};",
        quote(DEPTH_MAPPING_UNIFORM)
    ));
    let own: Vec<(&String, &BTreeMap<String, VariantOutput>)> = output
        .shaders
        .iter()
        .filter(|(shader, _)| {
            !output.by_device.contains(*shader) && !output.first_use_shaders.contains(*shader)
        })
        .collect();
    // The main module shares no paragraphs at all, so it never names a target's table: it is the
    // start's own file, and the table must not join a page's first download.
    ts.shared_sources(
        own.iter().flat_map(|(_, variants)| variants.values()),
        false,
        &[],
    );
    for &(shader, variants) in &own {
        let pipelines = output.pipelines.get(shader).map_or(&[][..], Vec::as_slice);
        ts.line("");
        ts.line(&format!(
            "/** The variants of the `{shader}` shader, by variant name. */"
        ));
        ts.open(&format!("export const {}: {{", export_name(shader)));
        for variant in variants.keys() {
            ts.variant_type(variant, pipelines);
        }
        ts.depth -= 1;
        ts.open("} = {");
        for (name, variant) in variants {
            ts.open(&format!("{name}: {{"));
            ts.variant(variant);
            ts.close("},");
        }
        ts.close("};");
    }
    ts.line("");
    ts.line("/** The variants of the shaders above, by shader name and variant name. */");
    if own.is_empty() {
        ts.line("export const SHADERS = {} as const;");
    } else {
        ts.open("export const SHADERS = {");
        for &(shader, _) in &own {
            ts.line(&format!("{shader}: {},", export_name(shader)));
        }
        ts.close("} as const;");
    }
    ts.out.push_str(LOADER_TYPE);
    ts.line("");
    ts.line(
        "/** Loaders of the modules of the shaders that load on first use, for `everyShader`. */",
    );
    let first_use = first_use_modules(output);
    if first_use.is_empty() {
        ts.line("const FIRST_USE: (() => Promise<{ SHADERS: object }>)[] = [];");
    } else {
        ts.open("const FIRST_USE: (() => Promise<{ SHADERS: object }>)[] = [");
        for (stem, _, _) in &first_use {
            ts.line(&format!("() => import('./{stem}'),"));
        }
        ts.close("];");
    }
    for target in [Target::Wgsl, Target::Glsl] {
        let name = target.name().to_ascii_uppercase();
        let modules: Vec<&DeviceModule> = devices
            .keys()
            .filter(|module| module.target == target && module.file.is_none())
            .collect();
        ts.line("");
        ts.line(&format!(
            "/** The {name} device modules' loaders, by the permutation bits that a device fixes. */"
        ));
        if modules.is_empty() {
            ts.line(&format!("const {name}_MODULES: DeviceModules = {{}};"));
            continue;
        }
        ts.open(&format!("const {name}_MODULES: DeviceModules = {{"));
        for module in modules {
            ts.line(&loader_entry(module));
        }
        ts.close("};");
    }
    first_use_tables(&mut ts, &output.first_use, devices);
    ts.out.push_str(LOADERS);
    ts.out
}

/// A target's name in the main module's function names, such as `Wgsl`.
fn target_word(target: Target) -> &'static str {
    match target {
        Target::Wgsl => "Wgsl",
        Target::Glsl => "Glsl",
    }
}

/// A loader table's entry for a device module: its bits, and the import of its file by address.
fn loader_entry(module: &DeviceModule) -> String {
    format!(
        "{}: () => importShaders(new URL('./{}.{DEVICE_MODULE_EXTENSION}', import.meta.url)),",
        module.bits,
        module.stem()
    )
}

/// The tables of the features that load on first use: each target's modules of each feature, the
/// keys of its modules of builds that need several features and the loader of their table, the
/// feature of each shader whose builds all need one, and the feature of each permutation bit.
fn first_use_tables(
    ts: &mut Writer,
    first_use: &FirstUseFeatures,
    devices: &BTreeMap<DeviceModule, Builds<'_>>,
) {
    ts.line("");
    ts.line("/** The half-precision bit of the device's fixed bits, whose combined builds sit in a table of their own. */");
    ts.line(&format!(
        "const HALF = {};",
        permutation::bit("HALF").unwrap_or(0)
    ));
    for target in [Target::Wgsl, Target::Glsl] {
        let name = target.name().to_ascii_uppercase();
        ts.line("");
        ts.line(&format!(
            "/** The {name} device modules of each feature that loads on first use, by its name. */"
        ));
        files_table(
            ts,
            &format!("const {name}_FIRST_USE: Readonly<Record<string, FirstUseFiles>> ="),
            &first_use_files(devices, target, false),
        );
        let combined = first_use_files(devices, target, true);
        let keys: Vec<String> = combined.keys().map(|key| quote(key)).collect();
        ts.line("");
        ts.line(&format!(
            "/** The keys of the {name} device modules of builds that need several features. */"
        ));
        ts.line(&format!(
            "const {name}_COMBINED: readonly string[] = [{}];",
            keys.join(", ")
        ));
        ts.line("");
        ts.line(&format!(
            "/** The loader of the table of each family of the {name} builds that need several features. */"
        ));
        if combined.is_empty() {
            ts.line(&format!(
                "const load{}Combined = (_bits: number, _file: string): Promise<Readonly<Record<string, FirstUseFiles>>> => Promise.resolve({{}});",
                target_word(target)
            ));
        } else {
            let mask = permutation::bit("HALF").unwrap_or(0);
            let depths = combined_depths(target, &combined);
            let halves = combined_families(&depths, &split_by_half(&combined, true));
            let families = combined_families(&depths, &split_by_half(&combined, false));
            ts.open(&format!(
                "const {name}_COMBINED_TABLES: Readonly<Record<string, (bits: number) => Promise<Readonly<Record<string, FirstUseFiles>>>>> = {{"
            ));
            for family in families.keys() {
                let base = combined_module_name(target, false, family);
                let loader = if !halves.contains_key(family) {
                    format!("(bits: number) => import('./{base}').then((module) => module.FILES)")
                } else {
                    let half = combined_module_name(target, true, family);
                    format!(
                        "(bits: number) => (bits & {mask} ? import('./{half}') : import('./{base}')).then((module) => module.FILES)"
                    )
                };
                ts.line(&format!("{}: {loader},", quote(family)));
            }
            ts.close("};");
            ts.line("");
            ts.line(&format!(
                "/** How many of a key's first features name its {name} combination table. */"
            ));
            ts.open(&format!(
                "const {name}_COMBINED_DEPTH: Readonly<Record<string, number>> = {{"
            ));
            for (root, depth) in &depths {
                ts.line(&format!("{}: {depth},", quote(root)));
            }
            ts.close("};");
            ts.line(&format!(
                "function {}CombinedFamily(file: string): string {{",
                target_word(target)
            ));
            ts.line("\tconst root = file.split(FEATURE_JOIN)[0] ?? file;");
            ts.line(&format!(
                "\tconst depth = {name}_COMBINED_DEPTH[root] ?? 1;"
            ));
            ts.line("\treturn file.split(FEATURE_JOIN).slice(0, depth).join(FEATURE_JOIN);");
            ts.line("}");
            ts.line(&format!(
                "const load{}Combined = (bits: number, file: string): Promise<Readonly<Record<string, FirstUseFiles>>> => {{",
                target_word(target)
            ));
            ts.line(&format!(
                "\tconst load = {name}_COMBINED_TABLES[{}CombinedFamily(file)];",
                target_word(target)
            ));
            ts.line("\tif (!load) return Promise.reject(new Error(`no shader module holds the ${{file}} builds that need several features`));");
            ts.line("\treturn load(bits);");
            ts.line("};");
        }
    }
    ts.line("");
    ts.line(
        "/** The feature that loads on first use with every build of a shader, by shader name. */",
    );
    if first_use.shaders.is_empty() {
        ts.line("const SHADER_FEATURES: Readonly<Record<string, string>> = {};");
    } else {
        ts.open("const SHADER_FEATURES: Readonly<Record<string, string>> = {");
        for (shader, feature) in &first_use.shaders {
            ts.line(&format!("{shader}: {},", quote(feature)));
        }
        ts.close("};");
    }
    ts.line("");
    ts.line("/** Each permutation bit whose builds load on first use, with its feature, in bit order. */");
    let bits: Vec<String> = first_use
        .bits
        .iter()
        .map(|(bit, feature)| format!("[{bit}, {}]", quote(feature)))
        .collect();
    ts.line(&format!(
        "const FEATURE_BITS: readonly (readonly [number, string])[] = [{}];",
        bits.join(", ")
    ));
    ts.line("");
    ts.line(
        "/** The character that joins the names of the features in a key of device modules. */",
    );
    ts.line(&format!(
        "export const FEATURE_JOIN = {};",
        quote(&FEATURE_JOIN.to_string())
    ));
    ts.line("");
    ts.line(
        "/** The bits that name one feature across every template: a shared value needs a template's own mask. */",
    );
    ts.line(&format!(
        "const FEATURE_UNSHARED: number = {};",
        !crate::output::shared_bits()
    ));
    ts.line("");
    ts.line(
        "/** By shader name, the shared bits of `FEATURE_BITS` whose names the shader lists: a value that names another feature in another template. */",
    );
    if first_use.listed.is_empty() {
        ts.line("const FEATURE_MASKS: Readonly<Record<string, number>> = {};");
    } else {
        ts.open("const FEATURE_MASKS: Readonly<Record<string, number>> = {");
        for (shader, mask) in &first_use.listed {
            ts.line(&format!("{shader}: {mask},"));
        }
        ts.close("};");
    }
}

/// A device module: `SHADERS`, the builds of every shader that loads by device for the module's
/// target and bits, of the module's feature that loads on first use or of the start. It is plain
/// JavaScript that imports nothing; the main module's types describe it.
fn device_module(
    module: &DeviceModule,
    builds: &Builds<'_>,
    tables: &[SharedParagraphs],
) -> String {
    let mut ts = Writer::default();
    ts.out.push_str(HEADER);
    ts.shared_sources(
        builds
            .values()
            .flat_map(|variants| variants.values().copied()),
        true,
        tables,
    );
    ts.line("");
    let bits: Vec<&str> = module.bit_names().collect();
    let with = if bits.is_empty() {
        "without the bits that a device fixes".to_owned()
    } else {
        format!("with {}", bits.join(" and "))
    };
    let target = module.target.name().to_ascii_uppercase();
    let features: Vec<String> = module
        .file
        .iter()
        .flat_map(|file| file.split(FEATURE_JOIN))
        .map(|feature| format!("`{feature}`"))
        .collect();
    match features.as_slice() {
        [] => ts.line(&format!(
            "/** The {target} builds of the shaders that load by device, {with}. */"
        )),
        [feature] => ts.line(&format!(
            "/** The {target} builds of {feature}, which load on its first use, {with}. */"
        )),
        [first @ .., last] => ts.line(&format!(
            "/** The {target} builds that need {} and {last}, which load once a page uses each of them, {with}. */",
            first.join(", ")
        )),
    }
    ts.open("export const SHADERS = {");
    for (shader, variants) in builds {
        if variants.is_empty() {
            ts.line(&format!("{shader}: {{}},"));
            continue;
        }
        ts.open(&format!("{shader}: {{"));
        for (name, variant) in variants {
            ts.open(&format!("{name}: {{"));
            ts.variant(variant);
            ts.close("},");
        }
        ts.close("},");
    }
    ts.close("};");
    ts.out
}

/// The union of a shader's pipeline names as a TypeScript type: `never` for none.
fn pipeline_union(pipelines: &[String]) -> String {
    if pipelines.is_empty() {
        return "never".to_owned();
    }
    let names: Vec<String> = pipelines.iter().map(|p| quote(p)).collect();
    names.join(" | ")
}

/// The name of a shader's own export: its name in capitals, then `_SHADER`.
fn export_name(shader: &str) -> String {
    format!("{}_SHADER", shader.to_ascii_uppercase())
}

/// The text between two paragraphs of a source: the blank line that the GLSL and WGSL writers put
/// between declarations.
const PARAGRAPH_BREAK: &str = "\n\n";

#[derive(Default)]
struct Writer {
    out: String,
    depth: usize,
    /// The constant that holds each source that several builds of the module share.
    shared: HashMap<String, String>,
    /// The constant that holds each paragraph that several sources of the module share.
    paragraphs: HashMap<String, String>,
}

/// Counts each distinct item of `items`, in the order of its first use.
fn first_use_counts<'a>(items: impl Iterator<Item = &'a str>) -> Vec<(&'a str, usize)> {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for item in items {
        let at = *index.entry(item).or_insert_with(|| {
            counts.push((item, 0));
            counts.len() - 1
        });
        counts[at].1 += 1;
    }
    counts
}

/// Writes `text` as the inside of a template literal.
fn escape_into(out: &mut String, text: &str) {
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.push_str("\\\\"),
            '`' => out.push_str("\\`"),
            '$' if chars.peek() == Some(&'{') => out.push_str("\\$"),
            _ => out.push(c),
        }
    }
}

/// Every stage source of a build: its WGSL module, and each GLSL program's two shaders.
fn sources(variant: &VariantOutput) -> impl Iterator<Item = &str> {
    let wgsl = variant.wgsl.iter().map(|wgsl| &*wgsl.source);
    let glsl = variant.glsl.iter().flat_map(|programs| {
        programs
            .values()
            .flat_map(|program| [&*program.vertex.source, &*program.fragment.source])
    });
    wgsl.chain(glsl)
}

impl Writer {
    fn line(&mut self, text: &str) {
        for _ in 0..self.depth {
            self.out.push('\t');
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn open(&mut self, text: &str) {
        self.line(text);
        self.depth += 1;
    }

    fn close(&mut self, text: &str) {
        self.depth -= 1;
        self.line(text);
    }

    /// The width the formatter measures for `text` on a line at the current depth.
    fn width(&self, text: &str) -> usize {
        self.depth * TAB_WIDTH + text.chars().count()
    }

    /// Writes each paragraph that more than one source of `builds` holds, when `share_paragraphs`
    /// is true, and then each source that more than one of `builds` uses, as a constant, in the
    /// order the builds first use them. A source's literal then names the constant of each shared
    /// paragraph, and `template` names that of a shared source in its place.
    ///
    /// `table` is the shared table of the module's kind, when a feature's module has one. A
    /// paragraph the table holds is written there rather than here, and the module imports the
    /// table and names the constant instead, so a paragraph that many modules share is stored once
    /// for all of them.
    fn shared_sources<'a>(
        &mut self,
        builds: impl Iterator<Item = &'a VariantOutput>,
        share_paragraphs: bool,
        tables: &[SharedParagraphs],
    ) {
        let uses = first_use_counts(builds.flat_map(sources));
        // The module writes each distinct source once, so each counts once.
        let held = first_use_counts(
            uses.iter()
                .filter(|_| share_paragraphs)
                .flat_map(|&(source, _)| source.split(PARAGRAPH_BREAK)),
        );
        let mut paragraphs = Vec::new();
        let mut imported: Vec<(&str, &str, String)> = Vec::new();
        for (paragraph, count) in held {
            let shared = tables.iter().find_map(|table| {
                table
                    .names
                    .get(paragraph)
                    .map(|name| (table.stem.as_str(), name.clone()))
            });
            match shared {
                // A paragraph a table holds is named there; the module imports it, however many of
                // its sources hold it and whether or not they share it here. The loop holds each
                // paragraph once, and a table names each of them once, so the list needs no repeat
                // check.
                Some((stem, name)) => imported.push((paragraph, stem, name)),
                None => {
                    let name = format!("PART_{}", paragraphs.len());
                    // A paragraph no longer than its name and the `${}` around it would not shrink.
                    if count > 1 && paragraph.len() > name.len() + 3 {
                        paragraphs.push((paragraph, name));
                    }
                }
            }
        }
        if !imported.is_empty() {
            // One import for each table that the module names, in the tables' order.
            let mut by_stem: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
            for (_, stem, name) in &imported {
                by_stem.entry(stem).or_default().push(name);
            }
            self.line("");
            for (stem, names) in by_stem {
                self.line(&format!(
                    "import {{ {} }} from './{stem}.{DEVICE_MODULE_EXTENSION}';",
                    names.join(", ")
                ));
            }
        }
        if !paragraphs.is_empty() {
            self.line("");
            self.line("// Paragraphs that several sources below share, each written once.");
            for (paragraph, name) in &paragraphs {
                self.literal(&format!("const {name} = "), paragraph, ";");
            }
        }
        self.paragraphs = paragraphs
            .into_iter()
            .chain(
                imported
                    .into_iter()
                    .map(|(paragraph, _, name)| (paragraph, name)),
            )
            .map(|(paragraph, name)| (paragraph.to_owned(), name))
            .collect();
        let mut shared = uses.into_iter().filter(|&(_, count)| count > 1).peekable();
        if shared.peek().is_none() {
            return;
        }
        self.line("");
        self.line("// Sources that several builds below share, each written once.");
        for (n, (source, _)) in shared.enumerate() {
            let name = format!("SOURCE_{n}");
            self.literal(&format!("const {name} = "), source, ";");
            self.shared.insert(source.to_owned(), name);
        }
    }

    /// A shader source under `key`: the name of its shared constant, or a template literal.
    fn template(&mut self, key: &str, source: &str) {
        match self.shared.get(source) {
            Some(name) => {
                let line = format!("{key}: {name},");
                self.line(&line);
            }
            None => self.literal(&format!("{key}: "), source, ","),
        }
    }

    /// A shader source as a template literal between `before` and `after`, which names the
    /// constant of each shared paragraph in its place. It starts on the line of `before` and ends
    /// with the closing backtick at the start of a line.
    fn literal(&mut self, before: &str, source: &str, after: &str) {
        for _ in 0..self.depth {
            self.out.push('\t');
        }
        self.out.push_str(before);
        self.out.push('`');
        for (n, paragraph) in source.split(PARAGRAPH_BREAK).enumerate() {
            if n > 0 {
                self.out.push_str(PARAGRAPH_BREAK);
            }
            match self.paragraphs.get(paragraph) {
                Some(name) => {
                    self.out.push_str("${");
                    self.out.push_str(name);
                    self.out.push('}');
                }
                None => escape_into(&mut self.out, paragraph),
            }
        }
        self.out.push('`');
        self.out.push_str(after);
        self.out.push('\n');
    }

    /// The type of one variant, broken over lines the way the formatter breaks a long one.
    fn variant_type(&mut self, variant: &str, pipelines: &[String]) {
        let union = pipeline_union(pipelines);
        let one_line = format!("readonly {variant}: ShaderVariant<{union}>;");
        if self.width(&one_line) <= LINE_WIDTH {
            self.line(&one_line);
            return;
        }
        self.open(&format!("readonly {variant}: ShaderVariant<"));
        if pipelines.len() < 2 || self.width(&union) <= LINE_WIDTH {
            self.line(&union);
        } else {
            for name in pipelines {
                self.line(&format!("| {}", quote(name)));
            }
        }
        self.close(">;");
    }

    fn variant(&mut self, variant: &VariantOutput) {
        self.line(&format!("permutation: {},", variant.permutation));
        match &variant.wgsl {
            None => self.line("wgsl: null,"),
            Some(wgsl) => {
                self.open("wgsl: {");
                self.template("source", &wgsl.source);
                if wgsl.pipelines.is_empty() {
                    self.line("pipelines: {},");
                } else {
                    self.open("pipelines: {");
                    for (name, pipeline) in &wgsl.pipelines {
                        self.open(&format!("{name}: {{"));
                        self.line(&format!("vertex: {},", quote(&pipeline.vertex)));
                        self.line(&format!("fragment: {},", quote(&pipeline.fragment)));
                        self.close("},");
                    }
                    self.close("},");
                }
                self.close("},");
            }
        }
        match &variant.glsl {
            None => self.line("glsl: null,"),
            Some(programs) if programs.is_empty() => self.line("glsl: {},"),
            Some(programs) => {
                self.open("glsl: {");
                for (name, program) in programs {
                    self.open(&format!("{name}: {{"));
                    self.stage("vertex", &program.vertex);
                    self.stage("fragment", &program.fragment);
                    self.close("},");
                }
                self.close("},");
            }
        }
    }

    fn stage(&mut self, key: &str, stage: &GlslStage) {
        self.open(&format!("{key}: {{"));
        self.template("source", &stage.source);
        if stage.uniform_blocks.is_empty() {
            self.line("uniformBlocks: [],");
        } else {
            self.open("uniformBlocks: [");
            for block in &stage.uniform_blocks {
                self.open("{");
                self.line(&format!("name: {},", quote(&block.name)));
                self.binding(block.binding);
                self.close("},");
            }
            self.close("],");
        }
        if stage.textures.is_empty() {
            self.line("textures: [],");
        } else {
            self.open("textures: [");
            for texture in &stage.textures {
                self.open("{");
                self.line(&format!("name: {},", quote(&texture.name)));
                self.binding(texture.binding);
                match texture.sampler {
                    None => self.line("sampler: null,"),
                    Some(sampler) => {
                        self.open("sampler: {");
                        self.binding(sampler);
                        self.close("},");
                    }
                }
                self.close("},");
            }
            self.close("],");
        }
        self.close("},");
    }

    fn binding(&mut self, binding: crate::Binding) {
        self.line(&format!("group: {},", binding.group));
        self.line(&format!("binding: {},", binding.binding));
    }
}

/// A single-quoted string literal.
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// An object literal's key, quoted only when it is not a name, as the formatter writes it.
fn property(key: &str) -> String {
    let name = key.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if name { key.to_owned() } else { quote(key) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WgslOutput;

    fn build(target: Target, permutation: u32) -> VariantOutput {
        let wgsl = WgslOutput {
            source: "".into(),
            pipelines: BTreeMap::new(),
        };
        VariantOutput {
            permutation,
            wgsl: (target == Target::Wgsl).then_some(wgsl),
            glsl: (target == Target::Glsl).then(BTreeMap::new),
        }
    }

    /// Two shaders that load by device, as the engine's would with tone mapping in the shader: a
    /// template that varies in both of the device's bits on WebGL2 and in tone mapping on WebGPU,
    /// and a WebGPU compute shader without bits.
    fn output() -> Output {
        use permutation::{DRAW_INDEX, TONE_MAP};
        let mut output = Output::default();
        let mut lit = BTreeMap::new();
        lit.insert("webgpu".to_owned(), build(Target::Wgsl, 0));
        lit.insert("webgpu_tone_map".to_owned(), build(Target::Wgsl, TONE_MAP));
        for (name, bits) in [
            ("webgl2", 0),
            ("webgl2_draw_index", DRAW_INDEX),
            ("webgl2_tone_map", TONE_MAP),
            ("webgl2_draw_index_tone_map", DRAW_INDEX | TONE_MAP),
        ] {
            lit.insert(name.to_owned(), build(Target::Glsl, bits));
        }
        let cull = BTreeMap::from([("webgpu".to_owned(), build(Target::Wgsl, 0))]);
        output.shaders.insert("lit".to_owned(), lit);
        output.shaders.insert("cull".to_owned(), cull);
        output.by_device = ["cull".to_owned(), "lit".to_owned()].into();
        output
    }

    fn names<'a>(builds: &Builds<'a>, shader: &str) -> Vec<&'a str> {
        builds[shader].keys().copied().collect()
    }

    #[test]
    fn each_target_has_a_module_for_each_combination_of_the_bits_its_shaders_vary_in() {
        let output = output();
        let modules = device_builds(&output);
        let stems: Vec<String> = modules.keys().map(|module| module.stem()).collect();
        assert_eq!(
            stems,
            [
                "shaders-wgsl",
                "shaders-wgsl-tone-map",
                "shaders-glsl",
                "shaders-glsl-draw-index",
                "shaders-glsl-tone-map",
                "shaders-glsl-draw-index-tone-map",
            ]
        );
        let module = |target, bits| {
            &modules[&DeviceModule {
                file: None,
                target,
                bits,
            }]
        };
        let tone_map = permutation::TONE_MAP;
        let both = permutation::DRAW_INDEX | tone_map;
        assert_eq!(names(module(Target::Wgsl, 0), "lit"), ["webgpu"]);
        assert_eq!(
            names(module(Target::Wgsl, tone_map), "lit"),
            ["webgpu_tone_map"]
        );
        assert_eq!(
            names(module(Target::Glsl, both), "lit"),
            ["webgl2_draw_index_tone_map"]
        );
        for bits in [0, tone_map] {
            assert_eq!(names(module(Target::Wgsl, bits), "cull"), ["webgpu"]);
        }
        assert!(names(module(Target::Glsl, both), "cull").is_empty());
    }

    #[test]
    fn the_permutations_module_names_the_words_and_keeps_the_main_module_free_of_them() {
        let mut narrowed = output();
        narrowed.listed = BTreeSet::from([0, 4]);
        let rendered = modules(&narrowed);
        assert!(
            rendered["shader-permutations.ts"]
                .contains("export const LISTED_PERMUTATIONS: readonly number[] | null = [0, 4];")
        );
        assert!(!rendered["shaders.ts"].contains("LISTED_PERMUTATIONS"));
        // A build without a list keeps the same module shape, so the engine import never breaks.
        assert!(
            modules(&output())["shader-permutations.ts"]
                .contains("export const LISTED_PERMUTATIONS: readonly number[] | null = null;")
        );
    }

    #[test]
    fn the_main_module_loads_each_device_module_and_holds_none_of_their_shaders() {
        let modules = modules(&output());
        assert_eq!(modules.len(), 9);
        let main = &modules["shaders.ts"];
        assert!(main.contains("\treadonly cull: ShaderVariants<never>;\n"));
        assert!(main.contains("\t3: () => importShaders(new URL('./shaders-glsl-draw-index-tone-map.js', import.meta.url)),\n"));
        let wgsl = "const WGSL_MODULES: DeviceModules = {\n\t0: () => importShaders(new URL('./shaders-wgsl.js', import.meta.url)),\n\t2: () => importShaders(new URL('./shaders-wgsl-tone-map.js', import.meta.url)),\n};";
        assert!(main.contains(wgsl), "{main}");
        assert!(main.contains("export const SHADERS = {} as const;"));
        assert!(!main.contains("webgpu_tone_map"));
        let glsl = &modules["shaders-glsl-draw-index-tone-map.js"];
        assert!(glsl.contains("with DRAW_INDEX and TONE_MAP. */"));
        assert!(glsl.contains("\tcull: {},\n\tlit: {\n\t\twebgl2_draw_index_tone_map: {\n"));
    }

    /// The shaders of [`output`], with a sprite shader whose builds all load on first use, and the
    /// lit template's BLOOM builds, which load with bloom.
    fn output_with_features() -> Output {
        use permutation::{BLOOM, DRAW_INDEX, TONE_MAP};
        let mut output = output();
        let lit = output.shaders.get_mut("lit").unwrap();
        lit.insert("webgpu_bloom".to_owned(), build(Target::Wgsl, BLOOM));
        lit.insert(
            "webgl2_draw_index_bloom".to_owned(),
            build(Target::Glsl, DRAW_INDEX | BLOOM),
        );
        let sprite = BTreeMap::from([
            ("webgpu".to_owned(), build(Target::Wgsl, 0)),
            ("webgpu_tone_map".to_owned(), build(Target::Wgsl, TONE_MAP)),
            ("webgl2".to_owned(), build(Target::Glsl, 0)),
        ]);
        output.shaders.insert("sprite".to_owned(), sprite);
        output.by_device.insert("sprite".to_owned());
        output
            .first_use
            .shaders
            .insert("sprite".to_owned(), "sprites".to_owned());
        output.first_use.bits.insert(BLOOM, "bloom".to_owned());
        output.first_use.listed.insert("lit".to_owned(), BLOOM);
        output
    }

    #[test]
    fn each_feature_that_loads_on_first_use_has_modules_of_its_own_by_the_bits_its_builds_vary_in()
    {
        let output = output_with_features();
        let modules = device_builds(&output);
        let stems: Vec<String> = modules.keys().map(|module| module.stem()).collect();
        assert_eq!(
            stems,
            [
                "shaders-wgsl",
                "shaders-wgsl-tone-map",
                "shaders-glsl",
                "shaders-glsl-draw-index",
                "shaders-glsl-tone-map",
                "shaders-glsl-draw-index-tone-map",
                "shaders-bloom-wgsl",
                "shaders-bloom-glsl",
                "shaders-bloom-glsl-draw-index",
                "shaders-sprites-wgsl",
                "shaders-sprites-wgsl-tone-map",
                "shaders-sprites-glsl",
            ]
        );
        let module = |file: Option<&str>, target, bits| {
            &modules[&DeviceModule {
                file: file.map(str::to_owned),
                target,
                bits,
            }]
        };
        let start = module(None, Target::Wgsl, 0);
        assert_eq!(names(start, "lit"), ["webgpu"], "the start holds no bloom");
        assert!(names(start, "sprite").is_empty(), "nor any sprite");
        let bloom = module(Some("bloom"), Target::Glsl, permutation::DRAW_INDEX);
        assert_eq!(names(bloom, "lit"), ["webgl2_draw_index_bloom"]);
        assert!(
            !bloom.contains_key("sprite"),
            "a feature lists its own shaders"
        );
        let sprites = module(Some("sprites"), Target::Wgsl, permutation::TONE_MAP);
        assert_eq!(names(sprites, "sprite"), ["webgpu_tone_map"]);
        assert_eq!(sprites.keys().copied().collect::<Vec<_>>(), ["sprite"]);
    }

    /// [`output_with_features`], with the features that a build may need several of: alpha hash,
    /// skinning and bloom. The lit template gains their builds, and the sprite shader one hashed
    /// build that needs sprites too.
    fn output_with_combined_features() -> Output {
        use permutation::{ALPHA_HASH, BLOOM, SKIN, TONE_MAP};
        let mut output = output_with_features();
        output.first_use.bits.insert(ALPHA_HASH, "hash".to_owned());
        output.first_use.bits.insert(SKIN, "skinning".to_owned());
        let lit = output.shaders.get_mut("lit").unwrap();
        for (name, bits) in [
            ("webgpu_hash", ALPHA_HASH),
            ("webgpu_bloom_hash", BLOOM | ALPHA_HASH),
            ("webgpu_tone_map_bloom_hash", TONE_MAP | BLOOM | ALPHA_HASH),
            ("webgpu_bloom_hash_skin", BLOOM | ALPHA_HASH | SKIN),
        ] {
            lit.insert(name.to_owned(), build(Target::Wgsl, bits));
        }
        let sprite = output.shaders.get_mut("sprite").unwrap();
        sprite.insert("webgpu_hash".to_owned(), build(Target::Wgsl, ALPHA_HASH));
        output
    }

    #[test]
    fn builds_that_need_several_features_have_modules_of_their_own() {
        use permutation::TONE_MAP;
        let output = output_with_combined_features();
        let modules = device_builds(&output);
        let stems: Vec<String> = modules
            .keys()
            .filter(|module| module.target == Target::Wgsl && module.file.is_some())
            .map(DeviceModule::stem)
            .collect();
        assert_eq!(
            stems,
            [
                "shaders-bloom-wgsl",
                "shaders-bloom-and-hash-wgsl",
                "shaders-bloom-and-hash-wgsl-tone-map",
                "shaders-bloom-and-hash-and-skinning-wgsl",
                "shaders-hash-wgsl",
                "shaders-hash-and-sprites-wgsl",
                "shaders-sprites-wgsl",
                "shaders-sprites-wgsl-tone-map",
            ],
            "no module for a set of features without builds, such as bloom and sprites"
        );
        let module = |file: &str, bits| {
            &modules[&DeviceModule {
                file: Some(file.to_owned()),
                target: Target::Wgsl,
                bits,
            }]
        };
        assert_eq!(names(module("hash", 0), "lit"), ["webgpu_hash"]);
        assert!(
            !module("hash", 0).contains_key("sprite"),
            "the sprite's hashed build needs sprites too"
        );
        assert_eq!(names(module("bloom", 0), "lit"), ["webgpu_bloom"]);
        assert_eq!(names(module("bloom+hash", 0), "lit"), ["webgpu_bloom_hash"]);
        assert_eq!(
            names(module("bloom+hash", TONE_MAP), "lit"),
            ["webgpu_tone_map_bloom_hash"]
        );
        assert_eq!(
            names(module("bloom+hash+skinning", 0), "lit"),
            ["webgpu_bloom_hash_skin"]
        );
        assert_eq!(names(module("hash+sprites", 0), "sprite"), ["webgpu_hash"]);
        let modules = self::modules(&output);
        let main = &modules["shaders.ts"];
        assert!(main.contains(
            "const WGSL_COMBINED: readonly string[] = ['bloom+hash', 'bloom+hash+skinning', 'hash+sprites'];"
        ));
        assert!(main.contains("const GLSL_COMBINED: readonly string[] = [];"));
        assert!(
            !main.contains("shaders-bloom-and-hash"),
            "the start's main module names no module of several features"
        );
        assert!(!modules.contains_key("shaders-glsl-combos.ts"));
        // One table for each family, named after the key's first feature.
        let combined = &modules["shaders-wgsl-combos-bloom.ts"];
        let pair = "	'bloom+hash': {
		bits: 2,
		modules: {
			0: () => importShaders(new URL('./shaders-bloom-and-hash-wgsl.js', import.meta.url)),
			2: () => importShaders(new URL('./shaders-bloom-and-hash-wgsl-tone-map.js', import.meta.url)),
		},
	},
";
        assert!(combined.contains(pair), "{combined}");
        assert!(combined.contains("	'bloom+hash+skinning': {\n		bits: 0,\n"));
        assert!(
            modules["shaders-wgsl-combos-hash.ts"].contains("	'hash+sprites': {\n"),
            "a key whose first feature is hash sits in the hash family's table"
        );
        assert!(
            main.contains("	'hash': (bits: number) =>"),
            "the main module loads the table of the family that a key names"
        );
        assert!(
            main.contains("const WGSL_COMBINED_DEPTH: Readonly<Record<string, number>> = {"),
            "the main module knows how many names a family takes"
        );
        assert!(main.contains("export const FEATURE_JOIN = '+';"));
        assert!(main.contains("export function firstUseFile(shader: string, permutation: number)"));
    }

    #[test]
    fn each_generated_module_keeps_one_statement_on_each_line() {
        // The modules claim the layout that the repository's formatter gives them, so a line that
        // holds a second statement reads as a fault in the text this crate hands out. A merge once
        // joined two statements with a tab.
        for (name, text) in modules(&output_with_features()) {
            for (number, line) in text.lines().enumerate() {
                let joined = line
                    .split_once(";\t")
                    .is_some_and(|(_, rest)| !rest.trim().is_empty());
                assert!(
                    !joined,
                    "`{name}` line {} holds two statements:\n{line}",
                    number + 1
                );
            }
        }
    }

    /// Asserts that the module set names each module of the build, renders its text on demand, and
    /// answers None for a name that the build does not make.
    fn assert_module_set_matches(output: &Output) {
        let modules = modules(output);
        let set = ModuleSet::new(output);
        assert_eq!(
            set.names().collect::<Vec<_>>(),
            modules.keys().map(String::as_str).collect::<Vec<_>>(),
            "the set names each module of the build"
        );
        for (name, text) in &modules {
            assert_eq!(set.text(name).as_deref(), Some(text.as_str()), "`{name}`");
        }
        assert_eq!(set.text("not-a-module.ts"), None);
    }

    #[test]
    fn the_module_set_names_and_renders_each_module_of_the_build() {
        assert_module_set_matches(&output());
        assert_module_set_matches(&output_with_features());
        assert_module_set_matches(&output_with_combined_features());
        assert_module_set_matches(&output_with_first_use_shader());
        assert_module_set_matches(&output_shared_by_features(SHARED_PARAGRAPH_MIN_USES));
    }

    #[test]
    fn the_main_module_finds_and_loads_the_modules_of_each_feature() {
        let modules = modules(&output_with_features());
        assert_eq!(modules.len(), 15);
        assert!(
            modules["shader-features.ts"]
                .contains("export const SHADER_FEATURES = ['bloom', 'sprites'] as const;")
        );
        let main = &modules["shaders.ts"];
        let sprites = "	sprites: {
		bits: 2,
		modules: {
			0: () => importShaders(new URL('./shaders-sprites-wgsl.js', import.meta.url)),
			2: () => importShaders(new URL('./shaders-sprites-wgsl-tone-map.js', import.meta.url)),
		},
	},
";
        assert!(main.contains(sprites), "{main}");
        assert!(main.contains(
            "			1: () => importShaders(new URL('./shaders-bloom-glsl-draw-index.js', import.meta.url)),
"
        ));
        assert!(main.contains(
            "	sprite: 'sprites',
"
        ));
        assert!(main.contains(&format!(
            "FEATURE_BITS: readonly (readonly [number, string])[] = [[{}, 'bloom']];",
            permutation::BLOOM
        )));
        assert!(main.contains(&format!(
            "const FEATURE_MASKS: Readonly<Record<string, number>> = {{\n\tlit: {},\n}};",
            permutation::BLOOM
        )));
        let start = "const WGSL_MODULES: DeviceModules = {
	0: () => importShaders(new URL('./shaders-wgsl.js', import.meta.url)),
	2: () => importShaders(new URL('./shaders-wgsl-tone-map.js', import.meta.url)),
};";
        assert!(main.contains(start), "{main}");
        let sprites = &modules["shaders-sprites-wgsl-tone-map.js"];
        assert!(!sprites.contains("import"));
        assert!(sprites.contains(
            "export const SHADERS = {
	sprite: {
"
        ));
        assert!(modules["shaders-wgsl.js"].contains(
            "	sprite: {},
"
        ));
    }

    fn glsl_program(vertex: &str, fragment: &str) -> crate::GlslProgram {
        let stage = |source: &str| GlslStage {
            source: source.into(),
            uniform_blocks: Vec::new(),
            textures: Vec::new(),
        };
        crate::GlslProgram {
            vertex: stage(vertex),
            fragment: stage(fragment),
        }
    }

    #[test]
    fn a_source_that_several_builds_of_a_module_share_is_written_once() {
        let mut output = Output::default();
        let mut lit = BTreeMap::new();
        for (name, fragment) in [("a", "frag `a` ${x}"), ("b", "frag b")] {
            let mut build = build(Target::Glsl, 0);
            build.glsl = Some(BTreeMap::from([(
                "main".to_owned(),
                glsl_program("vert shared", fragment),
            )]));
            lit.insert(name.to_owned(), build);
        }
        output.shaders.insert("lit".to_owned(), lit);
        output.by_device = ["lit".to_owned()].into();
        let modules = modules(&output);
        let glsl = &modules["shaders-glsl.js"];
        assert_eq!(glsl.matches("vert shared").count(), 1, "{glsl}");
        assert!(
            glsl.contains("\nconst SOURCE_0 = `vert shared`;\n"),
            "{glsl}"
        );
        assert_eq!(glsl.matches("source: SOURCE_0,").count(), 2, "{glsl}");
        assert!(glsl.contains("source: `frag \\`a\\` \\${x}`,"), "{glsl}");
        assert!(glsl.contains("source: `frag b`,"), "{glsl}");
        assert!(!glsl.contains("SOURCE_1"), "{glsl}");
    }

    #[test]
    fn a_paragraph_that_several_sources_of_a_module_share_is_written_once() {
        let shared = "uniform vec4 shared_uniform;";
        let mut output = Output::default();
        let mut lit = BTreeMap::new();
        for (name, vertex, fragment) in [
            (
                "a",
                format!("{shared}\n\nvoid a() {{}}"),
                "short\n\nfrag `a` ${x}",
            ),
            ("b", format!("{shared}\n\nvoid b() {{}}"), "short\n\nfrag b"),
        ] {
            let mut build = build(Target::Glsl, 0);
            build.glsl = Some(BTreeMap::from([(
                "main".to_owned(),
                glsl_program(&vertex, fragment),
            )]));
            lit.insert(name.to_owned(), build);
        }
        output.shaders.insert("lit".to_owned(), lit);
        let main = &modules(&output)[&format!("{MAIN_MODULE}.ts")];
        assert_eq!(
            main.matches(shared).count(),
            2,
            "the main module shares whole sources only"
        );
        output.by_device = ["lit".to_owned()].into();
        let modules = modules(&output);
        let glsl = &modules["shaders-glsl.js"];
        assert_eq!(glsl.matches(shared).count(), 1, "{glsl}");
        assert!(
            glsl.contains(&format!("\nconst PART_0 = `{shared}`;\n")),
            "{glsl}"
        );
        assert!(
            glsl.contains("source: `${PART_0}\n\nvoid a() {}`,"),
            "{glsl}"
        );
        assert!(
            glsl.contains("source: `${PART_0}\n\nvoid b() {}`,"),
            "{glsl}"
        );
        assert!(
            glsl.contains("source: `short\n\nfrag \\`a\\` \\${x}`,"),
            "{glsl}"
        );
        assert!(
            !glsl.contains("PART_1"),
            "a paragraph shorter than its name stays"
        );
    }

    /// The paragraph that every feature module of [`output_shared_by_features`] holds, long enough
    /// to shrink when a module names a shared constant in its place.
    const LONG_PARAGRAPH: &str = "uniform vec4 shared_uniform_value;";

    /// A paragraph of that output that one module holds alone, so no table takes it.
    fn own_paragraph(name: &str) -> String {
        format!("uniform vec4 own_uniform_value_{name};")
    }

    /// A build whose WGSL source is `source`.
    fn build_from(target: Target, permutation: u32, source: &str) -> VariantOutput {
        let mut variant = build(target, permutation);
        if let Some(wgsl) = &mut variant.wgsl {
            wgsl.source = source.into();
        }
        variant
    }

    /// An output of `count` device shaders, each a feature that loads on first use, and each
    /// holding [`LONG_PARAGRAPH`] and a paragraph of its own. One shader of the start holds both
    /// kinds of paragraph too, so a test can check that its module names no table. The shader of
    /// number `n` is built for the bits that `bits` gives it.
    fn output_shared_by_features_bits(count: usize, bits: impl Fn(usize) -> u32) -> Output {
        let source = |own: String| format!("{LONG_PARAGRAPH}\n\n{own}");
        let mut output = Output::default();
        output.shaders.insert(
            "start".to_owned(),
            BTreeMap::from([(
                "webgpu".to_owned(),
                build_from(Target::Wgsl, 0, &source(own_paragraph("start"))),
            )]),
        );
        output.by_device.insert("start".to_owned());
        for n in 0..count {
            let shader = format!("feature{n}");
            output.shaders.insert(
                shader.clone(),
                BTreeMap::from([(
                    "webgpu".to_owned(),
                    build_from(
                        Target::Wgsl,
                        bits(n),
                        &source(own_paragraph(&n.to_string())),
                    ),
                )]),
            );
            output.by_device.insert(shader.clone());
            output
                .first_use
                .shaders
                .insert(shader, format!("feature{n}"));
        }
        output
    }

    /// The same, with every shader built for the value of the bits a device fixes of 0.
    fn output_shared_by_features(count: usize) -> Output {
        output_shared_by_features_bits(count, |_| 0)
    }

    #[test]
    fn a_paragraph_that_enough_feature_modules_name_moves_to_the_table() {
        let modules = modules(&output_shared_by_features(SHARED_PARAGRAPH_MIN_USES));
        let table = &modules["shader-paragraphs-wgsl.js"];
        assert!(
            table.contains(&format!("export const SHARED_0 = `{LONG_PARAGRAPH}`;")),
            "{table}"
        );
        assert!(
            !table.contains("own_uniform_value"),
            "one module alone names that paragraph"
        );
        assert!(
            !table.contains("SHARED_1"),
            "only the paragraph enough modules name is shared"
        );
        let module = &modules["shaders-feature0-wgsl.js"];
        assert!(
            module.contains("import { SHARED_0 } from './shader-paragraphs-wgsl.js';\n"),
            "{module}"
        );
        assert!(
            !module.contains(LONG_PARAGRAPH),
            "the table holds the text of a shared paragraph"
        );
        assert!(
            module.contains("source: `${SHARED_0}\n\nuniform vec4 own_uniform_value_0;`,"),
            "{module}"
        );
    }

    #[test]
    fn fewer_feature_modules_than_the_threshold_leave_the_paragraph_in_place() {
        let modules = modules(&output_shared_by_features(SHARED_PARAGRAPH_MIN_USES - 1));
        assert!(
            !modules
                .keys()
                .any(|name| name.starts_with(PARAGRAPHS_MODULE_PREFIX)),
            "no table without enough modules to fill it"
        );
        let module = &modules["shaders-feature0-wgsl.js"];
        assert!(module.contains(LONG_PARAGRAPH), "{module}");
        assert!(!module.contains("import "), "{module}");
    }

    #[test]
    fn a_table_belongs_to_one_value_of_the_bits_a_device_fixes() {
        use permutation::TONE_MAP;
        // One short of the threshold in each of two bit values, so neither kind fills a table.
        let each = SHARED_PARAGRAPH_MIN_USES - 1;
        let split =
            output_shared_by_features_bits(each * 2, |n| if n < each { 0 } else { TONE_MAP });
        assert!(
            !modules(&split)
                .keys()
                .any(|name| name.starts_with(PARAGRAPHS_MODULE_PREFIX)),
            "a table holds the paragraphs of one value of the bits, not of a whole target"
        );
        // The same modules, all built for the bits of 0: one kind, so one table.
        let together = modules(&output_shared_by_features(each * 2));
        assert!(
            together.contains_key("shader-paragraphs-wgsl.js"),
            "the modules of one kind fill a table"
        );
    }

    #[test]
    fn the_starts_module_holds_its_own_paragraphs_and_names_no_table() {
        let modules = modules(&output_shared_by_features(SHARED_PARAGRAPH_MIN_USES));
        let start = &modules["shaders-wgsl.js"];
        assert!(start.contains(LONG_PARAGRAPH), "{start}");
        assert!(!start.contains(PARAGRAPHS_MODULE_PREFIX), "{start}");
    }

    /// [`output`], with a shader that loads on a feature's first use as a whole: one build for
    /// each target.
    fn output_with_first_use_shader() -> Output {
        let mut output = output();
        let environment = BTreeMap::from([
            ("webgpu".to_owned(), build(Target::Wgsl, 0)),
            ("webgl2".to_owned(), build(Target::Glsl, 0)),
        ]);
        output.shaders.insert("room_light".to_owned(), environment);
        output.first_use_shaders = ["room_light".to_owned()].into();
        output
    }

    #[test]
    fn a_shader_that_loads_on_first_use_has_a_module_per_target_outside_the_main_module() {
        let output = output_with_first_use_shader();
        let modules = modules(&output);
        let main = &modules[&format!("{MAIN_MODULE}.ts")];
        assert!(!main.contains("ROOM_LIGHT_SHADER"), "{main}");
        assert!(main.contains("\t() => import('./shaders-room-light-glsl'),\n"));
        assert!(main.contains("\t() => import('./shaders-room-light-wgsl'),\n"));
        let wgsl = &modules["shaders-room-light-wgsl.ts"];
        assert!(wgsl.contains("export const ROOM_LIGHT_SHADER: {\n\treadonly webgpu:"));
        assert!(!wgsl.contains("webgl2"));
        assert!(
            wgsl.contains("export const SHADERS = { room_light: ROOM_LIGHT_SHADER } as const;")
        );
        assert!(modules["shaders-room-light-glsl.ts"].contains("\twebgl2: {\n"));
    }

    #[test]
    fn every_generated_module_keeps_one_statement_to_a_line() {
        let modules = modules(&output_shared_by_features(1));
        for (name, text) in &modules {
            for (number, line) in text.lines().enumerate() {
                // The formatter writes one statement per line, and indents the next with a tab. A
                // semicolon followed by a tab is therefore two statements on one line, which a
                // merge that joined two edits leaves behind.
                assert!(!line.contains(";\t"), "{name} line {}: {line}", number + 1);
            }
        }
    }
}
