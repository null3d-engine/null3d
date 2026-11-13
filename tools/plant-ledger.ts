// `bun run plants:ledger <path...>`: prints the plant review's species by row table and its total
// from the verdict files of run folders, and ends with status 1 when a verdict is unsound. A path
// is a run folder or a folder of run folders. The total's base is always the standard's twenty
// species times twelve rows. `--json` prints the ledger as JSON.
import { flag, positionals } from './lib/plant-review/cli.ts';
import { ledgerOf, ledgerText } from './lib/plant-review/ledger.ts';

const paths = positionals(new Set(['--json']));
if (paths.length === 0) {
	console.error(
		'Name the runs to count: bun run plants:ledger <run folder, or folder of run folders>... [--json]',
	);
	process.exit(2);
}
const ledger = ledgerOf(paths);
console.log(flag('json') ? JSON.stringify(ledger, null, '\t') : ledgerText(ledger));
process.exit(ledger.faults.length > 0 ? 1 : 0);
