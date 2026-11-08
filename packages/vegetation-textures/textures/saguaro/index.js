// Written by tools/plant-textures from the reference set: the texture files of the species
// saguaro, as `bun run plants:textures saguaro` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "saguaro",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-spine-texture-face.png",
					"sha256": "9651ac9604fd09adb88f8a078c25a48137038a0239a4f02f2e1d1d69de1749b1",
					"job": "302870d0-5705-4d22-a0c0-a53465927197"
				},
				{
					"name": "25-spine-texture-side.png",
					"sha256": "ca84169b1f0b591cdf6da60c2520af596f6a631fc559f50c287952ec96ef8ca8",
					"job": "f0246324-f6c1-431c-a0b7-d4b0d8a0e5b8"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "c87b0416032f7cd1a2d4abca8413cef6c2473b13ace01fe3588936e612f891fe",
					"job": "28b4c760-f5df-4649-9a77-119a12747dc8"
				},
				{
					"name": "14-base.png",
					"sha256": "170b7df56ab734a1ee313db471903a59dbf2429d2f0169def925ee75b3687792",
					"job": "8a4f3a01-dc8b-4ae7-92d0-2de4ed815a0e"
				},
				{
					"name": "16-skin-on-arm.png",
					"sha256": "38a6af5f974c260654d344d105bf601b32c9b89afd7228184f1b304a15a31a1f",
					"job": "5b1aac29-ea33-4467-a8c4-3702fa565d52"
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
			"length": 0.78768,
			"frame": {
				"petiole": [
					0.5,
					0.04263
				],
				"base": [
					0.5,
					0.16699
				],
				"tip": [
					0.5,
					0.95467
				]
			},
			"outline": [
				0.4995,
				0.9598,
				0.4399,
				0.5375,
				0.4053,
				0.6128,
				0.4189,
				0.4927,
				0.3188,
				0.6688,
				0.3689,
				0.4829,
				0.2957,
				0.5601,
				0.3747,
				0.4517,
				0.2407,
				0.5174,
				0.3485,
				0.4263,
				0.3071,
				0.4495,
				0.313,
				0.3973,
				0.2214,
				0.4341,
				0.3022,
				0.3882,
				0.2681,
				0.3572,
				0.1959,
				0.3657,
				0.2587,
				0.3481,
				0.1512,
				0.228,
				0.3491,
				0.2863,
				0.2538,
				0.1948,
				0.3223,
				0.2251,
				0.2664,
				0.1353,
				0.3872,
				0.2263,
				0.3213,
				0.1167,
				0.4048,
				0.2054,
				0.439,
				0.1906,
				0.397,
				0.0663,
				0.4888,
				0.1727,
				0.5005,
				0.0414,
				0.5079,
				0.1714,
				0.5376,
				0.1725,
				0.5355,
				0.103,
				0.5503,
				0.1393,
				0.5718,
				0.0941,
				0.5835,
				0.1979,
				0.6528,
				0.0342,
				0.6372,
				0.1298,
				0.7046,
				0.0001,
				0.6694,
				0.1859,
				0.7087,
				0.1401,
				0.6728,
				0.2144,
				0.7527,
				0.1714,
				0.6673,
				0.2358,
				0.691,
				0.2378,
				0.6678,
				0.2749,
				0.7991,
				0.2505,
				0.6606,
				0.2933,
				0.6592,
				0.3198,
				0.8089,
				0.354,
				0.6591,
				0.3472,
				0.7835,
				0.4253,
				0.6564,
				0.3765,
				0.6926,
				0.4468,
				0.641,
				0.4155,
				0.7584,
				0.5142,
				0.6359,
				0.4331,
				0.6969,
				0.5591,
				0.6265,
				0.4802,
				0.6739,
				0.6655,
				0.6099,
				0.5541,
				0.6168,
				0.6382,
				0.5952,
				0.604,
				0.5542,
				0.8575,
				0.5285,
				0.5884
			],
			"mean": {
				"upper": [
					0.30193,
					0.2552,
					0.21411
				],
				"lower": [
					0.2968,
					0.25251,
					0.21316
				]
			},
			"veins": {
				"luminance": 0.25048,
				"contrast": 3.335
			},
			"profile": {
				"upper": [
					0.29031,
					0.26125,
					0.23777,
					0.32248,
					0.20133,
					0.22417,
					0.10312,
					0.04486
				],
				"lower": [
					0.27432,
					0.24769,
					0.24152,
					0.24607,
					0.31567,
					0.29649,
					0.18175,
					0.05021
				]
			},
			"coverage": 0.1442
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.94,
						0.5
					],
					"mean": [
						0.17194,
						0.21647,
						0.155
					],
					"height": {
						"offset": 0.20256,
						"depth": 0.004238
					}
				},
				{
					"name": "base",
					"tile": [
						0.9,
						0.9
					],
					"mean": [
						0.29974,
						0.26716,
						0.23243
					],
					"height": {
						"offset": 0.27158,
						"depth": 0.007222
					}
				}
			],
			"young": {
				"tile": [
					0.75,
					0.5
				],
				"mean": [
					0.28334,
					0.30786,
					0.20951
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "3e6ec455b7dbe5dcfe7a5c179c7f4421ad04773745a8dd24e9ec6f0e9edd933e",
				"bytes": 222274
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "218b82bbe6435fb4bce0ff34538949c93e27bf846368484f3c0e4a787b504b67",
				"bytes": 17808
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "fa05c64fad0b800cf2cf5631b9860779e99ae48c34c461acdaafab10644d9660",
				"bytes": 77591
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "b9825406455a4c01f4eb19ca79a9b572c36abfb3a2224950c9572be2e2c845c9",
				"bytes": 6985
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "679bf9b76528348ab758846d37f0c5d7de181fe55e5e07c47efaeb9759ce0cfa",
				"bytes": 342866
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "0815575c1e18e60c6416333a4d8d74c8f21351611f4b24473688aa6632013a32",
				"bytes": 259131
			},
			{
				"file": "young-color.ktx2",
				"sha256": "279649ec116e8a1983ff839e12774b3ab633412a4bb70a1bdf60cd47cda56f49",
				"bytes": 50181
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "d89f9d4f0dca84af49d0521228e404fab63f41f994beb2117a18199b249bbdeb",
				"bytes": 22476
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "596a4d3eefa133cdce1845fc940f55cd3e17633ed455040aea50ed77ddd71b46",
				"bytes": 95950
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "3ae28a2260b34348217db58466e15b2f957e29fba45ca0d54fecef3f885fe8a4",
				"bytes": 71947
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "ab05a3fa24a7913a1ceadfea887eb171ce3c2ff6589073e29cf08effc4fc34e4",
				"bytes": 14874
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "b6d6d2cb3f9e4689b19cda9ab62836c7c01a3b16ab69476357bc0a76a08da031",
				"bytes": 7199
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
