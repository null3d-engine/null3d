// `bun run plants:ledger <path...>`: prints the plant review's species by row table and its total
// from verdict files, and ends with status 1 when a verdict is unsound. A path is a verdict file, a
// run folder that holds one, or a folder of either. `--species a,b,c` names the species the count
// must hold, so a species with no verdict stops it, and `--json` prints the ledger as JSON.
import { flag, positionals } from './lib/plant-review/cli.ts';
import { ledgerOf, ledgerText } from './lib/plant-review/ledger.ts';

const paths = positionals(new Set(['--json']));
if (paths.length === 0) {
	console.error(
		'Name the verdict files to count: bun run plants:ledger <verdict file, run folder or folder of them> [--species a,b,c] [--json]',
	);
	process.exit(2);
}
const at = process.argv.indexOf('--species');
const expected = at >= 0 ? process.argv[at + 1]?.split(',').filter(Boolean) : undefined;
const ledger = ledgerOf(paths, expected);
console.log(flag('json') ? JSON.stringify(ledger, null, '\t') : ledgerText(ledger));
process.exit(ledger.faults.length > 0 ? 1 : 0);
