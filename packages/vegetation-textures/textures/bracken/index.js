// Written by tools/plant-textures from the reference set: the texture files of the species
// bracken, as `bun run plants:textures bracken` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "bracken",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "89616346add767c7e4761859a57b00076fa8e9a3dd23fc665a6f5d032681c577",
					"job": "7e5e9d4d-6b3c-457c-8880-4e307abba7cf"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "597f67b000ee0e34578a860c7fd0b3bd9b97cae79209c65cfabae805260a7240",
					"job": "bb83f7b7-a06a-4f03-8344-22f7d694d3aa"
				}
			]
		},
		"tool": {
			"version": "1",
			"encoder": "Basis Universal 2.50, ETC1S, effort 2"
		},
		"leaf": {
			"size": 1024,
			"layers": [
				"upper",
				"lower"
			],
			"length": 0.84246,
			"frame": {
				"petiole": [
					0.5,
					0.02303
				],
				"base": [
					0.5,
					0.13184
				],
				"tip": [
					0.5,
					0.97429
				]
			},
			"outline": [
				0.4858,
				1,
				0.4644,
				0.9371,
				0.4064,
				0.9702,
				0.4253,
				0.9216,
				0.3667,
				0.9606,
				0.3843,
				0.9067,
				0.3267,
				0.9464,
				0.3462,
				0.8929,
				0.2856,
				0.9315,
				0.3071,
				0.8781,
				0.2466,
				0.915,
				0.27,
				0.8654,
				0.2153,
				0.901,
				0.2358,
				0.8556,
				0.0712,
				0.8364,
				0.1909,
				0.757,
				0.0378,
				0.7485,
				0.1547,
				0.7378,
				0.0951,
				0.6694,
				0.1421,
				0.6523,
				0.3597,
				0.6987,
				0.1753,
				0.5257,
				0.4155,
				0.5785,
				0.4263,
				0.6395,
				0.4487,
				0.5918,
				0.4565,
				0.6558,
				0.4927,
				0.6112,
				0.2119,
				0.4331,
				0.4165,
				0.4909,
				0.4399,
				0.4342,
				0.2876,
				0.3353,
				0.494,
				0.3979,
				0.3242,
				0.2622,
				0.4958,
				0.3149,
				0.3643,
				0.2261,
				0.4605,
				0.2397,
				0.3959,
				0.1772,
				0.4538,
				0.1948,
				0.5005,
				0.0203,
				0.5292,
				0.1597,
				0.5861,
				0.1519,
				0.5261,
				0.2017,
				0.6084,
				0.1782,
				0.5093,
				0.2665,
				0.6434,
				0.2241,
				0.5083,
				0.3344,
				0.699,
				0.2905,
				0.5083,
				0.419,
				0.7419,
				0.353,
				0.5083,
				0.5202,
				0.7914,
				0.4663,
				0.5087,
				0.6411,
				0.5405,
				0.6867,
				0.5366,
				0.6232,
				0.6343,
				0.5755,
				0.8521,
				0.5453,
				0.6064,
				0.7124,
				0.6407,
				0.7837,
				0.7124,
				0.6878,
				0.9696,
				0.7769,
				0.8248,
				0.7749,
				0.8394,
				0.8186,
				0.5815,
				0.9093,
				0.5152,
				0.8589
			],
			"mean": {
				"upper": [
					0.10515,
					0.18152,
					0.03274
				],
				"lower": [
					0.2534,
					0.30579,
					0.07348
				]
			},
			"veins": {
				"luminance": 0.14988,
				"contrast": 6.866
			},
			"profile": {
				"upper": [
					0.15423,
					0.1541,
					0.15408,
					0.15471,
					0.15455,
					0.15456,
					0.15415,
					0.16141
				],
				"lower": [
					0.28185,
					0.27815,
					0.2799,
					0.27895,
					0.27706,
					0.27757,
					0.27766,
					0.27443
				]
			},
			"coverage": 0.2634
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "f75705ab2d627c089dd70e0293b8746d3320c54f8cbe75b19d7a26d92688f57a",
				"bytes": 286803
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "ee28e45f0cecb81e51e993736eb42ade56c843b99fb9e6b331cbe357d0fb4d82",
				"bytes": 23180
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "b4159696d24693441759906dec66601edf3f7ce01c9e0dc4f4c4eafddd821358",
				"bytes": 92829
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "1ebd9332b41ea178b17b4b16b5011b12dfd1942b11151db86c878a676a8e6f19",
				"bytes": 4852
			}
		]
	},
	full: {
		leafColor: new URL('./leaf-color.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal.ktx2', import.meta.url),
	},
	half: {
		leafColor: new URL('./leaf-color-half.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal-half.ktx2', import.meta.url),
	},
};
