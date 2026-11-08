// Written by tools/plant-textures from the reference set: the texture files of the species
// hawthorn-shrub, as `bun run plants:textures hawthorn-shrub` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "hawthorn-shrub",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "431ca19cf5011d87480577c5d3f9f4d75a5663988a9ba21bcda1967044ae3b07",
					"job": "01b70f3d-18f2-4f47-809d-1465366762bc"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "2f4cb3294ae4a3b9c30e866b490c4469f9b9c11d15d769db9da0ea1518e9b25f",
					"job": "05bb11a7-8212-49f2-8078-a5d4a3fcf0e2"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "54160c06d32363b39e406fa198bc2527551b5f56dcad2e110eb7dbf8df0c8eb5",
					"job": "30e5c930-64aa-4358-8a55-becde45ea1b3"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "f2f5804b8ad8db4c846b5424259ba0473eeb1d28e64a29e3073f9efd0a8dc30e",
					"job": "21c29d9c-23b0-4e4c-8b25-781581292c2f"
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
			"length": 0.70999,
			"frame": {
				"petiole": [
					0.5,
					0.02144
				],
				"base": [
					0.5,
					0.26953
				],
				"tip": [
					0.5,
					0.97952
				]
			},
			"outline": [
				0.4282,
				0.9981,
				0.3999,
				0.9465,
				0.3828,
				0.9604,
				0.3706,
				0.9093,
				0.3578,
				0.9165,
				0.3524,
				0.8716,
				0.3348,
				0.8813,
				0.3242,
				0.8081,
				0.389,
				0.606,
				0.2661,
				0.7459,
				0.2505,
				0.7454,
				0.2095,
				0.7893,
				0.2026,
				0.7701,
				0.1597,
				0.7907,
				0.1597,
				0.7368,
				0.1072,
				0.7368,
				0.1053,
				0.688,
				0.1262,
				0.6499,
				0.0959,
				0.647,
				0.1217,
				0.5854,
				0.2121,
				0.5122,
				0.104,
				0.4683,
				0.1525,
				0.4087,
				0.2231,
				0.373,
				0.2145,
				0.3638,
				0.2944,
				0.307,
				0.4243,
				0.2558,
				0.469,
				0.2231,
				0.4884,
				0.1694,
				0.4851,
				0.0269,
				0.4937,
				0.0003,
				0.5239,
				0,
				0.51,
				0.1118,
				0.5178,
				0.2271,
				0.6743,
				0.3407,
				0.7964,
				0.3752,
				0.8455,
				0.4038,
				0.9008,
				0.4692,
				0.8309,
				0.4917,
				0.9041,
				0.562,
				0.9112,
				0.5776,
				0.8905,
				0.5835,
				0.9119,
				0.6519,
				0.8804,
				0.6515,
				0.8823,
				0.6845,
				0.8296,
				0.6621,
				0.8276,
				0.6777,
				0.7729,
				0.659,
				0.7329,
				0.624,
				0.7708,
				0.7231,
				0.7483,
				0.7192,
				0.761,
				0.7983,
				0.741,
				0.7915,
				0.7358,
				0.8536,
				0.7007,
				0.8325,
				0.6929,
				0.8526,
				0.605,
				0.7656,
				0.613,
				0.8442,
				0.5903,
				0.906,
				0.5688,
				0.8889,
				0.5435,
				0.9547,
				0.5288,
				0.9409,
				0.5005,
				0.979,
				0.4644,
				0.9534
			],
			"mean": {
				"upper": [
					0.04031,
					0.08494,
					0.01153
				],
				"lower": [
					0.19388,
					0.27022,
					0.17816
				]
			},
			"veins": {
				"luminance": 0.05841,
				"contrast": 6.565
			},
			"profile": {
				"upper": [
					0.07017,
					0.07094,
					0.06942,
					0.06967,
					0.07075,
					0.07025,
					0.06967,
					0.07086
				],
				"lower": [
					0.24521,
					0.2488,
					0.24708,
					0.24875,
					0.2479,
					0.2469,
					0.2464,
					0.24029
				]
			},
			"coverage": 0.3227
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.25,
						0.25
					],
					"mean": [
						0.07879,
						0.05765,
						0.04714
					],
					"height": {
						"offset": 0.20461,
						"depth": 0.025641
					}
				}
			],
			"young": {
				"tile": [
					0.12,
					0.12
				],
				"mean": [
					0.15062,
					0.08924,
					0.06549
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "d601fec87f0fbe2582b48ae9f1bdd0969f47bf0c0ae23770098565450dbae5c5",
				"bytes": 232830
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "0d338949884841929b59272d39e0c65787ee738e1fd16a8b0fdadb5e24d70447",
				"bytes": 70537
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "6e75c38ed5693edf611c2cc7b0e2d1cc61a5641531a73fb793cd595d65ba4877",
				"bytes": 76122
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "1d43b332895ed29220a293cd25749b8efdd871f73dee8ca97c6df1c2155f9441",
				"bytes": 20237
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "63852064f66663521377938c6441c7ede21fb17a8c331cf147c7774c484a640c",
				"bytes": 182606
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "3a8dc1e61e086ff10f99f3901150f63f89a9e045589b97c771f5a732b538648d",
				"bytes": 250541
			},
			{
				"file": "young-color.ktx2",
				"sha256": "a46803c382b54afac01e4f69f261d01da0a4cd279f8d5f14a0c784bc128faa6a",
				"bytes": 55008
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "7ca74bf635e15c128cdb9b468733bef2d09e3f2ce14b744cb5c03b683807a16b",
				"bytes": 57293
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "a919b899114139ed7c9e5cd3a2b384c5df2694d2a8190adb777e967252ab1beb",
				"bytes": 51607
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "24eb4465d93e1f10c4908c327d316c287fa238097783368d64b1c34f4c2e8c42",
				"bytes": 73031
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "d5d518bc011c7bf596d5d80d2a992d513f64631b87acb5f45d3a4592dd330fe9",
				"bytes": 14560
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "f7cc7551e86a24460d25640f477aebdb86d824cb58a6016f380759094d541f45",
				"bytes": 13679
			}
		]
	},
	full: {
		leafColor: new URL('./leaf-color.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal.ktx2', import.meta.url),
		barkColor: new URL('./bark-color.ktx2', import.meta.url),
		barkNormal: new URL('./bark-normal.ktx2', import.meta.url),
		youngColor: new URL('./young-color.ktx2', import.meta.url),
		youngNormal: new URL('./young-normal.ktx2', import.meta.url),
	},
	half: {
		leafColor: new URL('./leaf-color-half.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal-half.ktx2', import.meta.url),
		barkColor: new URL('./bark-color-half.ktx2', import.meta.url),
		barkNormal: new URL('./bark-normal-half.ktx2', import.meta.url),
		youngColor: new URL('./young-color-half.ktx2', import.meta.url),
		youngNormal: new URL('./young-normal-half.ktx2', import.meta.url),
	},
};
