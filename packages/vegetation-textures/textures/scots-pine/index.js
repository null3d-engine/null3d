// Written by tools/plant-textures from the reference set: the texture files of the species
// scots-pine, as `bun run plants:textures scots-pine` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "scots-pine",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "0a3445d931b40b47125a10212044e4a3b482e00aa1963c769703673bb857c11d",
					"job": "041e9d60-973e-49f2-9e9b-49388dcf24ca"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "136936b49d97611ba94904e85f2694593c949bdaccf8fc5c48e86d0eeccd4121",
					"job": "31f4991e-11f7-4276-bcea-ac41838dcd9b"
				},
				{
					"name": "27-bark-texture-zone2.png",
					"sha256": "488bd83d4edd136ce1a4780127d62432f5f3efc3f127d0afaf4f5533bafb30f5",
					"job": "29812a0c-1021-4ab2-8b8b-886a116537b5"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "a545ee3029588bc215dd58270e03bd8f55b2b5c2d1b9a04f8b74a50be3c29f8b",
					"job": "866812d9-1c39-48e5-9db4-4f42a3b3d9ab"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "30dc58c1b03ee377fb55f91c114e6d19200b202fcf48ef29f2283181139ce44b",
					"job": "adc959fa-2261-4207-9a20-d2cddb877491"
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
			"length": 0.89873,
			"frame": {
				"petiole": [
					0.5,
					0.04482
				],
				"base": [
					0.5,
					0.04492
				],
				"tip": [
					0.5,
					0.94365
				]
			},
			"outline": [
				0.3442,
				0.9292,
				0.2856,
				0.9224,
				0.2827,
				0.9214,
				0.3101,
				0.7046,
				0.3062,
				0.7021,
				0.2593,
				0.6824,
				0.2488,
				0.6772,
				0.2537,
				0.6636,
				0.2639,
				0.6245,
				0.2849,
				0.5601,
				0.2947,
				0.5366,
				0.3105,
				0.5063,
				0.323,
				0.4751,
				0.3318,
				0.4507,
				0.3427,
				0.4116,
				0.3488,
				0.3853,
				0.3616,
				0.3442,
				0.3683,
				0.3286,
				0.3853,
				0.2814,
				0.4096,
				0.2085,
				0.4162,
				0.1929,
				0.4253,
				0.1756,
				0.4327,
				0.146,
				0.4388,
				0.1274,
				0.4478,
				0.088,
				0.452,
				0.0747,
				0.4612,
				0.0376,
				0.4692,
				0.0376,
				0.5356,
				0.046,
				0.5396,
				0.0474,
				0.5367,
				0.0952,
				0.532,
				0.1353,
				0.5293,
				0.1675,
				0.5243,
				0.1929,
				0.5238,
				0.2017,
				0.5191,
				0.229,
				0.5144,
				0.269,
				0.5097,
				0.2915,
				0.5087,
				0.3052,
				0.5048,
				0.3257,
				0.5035,
				0.3374,
				0.4973,
				0.3647,
				0.4961,
				0.3755,
				0.4829,
				0.4331,
				0.4799,
				0.4585,
				0.4732,
				0.4849,
				0.4709,
				0.5015,
				0.4664,
				0.52,
				0.4648,
				0.5356,
				0.4563,
				0.5679,
				0.4482,
				0.6021,
				0.4436,
				0.6274,
				0.4368,
				0.6528,
				0.4336,
				0.6753,
				0.4289,
				0.6948,
				0.4275,
				0.7124,
				0.418,
				0.7485,
				0.4155,
				0.7487,
				0.3989,
				0.7417,
				0.3967,
				0.7417,
				0.3912,
				0.7642,
				0.3745,
				0.82,
				0.3687,
				0.8462,
				0.3641,
				0.8579
			],
			"mean": {
				"upper": [
					0.13229,
					0.20223,
					0.12909
				],
				"lower": [
					0.25477,
					0.33893,
					0.18949
				]
			},
			"veins": {
				"luminance": 0.17497,
				"contrast": 5.181
			},
			"profile": {
				"upper": [
					0.18319,
					0.186,
					0.18579,
					0.18793,
					0.17958,
					0.1822,
					0.17173,
					0.17975
				],
				"lower": [
					0.31448,
					0.3182,
					0.30194,
					0.31698,
					0.30446,
					0.31118,
					0.30124,
					0
				]
			},
			"coverage": 0.0984
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "lower",
					"tile": [
						0.8,
						0.8
					],
					"mean": [
						0.1786,
						0.13311,
						0.11962
					],
					"height": {
						"offset": 0.1418,
						"depth": 0.092959
					}
				},
				{
					"name": "upper",
					"tile": [
						0.38,
						0.38
					],
					"mean": [
						0.55992,
						0.13562,
						0.05396
					],
					"height": {
						"offset": 0.21993,
						"depth": 0.035064
					}
				}
			],
			"young": {
				"tile": [
					0.12,
					0.12
				],
				"mean": [
					0.43718,
					0.15397,
					0.06202
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "e0189f1a5724a8c6c7d5a996cb684f8b70ca89f9ec7b6021d51b7a2499ec2972",
				"bytes": 157487
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "3b8adbbc308e39b897b0ae4afbe6df6aea108d4c6e38d8f75c312cabfa0cbc0e",
				"bytes": 3436
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "d31e978bb25c8010c1b1cf4540b2c8997d111e1d3aa3f44c4de6f8aa67184f91",
				"bytes": 60202
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "ebd149eea5e0c91de79aa880352146824ff0d05056983aba6f7160cb7fbdec57",
				"bytes": 1520
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "3f773dfd144bd9e488f320e8b5453a1ddd94a8a40313793cede3c33e34087305",
				"bytes": 395166
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "80cc7ed61ddcd25a35a483bdd8dbb715323ebdf7132265fa31546542e420d135",
				"bytes": 474469
			},
			{
				"file": "young-color.ktx2",
				"sha256": "251723e269e6eaad89ff377e3e20f80dba3316fb43dfb8a223af7e0438d6b42d",
				"bytes": 60100
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "094138ac37febdaa621b9b57b666b1e0e515fba9c63d85a71316e5703c24973b",
				"bytes": 62280
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "0a76c498bdf74e96af70a2ece0c73a054c836a185fe90f43a5485097bf9b09cd",
				"bytes": 105106
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "1064a0d726f346c26fe14375faa91d7bc0b1d8a0312d2dc885c18dbefd37871b",
				"bytes": 132149
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "68c8d89bb921bff66221618afaa2a5af92297d8e2d4aa9d1d6f7c84566e0cd1c",
				"bytes": 16124
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "047f5c06bf7926144517706cdd3b530db54f8d93721ad3e9d20477748cfc6161",
				"bytes": 14809
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
