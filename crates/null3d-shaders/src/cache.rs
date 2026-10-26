//! A per-entry cache of compiled shaders.
//!
//! The build composes and compiles every entry in the manifest on each run, which takes minutes
//! when one WGSL file changed. This cache keeps each entry's compiled output, the WGSL and GLSL
//! records that the build makes before the modules are assembled, in a folder that every checkout
//! on the machine shares and that is keyed by the compiler's stamp. A run reuses an entry when its
//! own source, its manifest table and the library modules it imports are unchanged, so a change
//! to one entry compiles only that entry, and a change to a library module compiles only the
//! entries that import it.
//!
//! The cache never decides a build on its own. An entry that is missing, unreadable or written
//! under another key, or whose dependency contents changed, is a miss, and the entry compiles
//! again. A folder that cannot be read or written costs the next run its work and nothing else.
//!
//! An entry is one file named for its entry and its key, so two versions of one entry never
//! overwrite each other. A build that compiles one part of an entry's builds, as CI's shards do for
//! the costliest entries, stores the part in a file named for the entry, its key and the part. A
//! build that misses the whole entry joins a complete set of parts of one count into it, stores the
//! whole entry and removes the parts, and a build of one part reads the whole entry's builds when
//! it has them. Many builds of an entry make the same WGSL or GLSL source, so the file holds each
//! source once and each build names its sources by number, and a read gives every build that names
//! a source the same text in memory. The folder is pruned to a size limit after each store, oldest
//! first, with a recent entry spared because a build may be reading it.
//!
//! Only the build command, which runs natively, reads and writes the cache. The shader compiler
//! that a page or a bundler loads is built for WebAssembly, where the cache is off and its file
//! code and JSON leave no trace.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[cfg(not(target_arch = "wasm32"))]
use serde::{Deserialize, Serialize};
#[cfg(not(target_arch = "wasm32"))]
use std::fs;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use crate::{GlslProgram, GlslStage, GlslTexture, GlslUniformBlock, Pipeline, WgslOutput};
use crate::{Part, VariantOutput};

/// The version of the cache's file format and key. Bump it when either changes, so an entry an
/// older format wrote is never read with a new meaning.
const FORMAT: &str = "3";

/// How many bytes one cache folder may hold before its oldest entries go. The build tools bound the
/// caches under their one root with the same figure (tools/lib/build-cache.ts), so one rule covers
/// the machine.
#[cfg(not(target_arch = "wasm32"))]
const LIMIT_BYTES: u64 = 24 * 1024 * 1024 * 1024;

/// How many bytes of a cache file a read takes from the disk at a time.
#[cfg(not(target_arch = "wasm32"))]
const READ_BUFFER: usize = 1 << 20;

/// An entry written this recently stays when the folder is pruned, because the build that reads it
/// may still be running.
#[cfg(not(target_arch = "wasm32"))]
const IN_USE_SECS: u64 = 2 * 60 * 60;

/// How many entries a run compiled and how many it reused.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    /// The entries this run composed and compiled.
    pub compiled: usize,
    /// The entries this run reused from the cache.
    pub reused: usize,
}

/// The per-entry cache: a folder and a compiler stamp, or nothing when the cache is off.
#[derive(Clone, Debug, Default)]
pub struct Cache {
    folder: Option<PathBuf>,
    stamp: String,
}

impl Cache {
    /// A cache that answers every lookup with a miss.
    pub fn disabled() -> Self {
        Self::default()
    }

    /// A cache in `folder`, keyed by `stamp`: the fingerprint of the compiler that made the
    /// entries. A different stamp writes and reads different entries, so a compiler change
    /// invalidates every one of them.
    pub fn at(folder: &Path, stamp: &str) -> Self {
        Self {
            folder: Some(folder.to_owned()),
            stamp: stamp.to_owned(),
        }
    }

    /// True when the cache reads and writes entries.
    pub fn is_on(&self) -> bool {
        self.folder.is_some()
    }

    /// The key of one entry: its name, file and source, its manifest table and the compiler's
    /// stamp. A change to any of them gives another key, so the entry compiles again.
    pub fn key(&self, name: &str, file: &str, source: &str, table: &str) -> String {
        digest(&[
            FORMAT.as_bytes(),
            self.stamp.as_bytes(),
            name.as_bytes(),
            file.as_bytes(),
            source.as_bytes(),
            table.as_bytes(),
        ])
    }

    /// The compiled output of the entry `name`, when the folder holds it under `key` and every
    /// dependency's contents match, or holds a complete set of its parts of one count, which it
    /// joins. `files` are the shader sources by path relative to the shader folder.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(
        &self,
        name: &str,
        key: &str,
        files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        self.read(&entry_file(name, key), key, files)
            .or_else(|| self.join_parts(name, key, files))
    }

    /// The compiled output of one part of the entry `name`: the part's own file under `key`, or the
    /// whole entry narrowed to `builds`, the names of the part's builds. The whole entry answers for
    /// any part of it, so a shard that splits the entry otherwise than an earlier one still reuses
    /// what that one stored.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load_part(
        &self,
        name: &str,
        key: &str,
        part: Part,
        builds: &[String],
        files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        if let Some(variants) = self.read(&part_file(name, key, part), key, files) {
            return Some(variants);
        }
        let mut whole = self.read_entry(&entry_file(name, key), key, files)?;
        builds
            .iter()
            .map(|build| {
                let variant = whole.variants.remove(build)?.output(&whole.texts)?;
                Some((build.clone(), variant))
            })
            .collect()
    }

    /// The variants of one cache file, when it was written under `key` and every dependency's
    /// contents match `files`.
    #[cfg(not(target_arch = "wasm32"))]
    fn read(
        &self,
        file: &str,
        key: &str,
        files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        self.read_entry(file, key, files)?.outputs()
    }

    /// One cache file in its stored form, when it was written under `key` and every dependency's
    /// contents match `files`. The file is parsed as it is read, so the largest entry, a file of
    /// gigabytes, is never held as bytes and as data at once.
    #[cfg(not(target_arch = "wasm32"))]
    fn read_entry(&self, file: &str, key: &str, files: &BTreeMap<String, String>) -> Option<Entry> {
        let folder = self.folder.as_ref()?;
        let reader =
            std::io::BufReader::with_capacity(READ_BUFFER, fs::File::open(folder.join(file)).ok()?);
        let entry: Entry = serde_json::from_reader(reader).ok()?;
        if entry.key != key {
            return None;
        }
        for dep in &entry.deps {
            if digest(&[files.get(&dep.file)?.as_bytes()]) != dep.hash {
                return None;
            }
        }
        Some(entry)
    }

    /// The entry `name` joined from a complete set of its parts of one count under `key`, which the
    /// folder's file names show without reading the files. The joined entry is stored whole, so the
    /// next build reads one file, and its parts are removed. A set with a part that does not read
    /// is passed over.
    ///
    /// The parts join in their stored form, one at a time, with each source held once for the
    /// whole entry, and the joined entry streams to its file. So the join holds the whole entry's
    /// sources and one part's file, as a read of the whole entry does. The costliest entry's
    /// builds take several times its file's size when each holds its own copy of its sources, and
    /// holding all those copies beside more for the store ran CI's build job out of memory (D-235).
    #[cfg(not(target_arch = "wasm32"))]
    fn join_parts(
        &self,
        name: &str,
        key: &str,
        files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        let folder = self.folder.as_ref()?;
        let prefix = format!("{name}.{key}.part-");
        let mut counts: BTreeMap<usize, std::collections::BTreeSet<usize>> = BTreeMap::new();
        for item in fs::read_dir(folder).ok()?.flatten() {
            let file = item.file_name();
            let Some(rest) = file
                .to_str()
                .and_then(|file| file.strip_prefix(&prefix))
                .and_then(|rest| rest.strip_suffix(".json"))
            else {
                continue;
            };
            let Some((index, count)) = rest.split_once("-of-") else {
                continue;
            };
            if let (Ok(index), Ok(count)) = (index.parse::<usize>(), count.parse::<usize>())
                && index < count
            {
                counts.entry(count).or_default().insert(index);
            }
        }
        for (count, indices) in counts {
            if indices.len() != count {
                continue;
            }
            let parts = (0..count).map(|index| Part { index, count });
            let Some(entry) = self.join_entries(name, key, files, parts.clone()) else {
                continue;
            };
            self.write_entry(&entry_file(name, key), &entry);
            for part in parts {
                let _ = fs::remove_file(folder.join(part_file(name, key, part)));
            }
            return entry.outputs();
        }
        None
    }

    /// The `parts` of the entry `name` joined into one entry in its stored form, with each source
    /// held once for the whole entry, or nothing when a part does not read. Only one part's file is
    /// held at a time.
    #[cfg(not(target_arch = "wasm32"))]
    fn join_entries(
        &self,
        name: &str,
        key: &str,
        files: &BTreeMap<String, String>,
        parts: impl Iterator<Item = Part>,
    ) -> Option<Entry> {
        let mut texts = SharedTexts::default();
        let mut variants = BTreeMap::new();
        let mut deps = BTreeMap::new();
        for part in parts {
            let mut entry = self.read_entry(&part_file(name, key, part), key, files)?;
            let numbers: Vec<usize> = entry.texts.iter().map(|text| texts.number(text)).collect();
            drop(entry.texts);
            for variant in entry.variants.values_mut() {
                variant.renumber(&numbers)?;
            }
            variants.append(&mut entry.variants);
            deps.extend(entry.deps.into_iter().map(|dep| (dep.file, dep.hash)));
        }
        Some(Entry {
            key: key.to_owned(),
            deps: deps
                .into_iter()
                .map(|(file, hash)| Dep { file, hash })
                .collect(),
            texts: texts.into_list(),
            variants,
        })
    }

    /// The compiled output of an entry. The cache is off in the shader compiler, which a page or a
    /// bundler loads, so it never has an entry.
    #[cfg(target_arch = "wasm32")]
    pub fn load(
        &self,
        _name: &str,
        _key: &str,
        _files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        None
    }

    /// The compiled output of one part of an entry. The cache is off in the shader compiler, which
    /// a page or a bundler loads, so it never has a part.
    #[cfg(target_arch = "wasm32")]
    pub fn load_part(
        &self,
        _name: &str,
        _key: &str,
        _part: Part,
        _builds: &[String],
        _files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        None
    }

    /// Stores the compiled output of the entry `name` under `key`, with the contents of each
    /// dependency in `deps`, so a later run can tell whether one of them changed. A write that
    /// fails leaves the cache as it was.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn store(
        &self,
        name: &str,
        key: &str,
        deps: &[String],
        files: &BTreeMap<String, String>,
        variants: &BTreeMap<String, VariantOutput>,
    ) {
        self.write(&entry_file(name, key), key, deps, files, variants);
    }

    /// Stores the compiled output of one part of the entry `name` under `key`, as [`Cache::store`]
    /// stores a whole entry. A later build joins a complete set of parts into the whole entry.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn store_part(
        &self,
        name: &str,
        key: &str,
        part: Part,
        deps: &[String],
        files: &BTreeMap<String, String>,
        variants: &BTreeMap<String, VariantOutput>,
    ) {
        self.write(&part_file(name, key, part), key, deps, files, variants);
    }

    /// Writes one cache file of `variants`, with the contents of each dependency in `deps`.
    #[cfg(not(target_arch = "wasm32"))]
    fn write(
        &self,
        file_name: &str,
        key: &str,
        deps: &[String],
        files: &BTreeMap<String, String>,
        variants: &BTreeMap<String, VariantOutput>,
    ) {
        if self.folder.is_none() {
            return;
        }
        let deps: Vec<Dep> = deps
            .iter()
            .filter_map(|file| {
                files.get(file).map(|source| Dep {
                    file: file.clone(),
                    hash: digest(&[source.as_bytes()]),
                })
            })
            .collect();
        let mut texts = SharedTexts::default();
        let variants = variants
            .iter()
            .map(|(name, variant)| (name.clone(), StoredVariant::of(variant, &mut texts)))
            .collect();
        let entry = Entry {
            key: key.to_owned(),
            deps,
            texts: texts.into_list(),
            variants,
        };
        self.write_entry(file_name, &entry);
    }

    /// Writes one cache file, whole or not at all, and prunes the folder. The JSON streams to the
    /// file as it is made, so a large entry is never held as data and as text at once.
    #[cfg(not(target_arch = "wasm32"))]
    fn write_entry(&self, file_name: &str, entry: &Entry) {
        let Some(folder) = self.folder.as_ref() else {
            return;
        };
        if fs::create_dir_all(folder).is_err() {
            return;
        }
        let file = folder.join(file_name);
        let staging = folder.join(format!("{file_name}.{}.tmp", std::process::id()));
        // Write the entry whole or not at all, so a stopped run leaves no half entry.
        let written = fs::File::create(&staging).ok().and_then(|out| {
            let mut out = std::io::BufWriter::new(out);
            serde_json::to_writer(&mut out, entry).ok()?;
            std::io::Write::flush(&mut out).ok()
        });
        if written.is_some() {
            let _ = fs::rename(&staging, &file);
        } else {
            let _ = fs::remove_file(&staging);
        }
        // Pruning here bounds the folder that this run writes into, whether the build tools or a
        // direct `cargo run` started it (code review H-16).
        prune(folder, LIMIT_BYTES);
    }

    /// Stores the compiled output of an entry. The cache is off in the shader compiler, which a
    /// page or a bundler loads, so it stores nothing.
    #[cfg(target_arch = "wasm32")]
    pub fn store(
        &self,
        _name: &str,
        _key: &str,
        _deps: &[String],
        _files: &BTreeMap<String, String>,
        _variants: &BTreeMap<String, VariantOutput>,
    ) {
    }

    /// Stores the compiled output of one part of an entry. The cache is off in the shader
    /// compiler, which a page or a bundler loads, so it stores nothing.
    #[cfg(target_arch = "wasm32")]
    pub fn store_part(
        &self,
        _name: &str,
        _key: &str,
        _part: Part,
        _deps: &[String],
        _files: &BTreeMap<String, String>,
        _variants: &BTreeMap<String, VariantOutput>,
    ) {
    }
}

/// One entry as the cache stores it.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct Entry {
    /// The key the entry was written under.
    key: String,
    /// The library files the entry used, with the hash of each.
    deps: Vec<Dep>,
    /// The WGSL and GLSL sources of the entry's builds, each once. Thousands of builds share most
    /// of them: writing each build's sources out whole made a single entry 1.5 GB (code review
    /// M-32), and holding a copy for each build took several times the file's size in memory.
    texts: Vec<Arc<str>>,
    /// The builds by name, each naming its sources by their place in `texts`.
    variants: BTreeMap<String, StoredVariant>,
}

#[cfg(not(target_arch = "wasm32"))]
impl Entry {
    /// The compiled variants, each source the entry's one copy of it, or nothing when a build names
    /// a source that the entry lacks.
    fn outputs(self) -> Option<BTreeMap<String, VariantOutput>> {
        let texts = self.texts;
        self.variants
            .into_iter()
            .map(|(name, variant)| Some((name, variant.output(&texts)?)))
            .collect()
    }
}

/// One build as the cache stores it: a [`VariantOutput`] whose sources are numbers in its entry's
/// texts.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct StoredVariant {
    permutation: u32,
    wgsl: Option<StoredWgsl>,
    glsl: Option<BTreeMap<String, StoredProgram>>,
}

/// A [`WgslOutput`] as the cache stores it.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct StoredWgsl {
    source: usize,
    pipelines: BTreeMap<String, Pipeline>,
}

/// A [`GlslProgram`] as the cache stores it.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct StoredProgram {
    vertex: StoredStage,
    fragment: StoredStage,
}

/// A [`GlslStage`] as the cache stores it.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct StoredStage {
    source: usize,
    uniform_blocks: Vec<GlslUniformBlock>,
    textures: Vec<GlslTexture>,
}

#[cfg(not(target_arch = "wasm32"))]
impl StoredVariant {
    /// `variant` as the cache stores it, with each source numbered in `texts`.
    fn of(variant: &VariantOutput, texts: &mut SharedTexts) -> Self {
        let VariantOutput {
            permutation,
            wgsl,
            glsl,
        } = variant;
        let stage = |stage: &GlslStage, texts: &mut SharedTexts| {
            let GlslStage {
                source,
                uniform_blocks,
                textures,
            } = stage;
            StoredStage {
                source: texts.number(source),
                uniform_blocks: uniform_blocks.clone(),
                textures: textures.clone(),
            }
        };
        Self {
            permutation: *permutation,
            wgsl: wgsl
                .as_ref()
                .map(|WgslOutput { source, pipelines }| StoredWgsl {
                    source: texts.number(source),
                    pipelines: pipelines.clone(),
                }),
            glsl: glsl.as_ref().map(|programs| {
                programs
                    .iter()
                    .map(|(name, GlslProgram { vertex, fragment })| {
                        let program = StoredProgram {
                            vertex: stage(vertex, texts),
                            fragment: stage(fragment, texts),
                        };
                        (name.clone(), program)
                    })
                    .collect()
            }),
        }
    }

    /// The numbers of this build's sources, for the caller to read or change.
    fn sources(&mut self) -> impl Iterator<Item = &mut usize> {
        let wgsl = self.wgsl.iter_mut().map(|wgsl| &mut wgsl.source);
        let glsl = self.glsl.iter_mut().flat_map(|programs| {
            programs
                .values_mut()
                .flat_map(|program| [&mut program.vertex.source, &mut program.fragment.source])
        });
        wgsl.chain(glsl)
    }

    /// Moves this build's sources from a part's numbers to the joined entry's: the source a part
    /// numbered `n` is `numbers[n]` in the joined entry. Nothing when a source is outside `numbers`.
    fn renumber(&mut self, numbers: &[usize]) -> Option<()> {
        for source in self.sources() {
            *source = *numbers.get(*source)?;
        }
        Some(())
    }

    /// The compiled variant, each source a shared copy of its text in `texts`, or nothing when a
    /// source is outside `texts`.
    fn output(mut self, texts: &[Arc<str>]) -> Option<VariantOutput> {
        if self.sources().any(|source| *source >= texts.len()) {
            return None;
        }
        let stage = |stage: StoredStage| GlslStage {
            source: Arc::clone(&texts[stage.source]),
            uniform_blocks: stage.uniform_blocks,
            textures: stage.textures,
        };
        Some(VariantOutput {
            permutation: self.permutation,
            wgsl: self.wgsl.map(|wgsl| WgslOutput {
                source: Arc::clone(&texts[wgsl.source]),
                pipelines: wgsl.pipelines,
            }),
            glsl: self.glsl.map(|programs| {
                programs
                    .into_iter()
                    .map(|(name, program)| {
                        let program = GlslProgram {
                            vertex: stage(program.vertex),
                            fragment: stage(program.fragment),
                        };
                        (name, program)
                    })
                    .collect()
            }),
        })
    }
}

/// The sources of one entry, each held once and numbered in the order first met.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct SharedTexts {
    numbers: std::collections::HashMap<Arc<str>, usize>,
}

#[cfg(not(target_arch = "wasm32"))]
impl SharedTexts {
    /// The number of `text`: its own when it was met before, else the next one.
    fn number(&mut self, text: &Arc<str>) -> usize {
        let next = self.numbers.len();
        *self.numbers.entry(Arc::clone(text)).or_insert(next)
    }

    /// The texts in the order of their numbers.
    fn into_list(self) -> Vec<Arc<str>> {
        let mut list: Vec<Option<Arc<str>>> = vec![None; self.numbers.len()];
        for (text, number) in self.numbers {
            list[number] = Some(text);
        }
        list.into_iter().flatten().collect()
    }
}

/// One library file that an entry used, and the hash of its contents.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct Dep {
    /// The file by path relative to the shader folder, such as `lib/math.wgsl`.
    file: String,
    /// The hash of the file's contents.
    hash: String,
}

/// The file name of one entry's cache file: the entry's name and the key it was written under. The
/// key is part of the name, so two versions of one entry never overwrite each other. A branch that
/// returns to an earlier version of a shader still finds the entry that version wrote, and the
/// entries of the versions in between are pruned rather than replaced (code review M-32).
#[cfg(not(target_arch = "wasm32"))]
fn entry_file(name: &str, key: &str) -> String {
    format!("{name}.{key}.json")
}

/// The file name of one part of an entry's builds: the entry's name, its key and the part, so a
/// build that misses the whole entry finds a complete set of parts by their names alone.
#[cfg(not(target_arch = "wasm32"))]
fn part_file(name: &str, key: &str, part: Part) -> String {
    format!("{name}.{key}.part-{}-of-{}.json", part.index, part.count)
}

/// One cache file as pruning sees it: its path, its size and when it was written.
#[cfg(not(target_arch = "wasm32"))]
type EntryFile = (PathBuf, u64, std::time::SystemTime);

/// The entries to remove so that `entries` holds at most `limit` bytes: the oldest first, never one
/// written within the last `IN_USE_SECS`, because a build that is reading it may still be running.
/// A pure plan, so a test can check the rule without filling a disk.
#[cfg(not(target_arch = "wasm32"))]
fn entries_to_remove(
    entries: &[EntryFile],
    now: std::time::SystemTime,
    limit: u64,
) -> Vec<PathBuf> {
    let mut total: u64 = entries.iter().map(|(_, size, _)| *size).sum();
    if total <= limit {
        return Vec::new();
    }
    let mut oldest: Vec<&EntryFile> = entries.iter().collect();
    oldest.sort_by_key(|(_, _, modified)| *modified);
    let mut remove = Vec::new();
    for (path, size, modified) in oldest {
        if total <= limit {
            break;
        }
        let in_use = now
            .duration_since(*modified)
            .map(|age| age.as_secs() < IN_USE_SECS)
            // A file written after `now` was taken counts as in use too.
            .unwrap_or(true);
        if in_use {
            continue;
        }
        remove.push(path.clone());
        total = total.saturating_sub(*size);
    }
    remove
}

/// Removes the oldest entries of `folder` while it holds more than `limit` bytes.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::disallowed_methods)] // Only the native build command writes the cache, and pruning reads the wall clock.
fn prune(folder: &Path, limit: u64) {
    let Ok(items) = fs::read_dir(folder) else {
        return;
    };
    let now = std::time::SystemTime::now();
    let entries: Vec<EntryFile> = items
        .flatten()
        .filter_map(|item| {
            let meta = item.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((item.path(), meta.len(), meta.modified().unwrap_or(now)))
        })
        .collect();
    for path in entries_to_remove(&entries, now, limit) {
        let _ = fs::remove_file(&path);
    }
}

/// A stable 128-bit hash of the given byte strings, as 32 lowercase hex digits. Two independent
/// 64-bit lanes make a collision between two inputs of one entry practically impossible, so a
/// cache hit never serves the output of another input.
fn digest(parts: &[&[u8]]) -> String {
    let mut first: u64 = 0xcbf2_9ce4_8422_2325;
    let mut second: u64 = 0x9e37_79b9_7f4a_7c15;
    for part in parts {
        for &byte in *part {
            first = (first ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
            second = (second.rotate_left(5) ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
        }
        // A separator, so two parts never run together into another pair's bytes.
        first = (first ^ 0xff).wrapping_mul(0x0000_0100_0000_01b3);
        second = (second.rotate_left(5) ^ 0xff).wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{first:016x}{second:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::WgslOutput;

    /// A folder of its own for one test.
    fn temp_folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("null3d-cache-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// `count` builds of one entry that share the module `text`.
    fn variants(text: &str, count: usize) -> BTreeMap<String, VariantOutput> {
        let mut built = BTreeMap::new();
        for index in 0..count {
            built.insert(
                format!("build{index}"),
                VariantOutput {
                    permutation: index as u32,
                    wgsl: Some(WgslOutput {
                        source: text.into(),
                        pipelines: BTreeMap::new(),
                    }),
                    glsl: None,
                },
            );
        }
        built
    }

    #[test]
    fn an_entry_keeps_one_file_for_each_key() {
        let folder = temp_folder("keys");
        let cache = Cache::at(&folder, "stamp");
        let files = BTreeMap::new();
        let one = cache.key("mipmap", "mipmap.wgsl", "source one", "table");
        let two = cache.key("mipmap", "mipmap.wgsl", "source two", "table");
        cache.store("mipmap", &one, &[], &files, &variants("shared module", 2));
        cache.store("mipmap", &two, &[], &files, &variants("shared module", 2));
        // Two versions of one entry do not overwrite each other, so a branch that returns to an
        // earlier source still finds the entry that source built.
        assert!(cache.load("mipmap", &one, &files).is_some());
        assert!(cache.load("mipmap", &two, &files).is_some());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn an_entry_holds_a_shared_text_once_and_gives_it_back() {
        let folder = temp_folder("texts");
        let cache = Cache::at(&folder, "stamp");
        let files = BTreeMap::new();
        let key = cache.key("mipmap", "mipmap.wgsl", "source", "table");
        // One library module, as it runs through the thousands of builds of an entry shader.
        let module = "let shared_module_value = 1.0;\n".repeat(20);
        let built = variants(&module, 200);
        cache.store("mipmap", &key, &[], &files, &built);
        assert_eq!(cache.load("mipmap", &key, &files), Some(built.clone()));
        // The module is held once for the whole entry, so every build that uses it costs a reference
        // instead of a copy: the file is a fraction of the variants written out plain.
        let plain = serde_json::to_string(&built).unwrap().len();
        let stored = fs::read_to_string(folder.join(entry_file("mipmap", &key)))
            .unwrap()
            .len();
        assert!(stored * 4 < plain, "stored {stored} bytes, plain {plain}");
        // The builds that a read gives back hold the module as one text in memory, not a copy each.
        let loaded = cache.load("mipmap", &key, &files).unwrap();
        let source = |build: &VariantOutput| Arc::clone(&build.wgsl.as_ref().unwrap().source);
        let first = source(&loaded["build0"]);
        assert!(
            loaded
                .values()
                .all(|build| Arc::ptr_eq(&source(build), &first))
        );
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    #[allow(clippy::disallowed_methods)] // The cache is native-only, and the test needs a clock.
    fn pruning_spends_the_oldest_entries_and_keeps_a_recent_one() {
        let now = std::time::SystemTime::now();
        let ago = |secs: u64| now - std::time::Duration::from_secs(secs);
        let entries = vec![
            (PathBuf::from("old.json"), 600, ago(24 * 60 * 60)),
            (PathBuf::from("new.json"), 600, ago(10)),
            (PathBuf::from("older.json"), 600, ago(48 * 60 * 60)),
        ];
        // Under the limit, nothing goes.
        assert!(entries_to_remove(&entries, now, 2048).is_empty());
        // 1800 bytes over a limit of 1200: the oldest entry alone brings it under.
        assert_eq!(
            entries_to_remove(&entries, now, 1200),
            vec![PathBuf::from("older.json")]
        );
        // Even a limit nothing can meet spares the entry a build may be reading.
        assert_eq!(
            entries_to_remove(&entries, now, 100),
            vec![PathBuf::from("older.json"), PathBuf::from("old.json")]
        );
    }

    #[test]
    fn a_digest_is_stable_and_depends_on_every_part() {
        let one = digest(&[b"a", b"b"]);
        assert_eq!(one, digest(&[b"a", b"b"]));
        assert_eq!(one.len(), 32);
        assert_ne!(one, digest(&[b"a", b"c"]));
        assert_ne!(one, digest(&[b"ab"]));
        assert_ne!(one, digest(&[b"b", b"a"]));
    }

    #[test]
    fn a_disabled_cache_answers_with_a_miss_and_stores_nothing() {
        let cache = Cache::disabled();
        let files = BTreeMap::new();
        let key = cache.key("mipmap", "mipmap.wgsl", "source", "table");
        assert!(cache.load("mipmap", &key, &files).is_none());
        cache.store(
            "mipmap",
            &key,
            &[],
            &files,
            &BTreeMap::<String, VariantOutput>::new(),
        );
    }
}
