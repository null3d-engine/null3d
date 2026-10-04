import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	LOCK_PATH,
	MANIFEST_PATH,
	manifestProblems,
	namedSamples,
	optimizedSampleFile,
	readLock,
	readSampleManifest,
	repositoryRoot,
	type SampleManifest,
	sampleFileFor,
	sampleProblems,
	samplesCacheRoot,
	sha256,
	verifyFiles,
} from './samples';

const repoRoot = join(import.meta.dir, '../..');

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'null3d-samples-test-'));
}

/** A manifest of one CC BY asset with one file, as the sample-assets repository writes it. */
function manifestOf(
	bytes: Uint8Array,
	overrides: Partial<SampleManifest['assets'][number]> = {},
): SampleManifest {
	return {
		version: 1,
		licenses: {
			'CC-BY-4.0': {
				name: 'CC BY 4.0',
				url: 'https://creativecommons.org/licenses/by/4.0/',
				file: 'LICENSES/CC-BY-4.0.txt',
			},
		},
		assets: [
			{
				id: 'khronos/Box',
				title: 'Box',
				purpose: 'A test',
				authors: [{ name: 'Someone' }],
				license: ['CC-BY-4.0'],
				source: 'https://example.com/box',
				fetched: '2026-10-03',
				changes: 'None.',
				dir: 'sources/khronos/Box',
				files: [
					{ path: 'sources/khronos/Box/Box.glb', bytes: bytes.length, sha256: sha256(bytes) },
				],
				...overrides,
			},
		],
	};
}

describe('the pinned sample content', () => {
	it('names one full commit of the sample-assets repository', () => {
		const lock = readLock(repoRoot);
		expect(lock.repository).toBe('null3d-engine/sample-assets');
		expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	it('gives every asset an accepted licence, its attribution and a SHA-256 for each file', () => {
		expect(manifestProblems(readSampleManifest(repoRoot))).toEqual([]);
	});

	it('pins every sample file that a test, benchmark or demo names, with its checksum and licence', () => {
		expect(sampleProblems(readSampleManifest(repoRoot), namedSamples(repoRoot))).toEqual([]);
	});
});

describe('sampleProblems', () => {
	const bytes = new Uint8Array([1, 2, 3]);
	const at = { file: 'tests/pages/gltf.ts', line: 4 };

	it('accepts a pinned file of a licensed, attributed asset', () => {
		expect(
			sampleProblems(manifestOf(bytes), [{ ...at, path: 'sources/khronos/Box/Box.glb' }]),
		).toEqual([]);
	});

	it('reports a file that the manifest does not list', () => {
		const problems = sampleProblems(manifestOf(bytes), [
			{ ...at, path: 'sources/khronos/Box/Other.glb' },
		]);
		expect(problems[0]).toContain('tests/pages/gltf.ts:4: sources/khronos/Box/Other.glb is not in');
	});

	it('reports a name that is not a string literal', () => {
		expect(sampleProblems(manifestOf(bytes), [{ ...at, path: null }])[0]).toContain(
			'string literal',
		);
	});

	it('reports a non-commercial licence, missing attribution and a missing checksum', () => {
		const manifest = manifestOf(bytes, { license: ['CC-BY-NC-4.0'], fetched: '', authors: [] });
		const file = manifest.assets[0]?.files[0];
		if (file) file.sha256 = '';
		const problems = sampleProblems(manifest, [{ ...at, path: 'sources/khronos/Box/Box.glb' }]);
		expect(problems.join('\n')).toContain('licence CC-BY-NC-4.0 is not accepted');
		expect(problems.join('\n')).toContain('no author');
		expect(problems.join('\n')).toContain('no fetch date');
		expect(problems.join('\n')).toContain('no SHA-256');
	});
});

describe('namedSamples', () => {
	it('finds string literal names and flags computed ones', () => {
		const root = scratch();
		try {
			mkdirSync(join(root, 'tests'));
			writeFileSync(
				join(root, 'tests', 'page.ts'),
				[
					"const a = samplePath('sources/a.glb');",
					'const b = sampleUrl("sources/b.hdr");',
					`const c = sampleUrl(\`sources/\${name}.glb\`);`,
					"import d from '/samples/sources/d.glb?optimized';",
					'const e = sampleUrl("sources/e.glb");',
				].join('\n'),
			);
			mkdirSync(join(root, 'tests', 'node_modules'));
			writeFileSync(join(root, 'tests', 'node_modules', 'x.ts'), "samplePath('ignored');");
			expect(namedSamples(root, ['tests'])).toEqual([
				{ file: 'tests/page.ts', line: 1, path: 'sources/a.glb' },
				{ file: 'tests/page.ts', line: 2, path: 'sources/b.hdr' },
				{ file: 'tests/page.ts', line: 3, path: null },
				{ file: 'tests/page.ts', line: 4, path: 'sources/d.glb' },
				{ file: 'tests/page.ts', line: 5, path: 'sources/e.glb' },
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('verifyFiles', () => {
	it('accepts a copy that matches the manifest and reports changed, missing and foreign files', () => {
		const dir = scratch();
		try {
			const bytes = new Uint8Array([7, 8, 9]);
			const manifest = manifestOf(bytes);
			const text = new TextEncoder().encode(JSON.stringify(manifest));
			mkdirSync(join(dir, 'sources/khronos/Box'), { recursive: true });
			writeFileSync(join(dir, 'manifest.json'), text);
			writeFileSync(join(dir, 'sources/khronos/Box/Box.glb'), bytes);
			expect(verifyFiles(dir, manifest, text)).toEqual([]);

			writeFileSync(join(dir, 'sources/khronos/Box/Box.glb'), new Uint8Array([7, 8, 0]));
			expect(verifyFiles(dir, manifest, text)).toEqual([
				'sources/khronos/Box/Box.glb: SHA-256 differs',
			]);

			rmSync(join(dir, 'sources/khronos/Box/Box.glb'));
			writeFileSync(join(dir, 'manifest.json'), '{}');
			expect(verifyFiles(dir, manifest, text)).toEqual([
				`manifest.json differs from ${MANIFEST_PATH}`,
				'sources/khronos/Box/Box.glb: missing',
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('samplesCacheRoot', () => {
	it('uses NULL3D_SAMPLES_DIR, then the user cache folder', () => {
		expect(samplesCacheRoot({ NULL3D_SAMPLES_DIR: '/data/samples', XDG_CACHE_HOME: '/c' })).toBe(
			'/data/samples',
		);
		expect(samplesCacheRoot({ XDG_CACHE_HOME: '/c' })).toBe(join('/c', 'null3d', 'samples'));
	});
});

describe('repositoryRoot', () => {
	it('finds the lock from a folder inside the repository', () => {
		expect(repositoryRoot(join(repoRoot, 'tests', 'pages'))).toBe(repoRoot);
		expect(readFileSync(join(repositoryRoot(repoRoot), LOCK_PATH), 'utf8')).toContain(
			'sample-assets',
		);
	});
});

describe('sampleFileFor', () => {
	it('maps an address to a pinned file and refuses anything else', () => {
		const first = readSampleManifest(repoRoot).assets[0]?.files[0];
		expect(first).toBeDefined();
		if (!first) return;
		const encoded = first.path.split('/').map(encodeURIComponent).join('/');
		expect(sampleFileFor(repoRoot, `/samples/${encoded}?v=1`)).toEqual(first);
		expect(sampleFileFor(repoRoot, '/samples/../package.json')).toBeNull();
		expect(sampleFileFor(repoRoot, '/samples/%E0%A4%A')).toBeNull();
		expect(sampleFileFor(repoRoot, `/other/${first.path}`)).toBeNull();
	});
});

describe('optimizedSampleFile', () => {
	it('resolves an optimized import of a pinned file to the cache, and says what is wrong otherwise', () => {
		const first = readSampleManifest(repoRoot).assets[0]?.files[0];
		expect(first).toBeDefined();
		if (!first) return;
		const cache = scratch();
		const before = process.env.NULL3D_SAMPLES_DIR;
		process.env.NULL3D_SAMPLES_DIR = cache;
		try {
			const id = `/samples/${first.path}?optimized`;
			expect(optimizedSampleFile(repoRoot, `/samples/${first.path}`)).toBeNull();
			expect(optimizedSampleFile(repoRoot, `/models/${first.path}?optimized`)).toBeNull();
			expect(() => optimizedSampleFile(repoRoot, id)).toThrow('run bun run samples:fetch');
			expect(() => optimizedSampleFile(repoRoot, '/samples/sources/none.glb?optimized')).toThrow(
				`is not in ${MANIFEST_PATH}`,
			);
			const full = join(cache, readLock(repoRoot).commit, first.path);
			mkdirSync(join(full, '..'), { recursive: true });
			writeFileSync(full, new Uint8Array([1]));
			expect(optimizedSampleFile(repoRoot, id)).toBe(`${full}?optimized`);
		} finally {
			if (before === undefined) delete process.env.NULL3D_SAMPLES_DIR;
			else process.env.NULL3D_SAMPLES_DIR = before;
			rmSync(cache, { recursive: true, force: true });
		}
	});
});
