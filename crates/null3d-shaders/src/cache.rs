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
//! Only the build command, which runs natively, reads and writes the cache. The shader compiler
//! that a page or a bundler loads is built for WebAssembly, where the cache is off and its file
//! code and JSON leave no trace.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[cfg(not(target_arch = "wasm32"))]
use serde::{Deserialize, Serialize};
#[cfg(not(target_arch = "wasm32"))]
use std::fs;

use crate::VariantOutput;

/// The version of the cache's file format and key. Bump it when either changes, so an entry an
/// older format wrote is never read with a new meaning.
const FORMAT: &str = "1";

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
    /// dependency's contents match. `files` are the shader sources by path relative to the shader
    /// folder.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(
        &self,
        name: &str,
        key: &str,
        files: &BTreeMap<String, String>,
    ) -> Option<BTreeMap<String, VariantOutput>> {
        let folder = self.folder.as_ref()?;
        let text = fs::read_to_string(folder.join(entry_file(name))).ok()?;
        let entry: Entry = serde_json::from_str(&text).ok()?;
        if entry.key != key {
            return None;
        }
        for dep in &entry.deps {
            if digest(&[files.get(&dep.file)?.as_bytes()]) != dep.hash {
                return None;
            }
        }
        Some(entry.variants)
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
        let Some(folder) = self.folder.as_ref() else {
            return;
        };
        let deps: Vec<Dep> = deps
            .iter()
            .filter_map(|file| {
                files.get(file).map(|source| Dep {
                    file: file.clone(),
                    hash: digest(&[source.as_bytes()]),
                })
            })
            .collect();
        let entry = Entry {
            key: key.to_owned(),
            deps,
            variants: variants.clone(),
        };
        let Ok(text) = serde_json::to_string(&entry) else {
            return;
        };
        if fs::create_dir_all(folder).is_err() {
            return;
        }
        let file = folder.join(entry_file(name));
        let staging = folder.join(format!("{}.{}.tmp", entry_file(name), std::process::id()));
        // Write the entry whole or not at all, so a stopped run leaves no half entry.
        if fs::write(&staging, text).is_ok() {
            let _ = fs::rename(&staging, &file);
        }
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
}

/// One entry as the cache stores it.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Deserialize, Serialize)]
struct Entry {
    /// The key the entry was written under.
    key: String,
    /// The library files the entry used, with the hash of each.
    deps: Vec<Dep>,
    /// The compiled variants by build name.
    variants: BTreeMap<String, VariantOutput>,
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

/// The file name of one entry's cache file.
#[cfg(not(target_arch = "wasm32"))]
fn entry_file(name: &str) -> String {
    format!("{name}.json")
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
