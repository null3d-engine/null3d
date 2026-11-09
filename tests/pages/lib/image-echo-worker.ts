// Answers the image buffer check with the size of the ImageBitmap that the page posted, or with
// what arrived in its place.
self.onmessage = (event: MessageEvent<unknown>) => {
	const image = event.data;
	self.postMessage(image instanceof ImageBitmap ? `${image.width}x${image.height}` : String(image));
};
