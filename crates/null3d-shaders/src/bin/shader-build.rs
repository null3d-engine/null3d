//! The shader build command. It builds every shader variant in the manifest and writes the
//! generated TypeScript modules. `bun run shaders` runs it when the modules are missing or out of
//! date, with a per-entry cache so a change to one shader compiles only that shader.
//!
//! ```text
//! cargo run --profile shader -p null3d-shaders --bin shader-build [-- --root <repository>]
//!     [--cache <folder>] [--stamp <stamp>] [--no-cache]
//! ```
//!
//! `--cache` keeps each entry's compiled output in the folder, under the key that `--stamp` names:
//! the fingerprint of the compiler. A later run reuses an entry when its own source, its manifest
//! table and the library modules it imports are unchanged. `--no-cache`, or setting
//! `NULL3D_NO_SHADER_CACHE=1`, compiles every entry again.

use std::path::PathBuf;
use std::process::ExitCode;

use null3d_shaders::{COMMAND, Cache, CacheStats, OUTPUT_DIR, Written};

const USAGE: &str = "usage: shader-build [--root <repository root>] [--cache <folder> [--stamp <stamp>]] [--no-cache]";

/// The environment variable that turns the cache off, as the Vite plugin's cache names it.
const NO_CACHE_ENV: &str = "NULL3D_NO_SHADER_CACHE";

fn main() -> ExitCode {
    let mut root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let mut cache_folder: Option<PathBuf> = None;
    let mut stamp = String::new();
    let mut no_cache = cache_off();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => match args.next() {
                Some(path) => root = PathBuf::from(path),
                None => return usage("--root needs a folder"),
            },
            "--cache" => match args.next() {
                Some(path) => cache_folder = Some(PathBuf::from(path)),
                None => return usage("--cache needs a folder"),
            },
            "--stamp" => match args.next() {
                Some(value) => stamp = value,
                None => return usage("--stamp needs a value"),
            },
            "--no-cache" => no_cache = true,
            "--help" | "-h" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            other => return usage(&format!("unknown argument `{other}`")),
        }
    }

    let cache = match (no_cache, cache_folder) {
        (false, Some(folder)) => Cache::at(&folder, &stamp),
        _ => Cache::disabled(),
    };

    match null3d_shaders::write_cached(&root, &cache) {
        Ok((Written::Updated, stats)) => {
            println!("Wrote the shader modules in {OUTPUT_DIR}.");
            report(&stats);
        }
        Ok((Written::Unchanged, stats)) => {
            println!("The shader modules in {OUTPUT_DIR} were already up to date.");
            report(&stats);
        }
        Err(error) => {
            eprintln!("{error}\n");
            eprintln!(
                "The shader build failed with {} problem(s). Fix them, then run `{COMMAND}` again.",
                error.problems.len()
            );
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}

/// True when the environment turns the cache off, as `NULL3D_NO_SHADER_CACHE=1` asks.
fn cache_off() -> bool {
    std::env::var_os(NO_CACHE_ENV).is_some_and(|value| value == "1")
}

/// Prints how many entries the run compiled and how many it reused. A run with the cache off
/// reuses none, and says so.
fn report(stats: &CacheStats) {
    println!(
        "The shader build compiled {} entries and reused {}.",
        stats.compiled, stats.reused
    );
}

fn usage(problem: &str) -> ExitCode {
    eprintln!("shader-build: {problem}\n{USAGE}");
    ExitCode::from(2)
}
