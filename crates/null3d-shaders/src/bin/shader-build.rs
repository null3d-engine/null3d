//! The shader build command. It builds every shader variant in the manifest and writes the
//! generated TypeScript module, or with `--check` fails when the committed module is out of date.
//!
//! ```text
//! cargo run -p null3d-shaders --bin shader-build [-- --check] [-- --root <repository>]
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use null3d_shaders::{COMMAND, OUTPUT_PATH, Written};

const USAGE: &str = "usage: shader-build [--check] [--root <repository root>]";

fn main() -> ExitCode {
    let mut check = false;
    let mut root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => check = true,
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

    let result = if check {
        null3d_shaders::check(&root).map(|()| format!("{OUTPUT_PATH} is up to date."))
    } else {
        null3d_shaders::write(&root).map(|written| match written {
            Written::Updated => format!("Wrote {OUTPUT_PATH}."),
            Written::Unchanged => format!("{OUTPUT_PATH} was already up to date."),
        })
    };
    match result {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}\n");
            eprintln!(
                "The shader build failed with {} problem(s). Fix them, then run `{COMMAND}` again.",
                error.problems.len()
            );
            ExitCode::FAILURE
        }
    }
}

fn usage(problem: &str) -> ExitCode {
    eprintln!("shader-build: {problem}\n{USAGE}");
    ExitCode::from(2)
}
