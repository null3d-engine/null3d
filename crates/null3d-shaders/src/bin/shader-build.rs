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
