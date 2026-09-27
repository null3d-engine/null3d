export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		// Trailers such as Docs-Checked: name the pages that were re-read, which can run long.
		'footer-max-line-length': [0],
	},
};
