//! The shader build command. It builds every shader variant in the manifest and writes the
//! generated TypeScript modules. `bun run shaders` runs it when the modules are missing or out of
//! date, with a per-entry cache so a change to one shader compiles only that shader.
//!
//! ```text
//! cargo run --profile shader -p null3d-shaders --bin shader-build [-- --root <repository>]
//!     [--cache <folder>] [--stamp <stamp>] [--no-cache] [--entries-shard <i>/<n>]
//! ```
//!
//! `--cache` keeps each entry's compiled output in the folder, under the key that `--stamp` names:
//! the fingerprint of the compiler. A later run reuses an entry when its own source, its manifest
//! table and the library modules it imports are unchanged. `--no-cache`, or setting
//! `NULL3D_NO_SHADER_CACHE=1`, compiles every entry again.
//!
//! `--entries-shard i/n` compiles only shard `i` of `n`, counted from 0, of the manifest's
//! entries, split by estimated build cost (`ShardPlan::by_build`), into the cache, and writes no
//! module. An entry that costs more than an even share goes to the shards in parts, and the cache
//! keeps each part beside the whole entry's key. An entry keeps its key in a shard: the key reads
//! only the entry's own source, its manifest table and the compiler's stamp, and the narrowed
//! inputs keep the library modules whole. So several machines can each fill the cache with one
//! shard, and a later build that finds every entry, or every part of it, in the cache compiles
//! none.

use std::path::PathBuf;
use std::process::ExitCode;

use null3d_shaders::{
    BuildError, COMMAND, Cache, CacheStats, Inputs, OUTPUT_DIR, Shard, ShardPlan, Written,
};

const USAGE: &str = "usage: shader-build [--root <repository root>] [--cache <folder> [--stamp <stamp>]] [--no-cache] [--entries-shard <i>/<n>]";

/// The environment variable that turns the cache off, as the Vite plugin's cache names it.
const NO_CACHE_ENV: &str = "NULL3D_NO_SHADER_CACHE";

fn main() -> ExitCode {
    let mut root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let mut cache_folder: Option<PathBuf> = None;
    let mut stamp = String::new();
    let mut no_cache = cache_off();
    let mut entries_shard: Option<Shard> = None;
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
            "--entries-shard" => match args.next().as_deref().map(Shard::parse) {
                Some(Some(shard)) => entries_shard = Some(shard),
                _ => {
                    return usage(
                        "--entries-shard needs a shard as <i>/<n>, with i from 0 and below n",
                    );
                }
            },
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
    if let Some(shard) = entries_shard {
        if !cache.is_on() {
            return usage("--entries-shard fills the cache, so it needs --cache and no --no-cache");
        }
        return build_entries_shard(&root, &cache, shard);
    }

    // The progress line ends before the result is printed, so the result starts on its own line.
    let outcome = {
        let progress = Progress::new();
        null3d_shaders::write_cached_reporting(&root, &cache, &|done, total| {
            progress.report(done, total)
        })
    };
    match outcome {
        Ok((Written::Updated, stats)) => {
            println!("Wrote the shader modules in {OUTPUT_DIR}.");
            report(&stats);
        }
        Ok((Written::Unchanged, stats)) => {
            println!("The shader modules in {OUTPUT_DIR} were already up to date.");
            report(&stats);
        }
        Err(error) => return failed(&error),
    }
    ExitCode::SUCCESS
}

/// Compiles the entries of one shard into the cache, and writes no module.
fn build_entries_shard(root: &std::path::Path, cache: &Cache, shard: Shard) -> ExitCode {
    let outcome = Inputs::read(root).and_then(|inputs| {
        let plan = ShardPlan::by_build(&inputs, shard.count)?;
        print!("This run fills the cache with shard {shard} of the shader entries.\n{plan}");
        let progress = Progress::new();
        null3d_shaders::build_with_cache_reporting(
            &plan.inputs(&inputs, shard.index),
            cache,
            &|done, total| progress.report(done, total),
        )
        .map(|(_, stats)| stats)
    });
    match outcome {
        Ok(stats) => {
            println!("Stored shard {shard} of the shader entries in the cache.");
            report(&stats);
            ExitCode::SUCCESS
        }
        Err(error) => failed(&error),
    }
}

/// Prints the build's problems, and how to run it again once they are fixed.
fn failed(error: &BuildError) -> ExitCode {
    eprintln!("{error}\n");
    eprintln!(
        "The shader build failed with {} problem(s). Fix them, then run `{COMMAND}` again.",
        error.problems.len()
    );
    ExitCode::FAILURE
}

/// Shows how much of the build is done, on standard error, so the report on standard output stays
/// clean. A terminal gets one line that it rewrites, at each whole percent. Any other stream gets
/// a line at each tenth, so a build log shows steady progress without flooding.
struct Progress {
    started: std::time::Instant,
    /// The highest percent already shown; the lock is what keeps two workers' lines apart.
    shown: std::sync::Mutex<usize>,
    terminal: bool,
}

impl Progress {
    #[allow(clippy::disallowed_methods)] // The build command runs natively and never in a page.
    fn new() -> Self {
        use std::io::IsTerminal;
        Self {
            started: std::time::Instant::now(),
            shown: std::sync::Mutex::new(0),
            terminal: std::io::stderr().is_terminal(),
        }
    }

    fn report(&self, done: usize, total: usize) {
        if total == 0 {
            return;
        }
        let percent = done * 100 / total;
        let step = if self.terminal { 1 } else { 10 };
        let Ok(mut shown) = self.shown.lock() else {
            return;
        };
        if percent < *shown + step && done < total {
            return;
        }
        *shown = percent;
        let seconds = self.started.elapsed().as_secs();
        if self.terminal {
            // The trailing spaces clear the digits of a longer earlier line.
            eprint!("\rBuilding shaders: {percent:3}% ({done} of {total}, {seconds}s)   ");
        } else {
            eprintln!("Building shaders: {percent}% ({done} of {total}, {seconds}s)");
        }
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        if self.terminal && *self.shown.lock().unwrap_or_else(|e| e.into_inner()) > 0 {
            eprintln!();
        }
    }
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
