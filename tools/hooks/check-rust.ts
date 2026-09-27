// Pre-commit guard: a commit that stages Rust code or Cargo settings must pass rustfmt and Clippy,
// with every warning treated as an error. The WebAssembly builds and browser tests take minutes,
// so they run in CI instead.
import { execFileSync } from 'node:child_process';
import { stagedFiles } from './commit-ack';

const RUST_SETTINGS = new Set(['clippy.toml', 'rust-toolchain.toml', 'rustfmt.toml']);

/** True when any of the files is Rust source or changes how Rust code builds or lints. */
export function touchesRust(files: string[]): boolean {
	return files.some(
		(f) => f.endsWith('.rs') || /(^|\/)Cargo\.(toml|lock)$/.test(f) || RUST_SETTINGS.has(f),
	);
}

function main(): void {
	if (!touchesRust(stagedFiles())) return;
	try {
		execFileSync('cargo', ['fmt', '--all', '--check'], { stdio: 'inherit' });
		execFileSync('cargo', ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'], {
			stdio: 'inherit',
		});
	} catch {
		console.error(
			'\ncommit rejected: the Rust code is not formatted or Clippy found a problem (above).',
		);
		console.error('Run `cargo fmt --all` and fix the Clippy findings, then commit again.\n');
		process.exit(1);
	}
}

if (import.meta.main) main();
