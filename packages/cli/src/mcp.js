// null3d mcp: a Model Context Protocol server for a running null3D project. An agent calls it over
// stdio to list and change the scene's objects, capture a frame, read the frame figures and errors,
// dump the render graph, and switch the quality preset or the GPU path. The scene runs in a worker,
// so every call crosses the page's inspection bridge (`window.__null3dInspector`), which a
// development build publishes.
//
// The server reaches the scene in one of two ways. By default it starts the project's own Vite dev
// server and a headless Chrome, as `shot` does, so it works on a cloud agent with no window. With
// `--connect`, it attaches to a Chrome that the developer already runs with a debugging port, and
// drives the tab that already shows the page, so the agent sees exactly what the developer sees.
// `--url` attaches to a dev server that already runs, still with its own headless browser.
import { setTimeout as sleep } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { parseSize, readOptions, readSeconds, sizeRule, UsageError } from './args.js';
import { defaultEnvironment, launchBrowser } from './browser.js';
import { switchedPath, TIERS, watchConsole } from './page.js';
import { startRunner } from './runner.js';
import { VERSION } from './version.js';

/** @import { Browser, Page } from 'playwright-core' */
/** @import { DevServer } from './server.js' */
/** @import { Tier } from './page.js' */

/** The global where a development build publishes its inspection bridge. */
export const INSPECTOR_GLOBAL = '__null3dInspector';

const OPTIONS = /** @type {const} */ ({
	page: { type: 'string', default: '/' },
	gpu: { type: 'string' },
	size: { type: 'string', default: '1280x720' },
	timeout: { type: 'string', default: '60' },
	url: { type: 'string' },
	connect: { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli mcp [options]

Runs a Model Context Protocol server over stdio for the running null3D project in the current
folder. An agent lists and edits the scene's objects, captures a frame, reads the frame figures,
errors and render graph, and switches the quality preset or the GPU path.

By default it starts the project's own Vite dev server and a headless Chrome, as "shot" does.
With --connect it drives a Chrome that already runs with a debugging port, and the tab that shows
the page, so the agent sees exactly what the developer sees.

Options:
  --page <path>        The page to open, from the server's root (/)
  --gpu <tier>         Opens the server's own page on a GPU path: webgpu, compat or webgl2
  --size <width>x<height>  The headless browser's window in CSS pixels (1280x720)
  --timeout <seconds>  How long the page may take to publish the inspector (60)
  --url <address>      Use a dev server that already runs, such as https://localhost:5174,
                       instead of starting one. The server still starts its own browsers
  --connect <address>  Attach to Chrome's debugging endpoint instead, such as
                       http://127.0.0.1:9222, and drive the tab that shows the page. Start Chrome
                       with --remote-debugging-port=9222 to offer one

The page needs a development build that starts the engine as it loads. A production build leaves
the inspection channel out.`;

/**
 * The options that `args` gives.
 *
 * @param {readonly string[]} args
 */
export function parseMcpArgs(args) {
	const values = readOptions(args, OPTIONS);
	const size = parseSize(values.size);
	if (size === undefined) throw new UsageError(sizeRule('--size', values.size));
	const [width, height] = size;
	if (values.gpu !== undefined && !TIERS.includes(/** @type {Tier} */ (values.gpu)))
		throw new UsageError(`--gpu takes ${TIERS.join(', ')}, not "${values.gpu}"`);
	if (values.url !== undefined && !isAddress(values.url))
		throw new UsageError(`--url takes an http or https address, not "${values.url}"`);
	if (values.connect !== undefined && !isAddress(values.connect))
		throw new UsageError(`--connect takes an http or https address, not "${values.connect}"`);
	if (values.url !== undefined && values.connect !== undefined)
		throw new UsageError('--url and --connect are alternatives: give one of them');
	const page = values.page.startsWith('/') ? values.page : `/${values.page}`;
	return {
		page,
		gpu: /** @type {Tier | undefined} */ (values.gpu),
		size: /** @type {readonly [number, number]} */ ([width, height]),
		timeoutMs: readSeconds('--timeout', values.timeout, { above: true }) * 1000,
		url: values.url,
		connect: values.connect,
		help: values.help === true,
	};
}

/** @param {string} text */
function isAddress(text) {
	try {
		const url = new URL(text);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * A session's answer to one tool: the content that the MCP client shows, and whether it failed.
 *
 * @typedef {{ content: ({ type: 'text', text: string } | { type: 'image', data: string, mimeType: string })[], isError?: boolean }} ToolResult
 */

/**
 * What a tool needs from the running page.
 *
 * @typedef {object} Session
 * @property {(call: string, args?: unknown) => Promise<unknown>} inspect Runs an inspection call.
 * @property {() => Promise<{ errors: string[], warnings: string[] }>} errors The console's errors and warnings.
 * @property {(tier: Tier) => Promise<void>} setGpu Switches the GPU path and reloads the page.
 * @property {() => Promise<void>} close Stops what the session started.
 */

/** The text of a value, as pretty JSON unless it is already text. */
/** @param {unknown} value */
function textResult(value) {
	return {
		content: [
			{
				type: /** @type {const} */ ('text'),
				text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
			},
		],
	};
}

/** A failed tool call, with the reason as text. */
/** @param {unknown} error */
function failure(error) {
	return {
		content: [
			{
				type: /** @type {const} */ ('text'),
				text: `The inspection failed: ${error instanceof Error ? error.message : String(error)}`,
			},
		],
		isError: true,
	};
}

/** The object keys of a tool's arguments that the tool passes on, where the client gave them. */
/** @param {Record<string, any>} args @param {readonly string[]} keys */
function present(args, keys) {
	/** @type {Record<string, unknown>} */
	const out = {};
	for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
	return out;
}

/**
 * Runs one tool against a session and returns the MCP content. The server's handlers and the tests
 * share it, so the tools' behaviour is the same in both.
 *
 * @param {Session} session
 * @param {string} name
 * @param {Record<string, any>} [args]
 * @returns {Promise<ToolResult>}
 */
export async function handleTool(session, name, args = {}) {
	try {
		switch (name) {
			case 'list_objects':
				return textResult(
					await session.inspect('objects', {
						filter: args.filter,
						limit: args.limit,
					}),
				);
			case 'get_object':
				return textResult(await session.inspect('object', { selector: args.object }));
			case 'set_transform': {
				const call = {
					selector: args.object,
					...present(args, [
						'position',
						'rotation',
						'rotationEuler',
						'scale',
						'visible',
						'dynamic',
						'layers',
					]),
				};
				return textResult(await session.inspect('setObject', call));
			}
			case 'set_material': {
				const values = present(args, [
					'color',
					'opacity',
					'metalness',
					'roughness',
					'emissive',
					'emissiveIntensity',
					'ior',
					'specularIntensity',
					'envIntensity',
				]);
				return textResult(await session.inspect('setMaterial', { selector: args.object, values }));
			}
			case 'capture': {
				const shot = /** @type {{ png: string, bytes: number }} */ (
					await session.inspect('capture')
				);
				return {
					content: [
						{ type: 'text', text: `Captured a PNG of the current frame: ${shot.bytes} bytes.` },
						{ type: 'image', data: shot.png, mimeType: 'image/png' },
					],
				};
			}
			case 'stats':
				return textResult(await session.inspect('stats'));
			case 'errors': {
				const engine = /** @type {{ errors: string[] }} */ (await session.inspect('errors'));
				const log = await session.errors();
				return textResult({
					engine: engine.errors,
					console: log.errors,
					warnings: log.warnings,
				});
			}
			case 'render_graph': {
				const graph = /** @type {{ graph: string }} */ (await session.inspect('graph'));
				return textResult(graph.graph);
			}
			case 'set_quality':
				return textResult(
					await session.inspect('setQuality', present(args, ['preset', 'settings'])),
				);
			case 'set_gpu': {
				const tier = /** @type {Tier} */ (args.tier);
				await session.setGpu(tier);
				return textResult({ reloaded: true, tier, info: await session.inspect('info') });
			}
			default:
				throw new Error(
					`there is no "${name}" tool. The tools are list_objects, get_object, set_transform, set_material, capture, stats, errors, render_graph, set_quality and set_gpu`,
				);
		}
	} catch (error) {
		return failure(error);
	}
}

/** The object that a tool names: its name, its slot as "#<slot>", or a whole number. */
const OBJECT = z.union([z.string(), z.number().int().positive()]);

/** A triple of numbers, such as a position. */
const TRIPLE = z.array(z.number()).length(3);

/** A quaternion. */
const QUATERNION = z.array(z.number()).length(4);

/** The GPU paths that `set_gpu` takes. */
const GPU_TIER = z.enum(['webgpu', 'compat', 'webgl2']);

/**
 * Registers the tools on a new MCP server that answers from `session`.
 *
 * @param {Session} session
 */
export function createServer(session) {
	const server = new McpServer({ name: 'null3d', version: VERSION });
	/** @param {string} name @param {any} config */
	const tool = (name, config) =>
		server.registerTool(name, config, (received) => handleTool(session, name, received ?? {}));

	tool('list_objects', {
		title: 'List scene objects',
		description:
			"Lists the live objects in the running scene: each object's slot, name, kind, whether it is static or dynamic, its layers and its parent. A filter keeps the objects whose name or kind holds the text.",
		inputSchema: {
			filter: z.string().optional().describe("Text that an object's name or kind holds"),
			limit: z.number().int().positive().optional().describe('The most objects to return'),
		},
	});
	tool('get_object', {
		title: 'Read one scene object',
		description:
			'Reads one object\'s transform, world position, parent, flags, layers and, for a mesh, its material values. Name the object by its name, its slot as "#<slot>", or "#camera".',
		inputSchema: { object: OBJECT.describe('The object\'s name, "#<slot>" or "#camera"') },
	});
	tool('set_transform', {
		title: 'Change an object live',
		description:
			"Changes an object's position, rotation, scale, visibility, static or dynamic flag, or layers in the running scene. The change lasts until the page reloads; write the final value into the sketch and its tests.",
		inputSchema: {
			object: OBJECT.describe('The object\'s name, "#<slot>" or "#camera"'),
			position: TRIPLE.optional().describe('World position relative to the parent, in meters'),
			rotation: QUATERNION.optional().describe('Rotation as a quaternion [x, y, z, w]'),
			rotationEuler: TRIPLE.optional().describe('Rotation as X, Y and Z angles in radians'),
			scale: TRIPLE.optional().describe('Scale on each axis'),
			visible: z.boolean().optional(),
			dynamic: z.boolean().optional(),
			layers: z.number().int().optional().describe('A 32-bit layer mask'),
		},
	});
	tool('set_material', {
		title: 'Change a material live',
		description:
			'Changes the material of the mesh that the object names: its base color, opacity, metalness, roughness, emissive color and intensity, and the other values that a material takes. Every object that shares the material changes with it.',
		inputSchema: {
			object: OBJECT.describe('The mesh\'s name or "#<slot>"'),
			color: z.string().optional().describe('Base color as an sRGB hex string, such as "#88aa55"'),
			opacity: z.number().min(0).max(1).optional(),
			metalness: z.number().min(0).max(1).optional(),
			roughness: z.number().min(0).max(1).optional(),
			emissive: z.string().optional().describe('Emissive color as an sRGB hex string'),
			emissiveIntensity: z.number().min(0).optional(),
			ior: z.number().min(1).optional(),
			specularIntensity: z.number().min(0).max(1).optional(),
			envIntensity: z.number().min(0).optional(),
		},
	});
	tool('capture', {
		title: 'Capture the current frame',
		description: 'Reads the current frame back from the GPU and returns it as a PNG image.',
		inputSchema: {},
	});
	tool('stats', {
		title: 'Read the frame figures',
		description:
			"Reads the engine's frame figures: frame rates, CPU and GPU time, draw calls, triangles, objects, uploads, memory, the GPU path and the quality preset.",
		inputSchema: {},
	});
	tool('errors', {
		title: 'Read the engine and console errors',
		description:
			"Lists the engine errors that the sketch's code or a core call reported, and the page's console errors and warnings.",
		inputSchema: {},
	});
	tool('render_graph', {
		title: 'Dump the render graph',
		description:
			"Returns the compiled render graph as DOT text, for a diagram of the frame's passes.",
		inputSchema: {},
	});
	tool('set_quality', {
		title: 'Change the quality preset or settings live',
		description:
			'Switches the quality preset, or changes quality settings such as the render scale and the shadow settings, in the running scene.',
		inputSchema: {
			preset: z.enum(['low', 'medium', 'high', 'ultra']).optional(),
			settings: z
				.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
				.optional()
				.describe('Quality settings by name, as api/quality lists them'),
		},
	});
	tool('set_gpu', {
		title: 'Switch the GPU path',
		description:
			'Switches the engine to another GPU path and reloads the page, because the path is chosen at the start. Wait for the answer before calling another tool.',
		inputSchema: { tier: GPU_TIER.describe('The GPU path to draw with') },
	});
	return server;
}

/**
 * Waits until the page publishes its inspection bridge.
 *
 * @param {Page} page
 * @param {number} timeoutMs
 * @param {string[]} errors The page's errors so far.
 */
async function waitForInspector(page, timeoutMs, errors) {
	try {
		await page.waitForFunction(
			() => Boolean(/** @type {Record<string, any>} */ (globalThis).__null3dInspector?.inspect),
			undefined,
			{ timeout: timeoutMs },
		);
	} catch {
		const logged = errors.length > 0 ? ` The page logged: ${errors.slice(0, 3).join(' | ')}` : '';
		throw new Error(
			`the page did not publish the inspector within ${timeoutMs / 1000} s. It needs a development build that starts the engine as it loads, with the Vite dev server rather than a production build.${logged}`,
		);
	}
}

/**
 * Opens the project's page in a headless browser of the server's own, from the project's dev server
 * or from `options.url`, and returns the session.
 *
 * @param {ReturnType<typeof parseMcpArgs>} options
 * @returns {Promise<Session>}
 */
async function openOwn(options) {
	/** @type {DevServer | undefined} */
	let server;
	/** @type {Browser | undefined} */
	let browser;
	try {
		if (options.url !== undefined) {
			browser = await launchBrowser(defaultEnvironment());
		} else {
			const runner = await startRunner({});
			server = runner.server;
			browser = runner.browser;
		}
		const context = await browser.newContext({
			viewport: { width: options.size[0], height: options.size[1] },
			deviceScaleFactor: 1,
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		const log = watchConsole(page);
		const base = options.url ?? /** @type {string} */ (server?.url);
		const address = new URL(switchedPath(options.page, { gpu: options.gpu }), base);
		await page.goto(address.href, { timeout: options.timeoutMs });
		await waitForInspector(page, options.timeoutMs, log.errors);
		/** @type {(call: string, args?: unknown) => Promise<unknown>} */
		const inspect = (call, args) =>
			page.evaluate(
				/** @param {{ call: string, args?: unknown }} what */
				(what) =>
					/** @type {Record<string, any>} */ (globalThis).__null3dInspector.inspect(
						what.call,
						what.args,
					),
				{ call, args },
			);
		return {
			inspect,
			async errors() {
				return { errors: [...log.errors], warnings: [...log.warnings] };
			},
			async setGpu(tier) {
				const next = new URL(page.url());
				next.searchParams.set('gpu', tier);
				await page.goto(next.href, { timeout: options.timeoutMs });
				await waitForInspector(page, options.timeoutMs, log.errors);
			},
			async close() {
				await context.close().catch(() => {});
				await browser?.close().catch(() => {});
				await server?.close().catch(() => {});
			},
		};
	} catch (error) {
		await browser?.close().catch(() => {});
		await server?.close().catch(() => {});
		throw error;
	}
}

/**
 * Attaches to a Chrome that already runs with a debugging endpoint, and drives the tab that shows
 * the page, so the agent sees exactly what the developer sees.
 *
 * @param {ReturnType<typeof parseMcpArgs>} options
 * @returns {Promise<Session>}
 */
async function openConnected(options) {
	const browser = await chromium.connectOverCDP(/** @type {string} */ (options.connect));
	try {
		const pages = browser.contexts().flatMap((context) => context.pages());
		let page = pages.find((candidate) => samePage(candidate, options.page));
		if (page === undefined) {
			for (const candidate of pages) {
				if (await hasInspector(candidate)) {
					page = candidate;
					break;
				}
			}
		}
		if (page === undefined) {
			const open = pages.map((candidate) => candidate.url()).filter((url) => url !== '');
			throw new Error(
				`no open tab shows ${options.page}${open.length > 0 ? `. The tabs open: ${open.join(', ')}` : ''}. Open the page from the Vite dev server in that Chrome, or leave out --connect so the server starts its own browser`,
			);
		}
		const shown = page;
		const log = watchConsole(shown);
		await waitForInspector(shown, options.timeoutMs, log.errors);
		/** @type {(call: string, args?: unknown) => Promise<unknown>} */
		const inspect = (call, args) =>
			shown.evaluate(
				/** @param {{ call: string, args?: unknown }} what */
				(what) =>
					/** @type {Record<string, any>} */ (globalThis).__null3dInspector.inspect(
						what.call,
						what.args,
					),
				{ call, args },
			);
		return {
			inspect,
			async errors() {
				return { errors: [...log.errors], warnings: [...log.warnings] };
			},
			async setGpu(tier) {
				const next = new URL(shown.url());
				next.searchParams.set('gpu', tier);
				await shown.goto(next.href, { timeout: options.timeoutMs });
				await waitForInspector(shown, options.timeoutMs, log.errors);
			},
			async close() {
				// Disconnects from the developer's browser; it stays open.
				await browser.close().catch(() => {});
			},
		};
	} catch (error) {
		await browser.close().catch(() => {});
		throw error;
	}
}

/** Whether a tab shows the page that `path` names. */
/** @param {Page} page @param {string} path */
function samePage(page, path) {
	try {
		const url = new URL(page.url());
		return url.pathname === new URL(path, 'http://localhost').pathname;
	} catch {
		return false;
	}
}

/** Whether a tab publishes the inspection bridge. */
/** @param {Page} page */
async function hasInspector(page) {
	try {
		return await page.evaluate(() =>
			Boolean(/** @type {Record<string, any>} */ (globalThis).__null3dInspector?.inspect),
		);
	} catch {
		return false;
	}
}

/**
 * A session that starts on the first tool call, so listing the tools costs no browser.
 *
 * @param {ReturnType<typeof parseMcpArgs>} options
 * @returns {Session & { started: () => Promise<void> }}
 */
function lazySession(options) {
	/** @type {Promise<Session> | undefined} */
	let opening;
	/** @type {Session | undefined} */
	let opened;
	const start = () => {
		opening ??= (async () => {
			opened =
				options.connect === undefined ? await openOwn(options) : await openConnected(options);
			return opened;
		})();
		return opening;
	};
	return {
		async inspect(call, args) {
			return (await start()).inspect(call, args);
		},
		async errors() {
			return (await start()).errors();
		},
		async setGpu(tier) {
			return (await start()).setGpu(tier);
		},
		async close() {
			await opened?.close();
			opened = undefined;
			opening = undefined;
		},
		async started() {
			await start();
		},
	};
}

/** Runs the `mcp` command and returns its exit code. */
/** @param {readonly string[]} args */
export async function run(args) {
	const options = parseMcpArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	// The protocol owns stdout. Everything that the server, Vite or a browser logs goes to stderr.
	console.log = console.error;
	console.info = console.error;
	const session = lazySession(options);
	const server = createServer(session);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(
		`null3D MCP server ${VERSION}: ${options.connect === undefined ? `starting the project in ${process.cwd()}` : `attached to ${options.connect}`}. The scene starts now, and the first tool call waits for it.`,
	);
	// Start the dev server, the browser and the page while the client lists the tools, so the first
	// call does not pay for the whole start. A failure reaches the first call as its own answer.
	void session.started().catch((error) => {
		console.error(
			`null3D MCP server: the scene did not start: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	await new Promise((resolve) => {
		let done = false;
		const end = () => {
			if (done) return;
			done = true;
			resolve(undefined);
		};
		process.stdin.once('end', end);
		process.stdin.once('close', end);
		process.once('SIGINT', end);
		process.once('SIGTERM', end);
	});
	await server.close().catch(() => {});
	await session.close().catch(() => {});
	// Let a developer's brief disconnect settle before the process ends.
	await sleep(0);
	return 0;
}
