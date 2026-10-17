// Writes the built shader set as one release asset, and the record that the engine package carries
// so that the Vite plugin can download and verify it. Run from the repository root:
//   bun tools/shader-artifact.ts create --tag <tag> [--out <file>]
//       Write the archive of the shader modules in packages/engine/src/generated, and print its
//       SHA-256. The file defaults to target/<tag>-shaders.tar.br.
//   bun tools/shader-artifact.ts write --tag <tag> --repo <owner/name>
//       (--archive <file> | --sha256 <hex>) [--out <file>]
//       Write the engine package's record of the release asset. The archive's hash is read from the
//       file, or taken from the release job that wrote it. The record defaults to
//       packages/engine/lib/shader-artifact.json.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
	createShaderArchive,
	hashFile,
	shaderArtifactFile,
	shaderArtifactRecord,
	writeShaderArtifact,
} from './lib/shader-artifact';

const root = join(import.meta.dirname, '..');

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		options: {
			tag: { type: 'string' },
			repo: { type: 'string' },
			out: { type: 'string' },
			archive: { type: 'string' },
			sha256: { type: 'string' },
		},
		allowPositionals: true,
	});
	const command = positionals[0];
	const need = (value: string | undefined, name: string): string => {
		if (value === undefined || value === '')
			fail(`--${name} is required for the ${command ?? 'tool'} command`);
		return value;
	};
	const tag = need(values.tag, 'tag');

	if (command === 'create') {
		if (positionals.length !== 1)
			fail('usage: bun tools/shader-artifact.ts create --tag <tag> [--out <file>]');
		const out = values.out ?? join(root, 'target', shaderArtifactFile(tag));
		const sha256 = await createShaderArchive(root, out);
		console.log(sha256);
		return;
	}
	if (command === 'write') {
		if (positionals.length !== 1)
			fail(
				'usage: bun tools/shader-artifact.ts write --tag <tag> --repo <owner/name> (--archive <file> | --sha256 <hex>) [--out <file>]',
			);
		if ((values.archive === undefined) === (values.sha256 === undefined))
			fail(
				'give one of --archive, which is hashed here, or --sha256, which the release job measured',
			);
		const record = shaderArtifactRecord({
			tag,
			repo: need(values.repo, 'repo'),
			sha256: values.archive ? hashFile(values.archive) : need(values.sha256, 'sha256'),
		});
		const out = values.out ?? join(root, 'packages/engine/lib/shader-artifact.json');
		writeShaderArtifact(out, record);
		console.log(`${out}: ${JSON.stringify(record)}`);
		return;
	}
	fail('the commands are create and write');
}

main().catch((e: Error) => fail(e.message));
