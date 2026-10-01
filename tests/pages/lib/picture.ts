// Pictures that test pages draw in code, so each engine's page loads the same file without a
// server of test assets.

/**
 * Draws a picture from rows of CSS colors, top row first and one color per pixel, into a PNG file,
 * and returns its address for a texture loader. The caller revokes the address once it loaded.
 */
export async function pictureUrl(rows: readonly (readonly string[])[]): Promise<string> {
	const canvas = new OffscreenCanvas(rows[0]?.length ?? 0, rows.length);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the browser gave no 2D context to draw the picture');
	for (const [y, row] of rows.entries()) {
		for (const [x, color] of row.entries()) {
			context.fillStyle = color;
			context.fillRect(x, y, 1, 1);
		}
	}
	return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}
