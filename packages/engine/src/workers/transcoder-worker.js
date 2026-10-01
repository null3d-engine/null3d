// The KTX2 transcoder's worker. It runs the Basis Universal transcoder, whose official build is a
// classic script, so this worker is a classic script too, with no imports: bundlers copy it as it
// is. The first message names the transcoder's script, which loads at once, and a later one
// brings its WebAssembly module, which the engine compiled meanwhile. Each other message holds a
// KTX2 file of ETC1S or UASTC data, and the worker writes its mip levels in the format that the
// message names, level after level, each level's layers in turn, into one buffer that it hands
// back. The sketch thread reads the file's header and picks the format, so the worker never
// decides anything.

/** The transcoder, once its script and module have loaded. */
let ready;
/** Takes the transcoder's compiled module when it arrives. */
let receiveModule;
const compiled = new Promise((resolve) => {
	receiveModule = resolve;
});

self.onmessage = (event) => {
	const message = event.data;
	if (message.glue) {
		ready = start(message.glue);
		// A failed start answers every request, so nothing waits on it here.
		ready.catch(() => {});
		return;
	}
	if (message.module) {
		receiveModule(message.module);
		return;
	}
	const { id } = message;
	ready.then(
		(basis) => {
			let texels;
			try {
				texels = transcode(basis, message);
			} catch (error) {
				self.postMessage({ id, stage: 'transcode', error: reason(error) });
				return;
			}
			self.postMessage({ id, texels }, [texels]);
		},
		(error) => self.postMessage({ id, stage: 'load', error: reason(error) }),
	);
};

/** Loads the transcoder's script, then starts the transcoder with its module once that arrives. */
async function start(glue) {
	importScripts(glue);
	const module = await compiled;
	// The script waits for its module through a callback alone, so a failure ends the wait here.
	let fail;
	const failed = new Promise((_, reject) => {
		fail = reject;
	});
	const basis = await Promise.race([
		self.BASIS({
			instantiateWasm(imports, receive) {
				WebAssembly.instantiate(module, imports).then(
					(instance) => receive(instance, module),
					fail,
				);
				return {};
			},
		}),
		failed,
	]);
	basis.initializeBasis();
	return basis;
}

/** Writes every level and layer that the message asks for into one buffer. */
function transcode(basis, { file, format, levels, layers }) {
	const ktx2 = new basis.KTX2File(new Uint8Array(file));
	try {
		if (!ktx2.isValid()) throw new Error('the transcoder could not read the file');
		if (!ktx2.startTranscoding()) throw new Error('the transcoder could not start on the file');
		const target = basis.transcoder_texture_format[format].value;
		let total = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++)
				total += ktx2.getImageTranscodedSizeInBytes(level, layer, 0, target);
		const texels = new Uint8Array(total);
		let offset = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++) {
				const size = ktx2.getImageTranscodedSizeInBytes(level, layer, 0, target);
				const image = texels.subarray(offset, offset + size);
				if (!ktx2.transcodeImage(image, level, layer, 0, target, 0, -1, -1))
					throw new Error(`the transcoder failed on mip level ${level}, layer ${layer}`);
				offset += size;
			}
		return texels.buffer;
	} finally {
		ktx2.close();
		ktx2.delete();
	}
}

function reason(error) {
	return error instanceof Error ? error.message : String(error);
}
