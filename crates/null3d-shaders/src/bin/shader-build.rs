//! The shader build command. It builds every shader variant in the manifest and writes the
//! generated TypeScript modules. `bun run shaders` runs it when the modules are missing or out of
//! date.
//!
//! ```text
//! cargo run -p null3d-shaders --bin shader-build [-- --root <repository>]
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use null3d_shaders::{COMMAND, OUTPUT_DIR, Written};

const USAGE: &str = "usage: shader-build [--root <repository root>]";

fn main() -> ExitCode {
    let mut root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => match args.next() {
                Some(path) => root = PathBuf::from(path),
                None => return usage("--root needs a folder"),
            },
            "--help" | "-h" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            other => return usage(&format!("unknown argument `{other}`")),
        }
    }

    match null3d_shaders::write(&root) {
        Ok(Written::Updated) => println!("Wrote the shader modules in {OUTPUT_DIR}."),
        Ok(Written::Unchanged) => {
            println!("The shader modules in {OUTPUT_DIR} were already up to date.");
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

fn usage(problem: &str) -> ExitCode {
    eprintln!("shader-build: {problem}\n{USAGE}");
    ExitCode::from(2)
}
