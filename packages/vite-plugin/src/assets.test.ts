import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import { ASSET_FOLDER, cachedFile, cacheFolder, modelKey, optimizedModel } from './assets';
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
