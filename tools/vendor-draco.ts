// Writes Draco's glTF decoder, and its licence, into packages/engine/vendor/draco from the pinned
// release in Draco's repository, unchanged. It fails when a file's SHA-256 differs from the one
// that tools/lib/draco-vendor.ts pins. Run it after a change of the pinned release.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRACO_FILES, DRACO_VENDOR, dracoFileUrl } from './lib/draco-vendor.ts';

mkdirSync(DRACO_VENDOR, { recursive: true });
for (const file of DRACO_FILES) {
	const response = await fetch(dracoFileUrl(file.path));
	if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (sha256 !== file.sha256)
		throw new Error(`${file.path}: SHA-256 ${sha256}, and the pin says ${file.sha256}`);
	writeFileSync(join(DRACO_VENDOR, file.name), bytes);
	console.log(`${file.name}: ${bytes.length} bytes`);
}
