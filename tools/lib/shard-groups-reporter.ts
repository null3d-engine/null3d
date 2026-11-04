// A Playwright reporter for tools/shard-weights.ts. With `playwright test --list`, it prints the tests
// in the groups, and the order of groups, that Playwright splits between shards. Playwright orders a
// project's groups by the worker that each needs before their files, so a file whose options start a
// worker of its own runs after the files that share the default one, and the order of `--list` is
// not the shards' order. A shard takes each group whole, where its first test falls. Each group starts
// with a `#group` line, and each test follows on a line as the list reporter writes it. The grouping
// repeats Playwright's own, and reads fields of its test objects, so a Playwright upgrade may need it
// changed; it stops with an error when they are gone. Playwright is installed for the tests only, so
// the types below name just what the reporter reads.
import { relative } from 'node:path';

/** The variable that gives the count of shards, which sizes the groups of parallel tests with hooks. */
export const SHARD_TOTAL_ENV = 'NULL3D_SHARD_TOTAL';

/** The line that starts each group. */
export const GROUP_LINE = '#group';

/** The fields of Playwright's suite objects that the grouping reads. */
interface Suite {
	suites: Suite[];
	parent?: Suite;
	allTests(): TestCase[];
	_parallelMode?: string;
	_hooks?: { type: string }[];
}

/** The fields of Playwright's test objects that the grouping and the lines read. */
interface TestCase {
	parent: Suite;
	location: { file: string; line: number; column: number };
	titlePath(): string[];
	_workerHash?: string;
	_requireFile?: string;
}

/** The field of Playwright's configuration that the lines read. */
interface FullConfig {
	rootDir: string;
}

/** One file's tests of one worker, sorted into the kinds of group that Playwright makes. */
interface FileTests {
	inOrder: TestCase[];
	parallel: Map<Suite | TestCase, TestCase[]>;
	parallelWithHooks: TestCase[];
}

/**
 * A project's groups in Playwright's order: by worker, then by file. In a file, the tests that run in
 * order come first as one group, then each parallel test, or each serial suite inside a parallel one,
 * as a group of its own. Parallel tests with `beforeAll` or `afterAll` hooks share groups of about
 * their count over `parallelism`.
 */
function groupsOf(project: Suite, parallelism: number): TestCase[][] {
	const byWorker = new Map<string, Map<string, FileTests>>();
	for (const test of project.allTests()) {
		if (test._workerHash === undefined || test._requireFile === undefined)
			throw new Error(
				"Playwright's test objects no longer have the fields that the shard grouping reads; update tools/lib/shard-groups-reporter.ts",
			);
		let files = byWorker.get(test._workerHash);
		if (!files) {
			files = new Map();
			byWorker.set(test._workerHash, files);
		}
		let file = files.get(test._requireFile);
		if (!file) {
			file = { inOrder: [], parallel: new Map(), parallelWithHooks: [] };
			files.set(test._requireFile, file);
		}
		let insideParallel = false;
		let outermostInOrder: Suite | undefined;
		let hasAllHooks = false;
		for (let parent: Suite | undefined = test.parent; parent; ) {
			if (parent._parallelMode === 'serial' || parent._parallelMode === 'default')
				outermostInOrder = parent;
			insideParallel ||= parent._parallelMode === 'parallel';
			hasAllHooks ||= (parent._hooks ?? []).some(
				({ type }) => type === 'beforeAll' || type === 'afterAll',
			);
			parent = parent.parent;
		}
		if (!insideParallel) file.inOrder.push(test);
		else if (hasAllHooks && !outermostInOrder) file.parallelWithHooks.push(test);
		else {
			const key = outermostInOrder ?? test;
			const group = file.parallel.get(key);
			if (group) group.push(test);
			else file.parallel.set(key, [test]);
		}
	}
	const groups: TestCase[][] = [];
	for (const files of byWorker.values())
		for (const { inOrder, parallel, parallelWithHooks } of files.values()) {
			if (inOrder.length > 0) groups.push(inOrder);
			groups.push(...parallel.values());
			const size = Math.ceil(parallelWithHooks.length / parallelism);
			for (let at = 0; at < parallelWithHooks.length; at += size)
				groups.push(parallelWithHooks.slice(at, at + size));
		}
	return groups;
}

/** A test as the list reporter writes it: its project, file, line and column, and title path. */
function listLine(config: FullConfig, test: TestCase): string {
	const [, project, , ...titles] = test.titlePath();
	const { file, line, column } = test.location;
	return `  [${project}] › ${relative(config.rootDir, file)}:${line}:${column} › ${titles.join(' › ')}`;
}

export default class ShardGroupsReporter {
	printsToStdio(): boolean {
		return true;
	}

	onBegin(config: FullConfig, root: Suite): void {
		const parallelism = Number(process.env[SHARD_TOTAL_ENV] ?? '1');
		const lines: string[] = [];
		for (const project of root.suites)
			for (const group of groupsOf(project, parallelism)) {
				lines.push(GROUP_LINE);
				for (const test of group) lines.push(listLine(config, test));
			}
		process.stdout.write(`${lines.join('\n')}\n`);
	}
}
