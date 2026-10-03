import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
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
