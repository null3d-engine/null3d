// Pages that may end their tab on purpose, such as the tab memory page, which grows memory until the
// browser closes the tab. Such a page posts its progress as it goes, under a name beside its result,
// so the dev server keeps how far it got when the tab and the runner page in it die. The runner
// page, when the browser reloads it, and the runner tool, when the runner page goes quiet, then
// record that progress as the page's result. The runner page, in the browser, and the runner tool,
// in Node, share these helpers, so they use no API of either.

/** The name of the record of a page's progress, beside its result. */
export const progressName = (id: string) => `${id}.progress`;

/** Who recorded that a tab ended: the runner page that the browser reloaded, or the runner tool. */
export type TabEndRecorder = 'runner page' | 'runner tool';

/**
 * The result of a page that the browser closed with its tab: the page's last progress, and who
 * recorded it. Without progress, the page died before it posted any.
 */
export function tabEndedResult(
	progress: Record<string, unknown> | undefined,
	recordedBy: TabEndRecorder,
): Record<string, unknown> {
	const { receivedAt: _received, ...facts } = progress ?? {};
	return { ok: true, ...facts, end: 'tab', recordedBy };
}
