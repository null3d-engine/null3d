---
id: getting-started/network-use
title: Network use
status: experimental
since: "0.2"
summary: "What null3D downloads, when each file loads, the build's one download, and how to keep a page on its own origin."
---

# Network use

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

null3D sends nothing to any server of its own. The engine and its add-ons have no telemetry, no analytics, no crash reporting and no update check. Every request they make is for a file that the page names, or a file that the build produced.

## What the engine downloads

The engine downloads its own files from the address where the page serves them. That address is the page's own origin, or a CDN that the page names. [Hosting](hosting.md#the-engines-files-on-a-cdn) covers the CDN case.

| File | When it loads |
| --- | --- |
| The core module and its worker scripts | At `createEngine` |
| The sketch module that the page passes | At `createEngine` |
| A feature's shader module | On the first use of that feature |
| The KTX2, meshopt and Draco decoders | On the first file that needs one |
| The area light tables | On the first rectangle or tube light |

The engine builds each address with `new URL(..., import.meta.url)`. The bundler then ships that file beside the engine's code.

## What your own code downloads

The engine downloads only the addresses that you give it:

- `assets.loadTexture`, `assets.loadGltf`, `assets.loadBinary`, `assets.loadJson` and `assets.loadImageBitmap` download the address that you pass.
- A glTF file names more addresses inside it, for its buffers, images and extensions. The engine downloads those too. They may be on another origin, which must allow the page to read them.
- `preload` downloads the features that you list, when you call it.

A service worker can keep these files for a later visit. [Hosting](hosting.md#offline-play) shows how.

## The build's one download

The Vite plugin needs the engine's compiled shader modules to build a page. It looks for them in this order:

1. The folder that the `NULL3D_ENGINE_SHADERS` setting names.
2. A release file of the engine's GitHub repository. The plugin checks its SHA-256 hash against the value in the engine package.
3. The engine's own sources, built on the spot. This takes longer and needs no network.

So a build contacts GitHub only when `NULL3D_ENGINE_SHADERS` is unset and the cache holds no copy. The build machine makes that request, and a page never makes it.

In development, Vite keeps its own connection to the local dev server, for hot reload. That connection belongs to Vite, and it goes to the dev server, not to another server.

## Turn off the build's download

Set `NULL3D_ENGINE_SHADERS` to a folder that holds the engine's generated shader modules, including `shaders.ts`. The plugin then uses that folder and makes no request.

## The command-line tool

`bunx @null3d/cli` contacts no server. It serves the page from a server on the same machine, and it drives a browser on that machine. When Playwright's browser is missing, the tool prints the command that installs it. You run that command yourself.

## Check the claim

Send a policy that allows only the page's own origin. The engine still runs:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'
```

A request to another origin would fail, and the browser console would name the address. [Hosting](hosting.md#content-security-policy) gives the full policy and the error for a missing part.
