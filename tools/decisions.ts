// Lists the decision records from each record's own title, status and summary, or checks that
// every record has them. Run from the repository root:
//   bun tools/decisions.ts           print the list
//   bun tools/decisions.ts --check   report records without a title, status or summary, and
//                                    numbers that two records share
import { readRecords, recordFiles, recordList } from './lib/decisions';

const { records, problems } = readRecords(recordFiles(process.cwd()));

if (!process.argv.includes('--check')) console.log(recordList(records));
for (const p of problems) console.error(`error: ${p}`);
if (process.argv.includes('--check') && !problems.length)
	console.log(`decision records OK (${records.length} records)`);
if (problems.length) process.exit(1);
