// Finds what keeps an object alive in a page, from a heap snapshot that Chrome's debugging protocol
// takes. A test that expects the page to let go of an object can name, when it fails, the chain of
// strong references from the heap's roots to each such object that the page still holds.
import type { CDPSession } from '@playwright/test';

/** The parts of a V8 heap snapshot that the search reads. */
interface HeapSnapshot {
	snapshot: {
		meta: {
			node_fields: string[];
			edge_fields: string[];
			node_types: [string[], ...unknown[]];
			edge_types: [string[], ...unknown[]];
		};
	};
	nodes: number[];
	edges: number[];
	strings: string[];
}

/** The field of a node that gives its number of edges, which follow those of the nodes before it. */
const EDGE_COUNT_FIELD = 'edge_count';

/**
 * The shortest chain of strong references from the heap's roots to each object whose constructor
 * is named `name`, other than prototypes, one text per object, each step on a line from the object
 * back to the roots.
 */
export function retainerChains(heap: HeapSnapshot, name: string): string[] {
	const { meta } = heap.snapshot;
	const nodeFields = meta.node_fields.length;
	const edgeFields = meta.edge_fields.length;
	const edgeCountField = meta.node_fields.indexOf(EDGE_COUNT_FIELD);
	const nodeTypes = meta.node_types[0];
	const edgeTypes = meta.edge_types[0];
	const count = heap.nodes.length / nodeFields;
	const firstEdge = new Int32Array(count + 1);
	for (let node = 0, edge = 0; node < count; node++) {
		firstEdge[node] = edge;
		edge += (heap.nodes[node * nodeFields + edgeCountField] as number) * edgeFields;
	}
	firstEdge[count] = heap.edges.length;
	const nodeName = (node: number) => heap.strings[heap.nodes[node * nodeFields + 1] as number];
	const nodeType = (node: number) => nodeTypes[heap.nodes[node * nodeFields] as number];
	// A breadth-first walk from the roots, which is node 0, so each object's path is a shortest one.
	const parent = new Int32Array(count).fill(-1);
	const parentEdge = new Int32Array(count).fill(-1);
	const queue = new Int32Array(count);
	const seen = new Uint8Array(count);
	const found: number[] = [];
	seen[0] = 1;
	for (let head = 0, tail = 1; head < tail; head++) {
		const node = queue[head] as number;
		for (
			let edge = firstEdge[node] as number;
			edge < (firstEdge[node + 1] as number);
			edge += edgeFields
		) {
			if (edgeTypes[heap.edges[edge] as number] === 'weak') continue;
			const to = (heap.edges[edge + 2] as number) / nodeFields;
			if (seen[to]) continue;
			seen[to] = 1;
			parent[to] = node;
			parentEdge[to] = edge;
			queue[tail++] = to;
			// A class's prototype object bears the class's name too, but it is not an instance.
			const label = heap.strings[heap.edges[edge + 1] as number];
			if (nodeName(to) === name && nodeType(to) === 'object' && label !== 'prototype')
				found.push(to);
		}
	}
	return found.map((target) => {
		const steps: string[] = [];
		for (let node = target; node > 0; node = parent[node] as number) {
			const edge = parentEdge[node] as number;
			const type = edgeTypes[heap.edges[edge] as number];
			const label =
				type === 'element' || type === 'hidden'
					? String(heap.edges[edge + 1])
					: heap.strings[heap.edges[edge + 1] as number];
			steps.push(
				`${nodeType(node)} ${String(nodeName(node)).slice(0, 100)} <- ${type} ${String(label).slice(0, 60)}`,
			);
		}
		return steps.join('\n');
	});
}

/** Takes a heap snapshot of the page that `cdp` debugs. */
export async function takeHeapSnapshot(cdp: CDPSession): Promise<HeapSnapshot> {
	const chunks: string[] = [];
	const collect = ({ chunk }: { chunk: string }) => chunks.push(chunk);
	cdp.on('HeapProfiler.addHeapSnapshotChunk', collect);
	try {
		await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
	} finally {
		cdp.off('HeapProfiler.addHeapSnapshotChunk', collect);
	}
	return JSON.parse(chunks.join('')) as HeapSnapshot;
}
