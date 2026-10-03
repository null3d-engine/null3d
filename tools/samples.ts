// Fetches the sample content at the pinned commit into the cache that every copy of the repository
// shares, and checks each file's size and SHA-256 against the pinned manifest:
//   bun run samples:fetch                 download once, then reuse the checked copy
//   bun run samples:fetch --verify        hash the cached copy's files again
//   bun run samples:fetch --pin <ref>     pin another commit or branch of sample-assets, then fetch it
// NULL3D_SAMPLES_DIR moves the cache. `.dev/sample-content.md` explains the layout and the rules.
import { join } from 'node:path';
import { fetchSamples, LOCK_PATH, pinSamples } from './lib/samples.ts';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const pin = args.indexOf('--pin');
if (pin >= 0) {
	const ref = args[pin + 1];
	if (!ref) throw new Error('--pin needs a commit or a branch of the sample-assets repository');
	const commit = await pinSamples(root, ref);
	console.log(`Pinned ${commit} in ${LOCK_PATH}.`);
}
const dir = await fetchSamples(root, { verify: args.includes('--verify') });
console.log(`Sample content is ready in ${dir}`);
