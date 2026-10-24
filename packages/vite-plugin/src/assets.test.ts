import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { GltfBuilder } from '../../../tests/pages/lib/gltf-files';
import { fixture } from '../../../tools/lib/fixture';
import {
	ASSET_FOLDER,
	cachedFile,
	cacheFolder,
	fileCodeHash,
	modelKey,
	optimizedModel,
} from './assets';
import null3d from './index';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

const SCENE = join(import.meta.dir, '../../../tests/pages/assets/models/asset-scene.glb');

/** A project with the asset tool's test scene, and a page that imports it optimized. */
function project(): string {
	const root = fixture({
		'package.json': '{"name":"demo","private":true,"type":"module"}',
		'index.html': '<script type="module" src="./main.js"></script>',
		'main.js':
			"import scene from './models.glb?optimized';\ndocument.body.dataset.scene = scene;\n",
	});
	copyFileSync(SCENE, join(root, 'models.glb'));
	return root;
}

describe('optimized models', () => {
	it('optimize once into the cache, and come from the cache after', async () => {
		const root = project();
		const first = await optimizedModel(root, join(root, 'models.glb'));
		expect(first.name).toBe('models.glb');
		const model = join(cacheFolder(root), first.files[0] as string);
		const written = statSync(model).mtimeMs;
		const again = await optimizedModel(root, join(root, 'models.glb'));
		expect(again).toEqual(first);
		expect(statSync(model).mtimeMs).toBe(written);
		expect(first.files.filter((f) => f.startsWith('textures/'))).toHaveLength(3);
		for (const file of first.files) expect(cachedFile(root, file)).toBeDefined();
	});

	it('take a new key when the file or the options change', () => {
		const root = project();
		const file = join(root, 'models.glb');
		const key = modelKey('1.0.0', { lod: false }, [file]);
		expect(modelKey('1.0.0', { lod: true }, [file])).not.toBe(key);
		expect(modelKey('1.0.1', { lod: false }, [file])).not.toBe(key);
		expect(modelKey('1.0.0', { lod: false }, [SCENE, file])).not.toBe(key);
	});

	it('hash the tool code, so a fix to the tool changes the key of every model', () => {
		// The tool's version stays 0.0.0 in the repository, so its version alone left the cache
		// serving models that a pipeline before the fix wrote. The module and the file that shares
		// its name, the WebAssembly one among them, are both part of the code's hash.
		const folder = mkdtempSync(join(tmpdir(), 'null3d-tool-'));
		try {
			const module = join(folder, 'assets.js');
			writeFileSync(module, 'export const VERSION = "0.0.0";\n');
			writeFileSync(join(folder, 'assets.wasm'), 'wasm bytes');
			const before = fileCodeHash(module);
			expect(before).not.toBeNull();
			expect(fileCodeHash(module)).toBe(before);
			writeFileSync(join(folder, 'assets.wasm'), 'other wasm bytes');
			expect(fileCodeHash(module)).not.toBe(before);
			writeFileSync(join(folder, 'assets.js'), 'export const VERSION = "0.0.1";\n');
			expect(fileCodeHash(join(folder, 'missing.js'))).toBeNull();
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});

	it('serve only files inside the cache', () => {
		const root = project();
		for (const path of ['../package.json', 'textures/../../x', '.hidden/a.glb', 'a', 'a/b/c'])
			expect(cachedFile(root, path)).toBeUndefined();
	});

	it('come from the dev server at the address that the import gives', async () => {
		const root = project();
		const server = await createServer({
			root,
			base: '/game/',
			logLevel: 'silent',
			configFile: false,
			server: { middlewareMode: true, hmr: false, ws: false },
			plugins: [null3d({ wgslDeclarations: false })],
		});
		try {
			const module = await server.transformRequest('/models.glb?optimized');
			const address = /"(\/game\/null3d-assets\/[\w-]+\/models\.glb)"/.exec(
				module?.code ?? '',
			)?.[1];
			expect(address).toBeDefined();
			// The plugin's routes on a server of the test's own, at a port that the system picks.
			const http = createHttpServer(server.middlewares).listen(0, '127.0.0.1');
			await new Promise((ready) => http.once('listening', ready));
			const { port } = http.address() as AddressInfo;
			const fetchFile = async (path: string) => {
				const response = await fetch(`http://127.0.0.1:${port}${path}`);
				return {
					type: response.headers.get('content-type') ?? undefined,
					body: Buffer.from(await response.arrayBuffer()),
				};
			};
			const model = await fetchFile(address as string);
			expect(model.type).toBe('model/gltf-binary');
			expect(model.body?.subarray(0, 4).toString()).toBe('glTF');
			const texture = await fetchFile(
				new URL('../textures/x.ktx2', `http://host${address}`).pathname.replace(
					'x.ktx2',
					readdirSync(join(cacheFolder(root), 'textures'))[0] as string,
				),
			);
			expect(texture.type).toBe('image/ktx2');
			http.close();
		} finally {
			await server.close();
		}
	});

	it("go into a build's assets folder, with the import giving the model's address", async () => {
		const root = project();
		await build({
			root,
			logLevel: 'silent',
			configFile: false,
			plugins: [null3d({ wgslDeclarations: false })],
		});
		const out = join(root, 'dist/assets', ASSET_FOLDER);
		const [key] = readdirSync(out).filter((name) => name !== 'textures');
		expect(existsSync(join(out, key as string, 'models.glb'))).toBe(true);
		expect(readdirSync(join(out, 'textures'))).toHaveLength(3);
		const script = readdirSync(join(root, 'dist/assets')).find((f) => f.endsWith('.js')) as string;
		expect(readFileSync(join(root, 'dist/assets', script), 'utf8')).toContain(
			`${ASSET_FOLDER}/${key}/models.glb`,
		);
	});
});

describe('staged levels in a project', () => {
	/** Writes a grid of 288 triangles, which the tool gives levels and so stages. */
	function gridModel(path: string): void {
		const side = 12;
		const positions = new Float32Array((side + 1) * (side + 1) * 3);
		const indices: number[] = [];
		for (let z = 0; z <= side; z++)
			for (let x = 0; x <= side; x++)
				positions.set([x * 0.5, Math.sin(x * 0.4) * 0.3, z * 0.5], (z * (side + 1) + x) * 3);
		for (let z = 0; z < side; z++)
			for (let x = 0; x < side; x++) {
				const a = z * (side + 1) + x;
				const b = a + 1;
				const c = a + side + 1;
				const d = c + 1;
				indices.push(a, c, b, b, c, d);
			}
		const builder = new GltfBuilder();
		builder.node(
			{
				name: 'ground',
				mesh: builder.mesh([
					{
						attributes: { POSITION: builder.positions(positions) },
						indices: builder.accessor(new Uint32Array(indices), 1),
					},
				]),
			},
			true,
		);
		writeFileSync(path, builder.glb());
	}

	it('writes the stages beside the model in the cache, and serves each of them', async () => {
		const root = project();
		const file = join(root, 'terrain.glb');
		gridModel(file);
		const model = await optimizedModel(root, file, { lod: true, stages: true });
		const stages = model.files.filter((f) => f.endsWith('.bin'));
		expect(stages.length).toBeGreaterThan(0);
		for (const stage of stages) expect(cachedFile(root, stage)).toBeDefined();
		// A cache hit names the same files, which the model's own extras give it.
		const again = await optimizedModel(root, file, { lod: true, stages: true });
		expect(again.files).toEqual(model.files);
	});

	it('writes the levels into the model when the stages are off', async () => {
		const root = project();
		const file = join(root, 'terrain.glb');
		gridModel(file);
		const model = await optimizedModel(root, file, { lod: true });
		expect(model.files.filter((f) => f.endsWith('.bin'))).toEqual([]);
	});
});
