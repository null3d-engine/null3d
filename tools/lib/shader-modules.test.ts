import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixture';
import {
	crateFolders,
	ensureShaderModules,
	inputHash,
	isShaderModule,
	MODULE_DIR,
	moduleHash,
	RECORD,
} from './shader-modules';

/** A repository with the shader crate, its path dependencies and one generated module. */
function repository(): string {
	return fixture({
		'Cargo.toml': '[workspace]\n',
		'Cargo.lock': '',
		'rust-toolchain.toml': '',
		'crates/null3d-shaders/Cargo.toml': '[dependencies]\ngpu = { path = "../null3d-gpu" }\n',
		'crates/null3d-shaders/src/lib.rs': '',
		'crates/null3d-shaders/wgsl/lit.wgsl': 'fn main() {}\n',
		'crates/null3d-shaders/tests/cli.rs': '',
		'crates/null3d-gpu/Cargo.toml': '[dependencies]\ncore = { path = "../null3d-core" }\n',
		'crates/null3d-gpu/src/lib.rs': '',
		'crates/null3d-core/Cargo.toml': '',
		'crates/unrelated/Cargo.toml': '',
		[`${MODULE_DIR}/shaders.ts`]: 'export {};\n',
		[`${MODULE_DIR}/gpu.ts`]: 'export {};\n',
	});
}

describe('the shader modules', () => {
	it('are the main module and the device modules beside it', () => {
		expect(isShaderModule('shaders.ts')).toBe(true);
		expect(isShaderModule('shaders-glsl-draw-index.ts')).toBe(true);
		expect(isShaderModule('gpu.ts')).toBe(false);
		expect(isShaderModule('shaders.ts.map')).toBe(false);
	});

	it('come from the shader crate and the crates it depends on by path', () => {
		expect(crateFolders(repository())).toEqual([
			'crates/null3d-core',
			'crates/null3d-gpu',
			'crates/null3d-shaders',
		]);
	});

	it('are out of date when an input changes, and not when a crate test changes', () => {
		const root = repository();
		const before = inputHash(root);
		writeFileSync(join(root, 'crates/null3d-shaders/tests/cli.rs'), '// another test\n');
		expect(inputHash(root)).toBe(before);
		writeFileSync(join(root, 'crates/null3d-shaders/wgsl/lit.wgsl'), 'fn main() { }\n');
		expect(inputHash(root)).not.toBe(before);
		const gpu = inputHash(root);
		writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), 'pub const A: u32 = 1;\n');
		expect(inputHash(root)).not.toBe(gpu);
	});

	it('hash every module, and none without the main module', () => {
		const root = repository();
		const one = moduleHash(root);
		expect(one).not.toBeNull();
		writeFileSync(join(root, MODULE_DIR, 'shaders-wgsl.ts'), 'export {};\n');
		const two = moduleHash(root);
		expect(two).not.toBe(one);
		writeFileSync(join(root, MODULE_DIR, 'gpu.ts'), 'export const A = 1;\n');
		expect(moduleHash(root)).toBe(two);
		expect(moduleHash(fixture({ [`${MODULE_DIR}/gpu.ts`]: '' }))).toBeNull();
	});

	it('skip the build when the record matches the inputs and the modules', () => {
		const root = repository();
		mkdirSync(join(root, 'target'));
		const record = { inputs: inputHash(root), modules: moduleHash(root) };
		writeFileSync(join(root, RECORD), JSON.stringify(record));
		expect(ensureShaderModules(root)).toBe(false);
	});

	it('run the build when a module changed, and release the lock when the build fails', () => {
		const root = repository();
		mkdirSync(join(root, 'target'));
		const record = { inputs: inputHash(root), modules: moduleHash(root) };
		writeFileSync(join(root, RECORD), JSON.stringify(record));
		writeFileSync(join(root, MODULE_DIR, 'shaders.ts'), 'export const EDITED = 1;\n');
		// The fixture's Rust settings are empty, so the build that the edit starts fails at once, as
		// does a machine without Cargo.
		expect(() => ensureShaderModules(root)).toThrow();
		expect(existsSync(join(root, 'target/shader-modules.lock'))).toBe(false);
	});
});
