// What other processes did while a benchmark page ran. The runner lists every process as a page
// opens and as it closes. The CPU time that each process used between the two lists, over the
// page's wall time, is its average use of cores during the page. The runner's own processes, the
// browser among them, are part of what the page measures, so they are left out. Everything here is
// pure; the runner makes the lists with `ps`.

/** One process in a list: its id, its parent, its CPU share at that moment, its CPU time so far. */
export interface ProcessSnapshot {
	pid: number;
	ppid: number;
	/** The share of one core that `ps` gives, a recent average: 100 is one whole core. */
	cpuPercent: number;
	cpuSeconds: number;
	name: string;
}

/** A list of every process, and when it was taken. */
export interface ProcessList {
	atMs: number;
	processes: ProcessSnapshot[];
}

/** A process's use of cores: a whole core is 1. */
export interface ProcessUse {
	pid: number;
	name: string;
	cores: number;
}

/** Other processes' work around one page. */
export interface OtherWork {
	/** The busiest other processes as the page opened, by their share of a core then. */
	start: ProcessUse[];
	/** The busiest other processes as the page closed. */
	end: ProcessUse[];
	/** The busiest other processes by their average use of cores over the whole page. */
	during: ProcessUse[];
}

/** How many processes each list of `OtherWork` keeps. */
const BUSIEST = 5;
/** The browser that the runner starts, whose processes may outlive their link to the runner. */
const OWN_BROWSER = /Chrome for Testing/;

/** CPU time as `ps` prints it, such as `377:32.99` or `1-02:03:04.50`, in seconds. */
export function parseCpuTime(text: string): number {
	const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
	const seconds = (rest ?? '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
	return Number(days) * 86_400 + seconds;
}

/** The processes in `ps -A -o pid=,ppid=,%cpu=,time=,comm=` output. */
export function parseProcessList(text: string): ProcessSnapshot[] {
	const processes: ProcessSnapshot[] = [];
	for (const line of text.split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/.exec(line);
		if (!match) continue;
		const [, pid, ppid, cpu, time, name] = match;
		processes.push({
			pid: Number(pid),
			ppid: Number(ppid),
			cpuPercent: Number(cpu),
			cpuSeconds: parseCpuTime(time as string),
			name: (name as string).trim(),
		});
	}
	return processes;
}

/** The ids of a process and of every process under it. */
export function processTree(processes: readonly ProcessSnapshot[], root: number): Set<number> {
	const tree = new Set([root]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const { pid, ppid } of processes)
			if (tree.has(ppid) && !tree.has(pid)) {
				tree.add(pid);
				grew = true;
			}
	}
	return tree;
}

/** A process's short name: the last part of its path. */
const shortName = (name: string) => name.split('/').pop() ?? name;

/** The busiest of a list, most first. */
const busiest = (uses: ProcessUse[]) =>
	uses
		.filter((use) => use.cores > 0)
		.sort((a, b) => b.cores - a.cores)
		.slice(0, BUSIEST);

/**
 * Other processes' work between two lists, leaving out the runner `own` and every process under it
 * in either list, and the runner's browser by name.
 */
export function otherWork(start: ProcessList, end: ProcessList, own: number): OtherWork {
	const mine = new Set([...processTree(start.processes, own), ...processTree(end.processes, own)]);
	const other = (p: ProcessSnapshot) => !mine.has(p.pid) && !OWN_BROWSER.test(p.name);
	const at = (list: ProcessList) =>
		busiest(
			list.processes
				.filter(other)
				.map((p) => ({ pid: p.pid, name: shortName(p.name), cores: p.cpuPercent / 100 })),
		);
	const wallSeconds = Math.max((end.atMs - start.atMs) / 1000, 1e-3);
	const before = new Map(start.processes.map((p) => [p.pid, p.cpuSeconds]));
	const during = end.processes.filter(other).map((p) => ({
		pid: p.pid,
		name: shortName(p.name),
		// A process that started during the page counts all its time.
		cores: (p.cpuSeconds - (before.get(p.pid) ?? 0)) / wallSeconds,
	}));
	return { start: at(start), end: at(end), during: busiest(during) };
}

/** Why other work spoils a page, or undefined when no other process used more than a core. */
export function otherWorkProblem(work: OtherWork | undefined): string | undefined {
	const over = work?.during.filter((use) => use.cores > 1) ?? [];
	if (over.length === 0) return undefined;
	const names = over.map((use) => `${use.name} (${use.pid}) ${use.cores.toFixed(2)} cores`);
	return `other processes used more than a core during the page: ${names.join(', ')}`;
}
