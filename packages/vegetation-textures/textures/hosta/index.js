// Written by tools/plant-textures from the reference set: the texture files of the species
// hosta, as `bun run plants:textures hosta` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "hosta",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "2a98aef03d6ee1d9211c0258af25e7957a32a20d78f3af5a366e18dc18aec56d",
					"job": "1394320f-f021-4e04-859f-07b305008f78"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "1d094af569498eb35f66e432cf4e2e0d10f98530ca5f33e3942b55d476b055e0",
					"job": "280bc99b-be84-4bee-90d1-21bce4ba79fa"
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
			"length": 0.91238,
			"frame": {
				"petiole": [
					0.5,
					0.02299
				],
				"base": [
					0.5,
					0.0625
				],
				"tip": [
					0.5,
					0.97488
				]
			},
			"outline": [
				0.4761,
				0.979,
				0.4714,
				0.9712,
				0.4764,
				0.8032,
				0.4735,
				0.7476,
				0.4636,
				0.7729,
				0.4487,
				0.7916,
				0.4253,
				0.8055,
				0.3989,
				0.8123,
				0.3687,
				0.8122,
				0.3345,
				0.8043,
				0.2935,
				0.7861,
				0.2661,
				0.7675,
				0.2329,
				0.7378,
				0.2064,
				0.7075,
				0.1839,
				0.6753,
				0.1671,
				0.644,
				0.1522,
				0.606,
				0.1429,
				0.5708,
				0.137,
				0.5278,
				0.1351,
				0.4849,
				0.1371,
				0.4556,
				0.143,
				0.4243,
				0.17,
				0.3335,
				0.1898,
				0.2886,
				0.2053,
				0.2622,
				0.23,
				0.2282,
				0.2579,
				0.1958,
				0.3071,
				0.1527,
				0.3774,
				0.1047,
				0.4712,
				0.0554,
				0.4849,
				0.0413,
				0.4995,
				0.0205,
				0.5026,
				0.022,
				0.5151,
				0.0425,
				0.5327,
				0.0576,
				0.6056,
				0.0913,
				0.6519,
				0.1181,
				0.7251,
				0.1782,
				0.7712,
				0.228,
				0.8044,
				0.2778,
				0.8417,
				0.3599,
				0.8608,
				0.4234,
				0.8658,
				0.4575,
				0.867,
				0.4897,
				0.8639,
				0.5308,
				0.8571,
				0.5679,
				0.8465,
				0.604,
				0.83,
				0.6431,
				0.8103,
				0.6782,
				0.7811,
				0.7183,
				0.7603,
				0.741,
				0.728,
				0.7683,
				0.6929,
				0.7896,
				0.6655,
				0.8004,
				0.6294,
				0.8077,
				0.6001,
				0.8072,
				0.5757,
				0.8005,
				0.5542,
				0.7869,
				0.5411,
				0.771,
				0.5278,
				0.7414,
				0.5243,
				0.8032,
				0.5296,
				0.9722,
				0.5278,
				0.978,
				0.5249,
				0.9793
			],
			"mean": {
				"upper": [
					0.08131,
					0.18831,
					0.01736
				],
				"lower": [
					0.33762,
					0.42652,
					0.14361
				]
			},
			"veins": {
				"luminance": 0.15325,
				"contrast": 12.91
			},
			"profile": {
				"upper": [
					0.15399,
					0.15347,
					0.1536,
					0.15318,
					0.15209,
					0.15369,
					0.15252,
					0.15297
				],
				"lower": [
					0.38336,
					0.38799,
					0.38747,
					0.38806,
					0.38773,
					0.38731,
					0.38326,
					0.38524
				]
			},
			"coverage": 0.4359
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "374406e2cb2313c2bfc0c1ca585e472ccf76d2554e901ddd430efc62e8e150cc",
				"bytes": 230337
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "5c87a95ca8a9850eaaf7e1a4963572675fcf01683fa981efd3a293ca1a6f2a30",
				"bytes": 50845
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "e9e790b7c0dcad063b8e1728a4c913ae88d85d58b82e720cddb83b766f85038d",
				"bytes": 74193
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "987ec869208386cb35c906ec297d7281ed5e202af385870c94083df093f7685e",
				"bytes": 11424
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
