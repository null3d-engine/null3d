import { describe, expect, it } from 'bun:test';
import { changedCrates, parsePush, plan, pushToMain, SKIP_TRAILER, skipReason } from './pre-push';

const MAIN = 'refs/heads/main';
const ZERO = '0000000000000000000000000000000000000000';
const CRATES = new Map([
	['null3d-core', 'null3d-core'],
	['null3d-render', 'null3d-render'],
	['null3d-shaders', 'null3d-shaders'],
]);

describe('pushToMain', () => {
	const line = (remoteRef: string, localSha = 'a1', remoteSha = 'b2') =>
		`refs/heads/work ${localSha} ${remoteRef} ${remoteSha}`;

	it('finds the push to main among the pushed refs', () => {
		const refs = parsePush(`${line('refs/heads/work')}\n${line(MAIN)}\n`);
		expect(refs).toHaveLength(2);
		expect(pushToMain(refs)?.remoteRef).toBe(MAIN);
	});

	it('ignores a push that only saves a branch, and one that deletes main', () => {
		expect(pushToMain(parsePush(line('refs/heads/work')))).toBeUndefined();
		expect(pushToMain(parsePush(line(MAIN, ZERO)))).toBeUndefined();
		expect(pushToMain(parsePush(''))).toBeUndefined();
	});
});

describe('skipReason', () => {
	it('reads the reason that a skip trailer gives', () => {
		const message = `fix: restore main\n\nbody\n\n${SKIP_TRAILER}: main is red and the queue is stopped\n`;
		expect(skipReason(['feat: x', message])).toBe('main is red and the queue is stopped');
	});

	it('does not skip on a trailer without a reason, or on no trailer', () => {
		expect(skipReason([`fix: x\n\n${SKIP_TRAILER}:\n`])).toBeUndefined();
		expect(
			skipReason([`fix: x\n\n${SKIP_TRAILER}:\nDocs-Checked: read the guide`]),
		).toBeUndefined();
		expect(skipReason(['fix: x\n\nDocs-Checked: read the guide'])).toBeUndefined();
	});
});

describe('changedCrates', () => {
	it('names the crates whose files changed', () => {
		const files = [
			'crates/null3d-render/src/output.rs',
			'crates/null3d-core/Cargo.toml',
			'docs/a.md',
		];
		expect(changedCrates(files, CRATES)).toEqual(['null3d-core', 'null3d-render']);
	});

	it('names every crate when the workspace settings change', () => {
		expect(changedCrates(['Cargo.lock'], CRATES)).toEqual([...CRATES.values()].sort());
		expect(changedCrates(['rust-toolchain.toml'], CRATES)).toHaveLength(3);
	});
});

describe('plan', () => {
	const commands = (files: string[], nextest = true) =>
		plan('b2', 'a1', files, CRATES, nextest).map((step) => [step.lane, step.command.join(' ')]);

	it('checks only the messages and trailers of a push that changes no Rust code', () => {
		expect(commands(['packages/engine/src/index.ts', '.dev/x.md'])).toEqual([
			['QUICK', 'bunx commitlint --from b2 --to a1'],
			['QUICK', 'bun tools/hooks/check-trailers.ts b2..a1'],
		]);
	});

	it('compiles the workspace and tests the changed crates, with every failure reported', () => {
		expect(commands(['crates/null3d-render/src/output.rs'])).toEqual([
			['QUICK', 'bunx commitlint --from b2 --to a1'],
			['QUICK', 'bun tools/hooks/check-trailers.ts b2..a1'],
			['CPU_ONLY', 'cargo check --workspace'],
			['CPU_ONLY', 'cargo nextest run --no-fail-fast --profile ci -p null3d-render'],
		]);
	});

	it('runs cargo test without the whole shader build when nextest is missing', () => {
		const steps = commands(['crates/null3d-shaders/src/lib.rs'], false);
		expect(steps.at(-1)?.[1]).toBe(
			'cargo test --no-fail-fast -p null3d-shaders -- --skip the_repository_build_is_the_same_each_time_and_keeps_every_portability_rule',
		);
	});

	it('compiles the workspace for a Rust file outside the crates, with no crate to test', () => {
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs'])).toHaveLength(3);
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs']).at(-1)?.[1]).toBe(
			'cargo check --workspace',
		);
	});
});
