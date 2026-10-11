import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connect, ViteDevServer } from 'vite';
import { coreSourcesServer, coreSourcesStamp, STAMP_MODULE, stampGlue } from './core-sources';
import { fixture } from './fixture';

/** A repository with the core's crate, its path dependency and a crate that it does not use. */
function repository(): string {
	return fixture({
		'Cargo.toml': '[workspace]\n',
		'Cargo.lock': '',
		'rust-toolchain.toml': '',
		'crates/null3d-wasm/Cargo.toml': '[dependencies]\ncore = { path = "../null3d-core" }\n',
		'crates/null3d-wasm/src/lib.rs': '',
		'crates/null3d-core/Cargo.toml': '',
		'crates/null3d-core/src/lib.rs': '',
		'crates/null3d-core/tests/rows.rs': '',
		'crates/null3d-shaders/Cargo.toml': '',
		'crates/null3d-shaders/src/lib.rs': '',
	});
}

/** What the dev server answers to a request for `url`: the body it sends, or undefined to pass it on. */
function devServer(root: string): (url: string) => string | undefined {
	let handle: Connect.NextHandleFunction = () => undefined;
	const server = { middlewares: { use: (h: typeof handle) => (handle = h) } };
	const plugin = coreSourcesServer(root);
	(plugin.configureServer as (s: ViteDevServer) => void)(server as unknown as ViteDevServer);
	return (url) => {
		let body: string | undefined;
		const res = { setHeader: () => undefined, end: (text: string) => (body = text) };
		handle({ url } as Connect.IncomingMessage, res as never, () => undefined);
		return body;
	};
}

describe('the stamp of the core sources', () => {
	it('changes with the sources of the core and its path dependencies only', () => {
		const root = repository();
		const before = coreSourcesStamp(root);
		expect(before).toMatch(/^[0-9a-f]{16}$/);
		writeFileSync(join(root, 'crates/null3d-core/tests/rows.rs'), '// another test\n');
		writeFileSync(join(root, 'crates/null3d-shaders/src/lib.rs'), 'pub const A: u32 = 1;\n');
		expect(coreSourcesStamp(root)).toBe(before);
		writeFileSync(join(root, 'crates/null3d-core/src/lib.rs'), 'pub const A: u32 = 1;\n');
		expect(coreSourcesStamp(root)).not.toBe(before);
	});

	it('goes into a generated module as an export', async () => {
		const text = stampGlue('export function batchArrays() { return 0; }\n', '0123456789abcdef');
		const glue = (await import(`data:text/javascript,${encodeURIComponent(text)}`)) as {
			coreSources: string;
		};
		expect(glue.coreSources).toBe('0123456789abcdef');
	});
});

describe('the dev server', () => {
	it('serves the stamp module with the stamp of the checkout, and passes other requests on', () => {
		const root = repository();
		const serve = devServer(root);
		const module = `export const CORE_SOURCES = "${coreSourcesStamp(root)}";\n`;
		expect(serve(`/${STAMP_MODULE}`)).toBe(module);
		expect(serve(`/@fs${root}/${STAMP_MODULE}?import`)).toBe(module);
		expect(serve('/packages/engine/src/shared/core.ts')).toBeUndefined();
	});

	it('serves the new stamp once the core sources change', () => {
		const root = repository();
		const serve = devServer(root);
		const before = serve(`/${STAMP_MODULE}`);
		writeFileSync(join(root, 'crates/null3d-wasm/src/lib.rs'), 'pub const A: u32 = 1;\n');
		const after = serve(`/${STAMP_MODULE}`);
		expect(after).not.toBe(before);
		expect(after).toContain(coreSourcesStamp(root));
	});
});
