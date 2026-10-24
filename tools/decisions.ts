// Lists the decision records from each record's own title, status and summary, or checks that
// every record has them, or names the next number no branch holds. Run from the repository root:
//   bun tools/decisions.ts           print the list
//   bun tools/decisions.ts --check   report records without a title, status or summary, and
//                                    numbers that two records share
//   bun tools/decisions.ts --next    print the first number that this tree and every local
//                                    branch leave free, so a branch started hours ago does not
//                                    claim one that a landing has taken since
import { execFileSync } from 'node:child_process';
import { readRecords, recordFiles, recordList } from './lib/decisions';

const numberIn = (path: string): number | undefined => {
	const match = path.match(/D-(\d+)-/);
	return match ? Number(match[1]) : undefined;
};

/** Every record number this tree holds, and every one a local branch holds. */
function everyNumber(root: string): number[] {
	const numbers: number[] = [];
	for (const path of recordFiles(root).keys()) {
		const number = numberIn(path);
		if (number !== undefined) numbers.push(number);
	}
	let branches: string[] = [];
	try {
		branches = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
			cwd: root,
			encoding: 'utf8',
		})
			.split('\n')
			.filter((name) => name.length > 0);
	} catch {
		return numbers;
	}
	for (const branch of branches) {
		let files: string[] = [];
		try {
			files = execFileSync(
				'git',
				['ls-tree', '-r', '--name-only', branch, '--', '.dev/decisions'],
				{
					cwd: root,
					encoding: 'utf8',
				},
			).split('\n');
		} catch {
			continue;
		}
		for (const path of files) {
			const number = numberIn(path);
			if (number !== undefined) numbers.push(number);
		}
	}
	return numbers;
}

if (process.argv.includes('--next')) {
	const numbers = everyNumber(process.cwd());
	console.log(`D-${Math.max(0, ...numbers) + 1}`);
	process.exit(0);
}

const { records, problems } = readRecords(recordFiles(process.cwd()));

if (!process.argv.includes('--check')) console.log(recordList(records));
for (const p of problems) console.error(`error: ${p}`);
if (process.argv.includes('--check') && !problems.length)
	console.log(`decision records OK (${records.length} records)`);
if (problems.length) process.exit(1);
