// Commit-msg guard: a broken link in the published Markdown fails the commit.
//
// Internal links are checked across the whole tree on every commit, because a renamed or deleted
// file breaks links in files the commit never touched. These checks are deterministic and always
// block. External URLs are probed only in the changed files (HEAD, then GET for servers that
// refuse HEAD), and successes are cached in .git/ for a week. Only a definitive 404 or 410 blocks:
// a 403 can be a bot wall, and an offline machine must warn, never wedge a commit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	checkLinkTree,
	classifyExternalStatus,
	extractLinks,
	isOwnRepoUrl,
	isSkippedExternalUrl,
	linkedFiles,
} from '../lib/links';
import { stagedFiles } from './commit-ack';

const CACHE_PATH = join('.git', 'sokko3d-docs-link-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_CONCURRENCY = 6;
/** Some hosts refuse generic clients; a browser user agent keeps false alarms down. */
const LINK_CHECK_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export interface ExternalProbe {
	verdict: 'ok' | 'broken' | 'unreachable';
	detail: string;
}

async function fetchStatus(url: string, method: 'HEAD' | 'GET'): Promise<number> {
	const res = await fetch(url, {
		method,
		redirect: 'follow',
		headers: { 'user-agent': LINK_CHECK_UA, accept: '*/*' },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	// The status is the answer; the body is never downloaded.
	await res.body?.cancel().catch(() => {});
	return res.status;
}

/** HEAD first, then GET when the server refuses HEAD or the request fails. */
export async function probeExternalUrl(url: string): Promise<ExternalProbe> {
	try {
		const headStatus = await fetchStatus(url, 'HEAD');
		if (classifyExternalStatus(headStatus) === 'ok')
			return { verdict: 'ok', detail: `HEAD ${headStatus}` };
	} catch {
		// fall through to GET
	}
	try {
		const status = await fetchStatus(url, 'GET');
		return { verdict: classifyExternalStatus(status), detail: `GET ${status}` };
	} catch (e) {
		return { verdict: 'unreachable', detail: (e as Error).message };
	}
}

function readCache(): Record<string, number> {
	try {
		return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Record<string, number>;
	} catch {
		return {};
	}
}

function writeCache(cache: Record<string, number>): void {
	try {
		mkdirSync(dirname(CACHE_PATH), { recursive: true });
		writeFileSync(CACHE_PATH, JSON.stringify(cache));
	} catch {
		// The cache only saves time; without it every link is probed again.
	}
}

async function main(): Promise<void> {
	const root = process.cwd();
	const files = linkedFiles(root);
	const problems = checkLinkTree(files, (p) => existsSync(join(root, p)));
	if (problems.length > 0) {
		console.error(`\ncommit rejected: ${problems.length} broken link(s):\n`);
		for (const p of problems) console.error(`  ${p}`);
		console.error(
			'\nFix the link or its target. Internal links are checked across the whole tree,',
		);
		console.error('so a renamed or deleted file must take its inbound links with it.\n');
		process.exit(1);
	}

	const staged = stagedFiles().filter((f) => files.has(f));
	const cache = readCache();
	const now = Date.now();
	const urls = new Map<string, string>();
	for (const f of staged) {
		for (const { target, line } of extractLinks(files.get(f) ?? '')) {
			if (!/^https?:\/\//.test(target)) continue;
			if (isSkippedExternalUrl(target) || isOwnRepoUrl(target)) continue;
			if (now - (cache[target] ?? 0) < CACHE_TTL_MS) continue;
			if (!urls.has(target)) urls.set(target, `${f}:${line}`);
		}
	}

	const queue = [...urls.entries()];
	const broken: string[] = [];
	const warnings: string[] = [];
	await Promise.all(
		Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
			for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
				const [url, where] = item;
				const probe = await probeExternalUrl(url);
				if (probe.verdict === 'ok') cache[url] = now;
				else if (probe.verdict === 'broken') broken.push(`  ${where} ${url} (${probe.detail})`);
				else warnings.push(`  ${where} ${url} (${probe.detail})`);
			}
		}),
	);
	writeCache(cache);

	for (const w of warnings)
		console.error(`warning: could not verify external link (not blocking):\n${w}`);
	if (broken.length > 0) {
		console.error(`\ncommit rejected: ${broken.length} dead external link(s):\n`);
		for (const b of broken) console.error(b);
		console.error('\nA 404 or 410 means the URL is wrong or gone: fix or remove the link.\n');
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((e) => {
		// The guard never invents a failure of its own: it reports and lets the commit through.
		console.error(
			`warning: check-docs-links failed to run (not blocking): ${(e as Error).message}`,
		);
	});
}
