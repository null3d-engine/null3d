// Written by tools/plant-textures from the reference set: the texture files of the species
// weeping-willow, as `bun run plants:textures weeping-willow` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "weeping-willow",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "4f618b0f6c4b6a9754a389858e07ff1c1de7844a0570546dd71e29715d8bc35d",
					"job": "1dbbb9cc-3899-4fbd-9563-d5e9cbfad827"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "33c43efae8860e2436161dd634f32cc317da8a271f617227702867bd6222a3ff",
					"job": "bee63991-ed22-4aa5-b29b-5b5a0c88b471"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "5ab342ebcdf0b5381e0f2223ef2796bbd02be9efee474e0f1230b5a020f5d1f1",
					"job": "fc6541a9-b43e-4119-b51e-6414f25a5aab"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "9e7294a588c0186b6e30d98545bb13a41acac84c99d56b1f9d9936595c9738f0",
					"job": "0f826cdc-deae-4d6b-ad6f-8d65dde82ee7"
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
			"length": 0.61966,
			"frame": {
				"petiole": [
					0.5,
					0.02344
				],
				"base": [
					0.5,
					0.35352
				],
				"tip": [
					0.5,
					0.97317
				]
			},
			"outline": [
				0.4976,
				0.9782,
				0.4916,
				0.9722,
				0.4931,
				0.9351,
				0.4919,
				0.895,
				0.4821,
				0.8677,
				0.4673,
				0.8354,
				0.4677,
				0.8315,
				0.4473,
				0.7778,
				0.429,
				0.7075,
				0.4204,
				0.6431,
				0.4168,
				0.563,
				0.4181,
				0.561,
				0.4171,
				0.5532,
				0.4207,
				0.4819,
				0.4319,
				0.3853,
				0.4368,
				0.3599,
				0.4388,
				0.3579,
				0.4381,
				0.3521,
				0.4474,
				0.3052,
				0.4532,
				0.2847,
				0.4564,
				0.2642,
				0.4591,
				0.2593,
				0.459,
				0.2505,
				0.4627,
				0.2368,
				0.47,
				0.187,
				0.4734,
				0.1763,
				0.4747,
				0.1587,
				0.481,
				0.1274,
				0.4925,
				0.0454,
				0.4973,
				0.0229,
				0.5005,
				0.0214,
				0.5028,
				0.0259,
				0.4987,
				0.0649,
				0.4976,
				0.1121,
				0.504,
				0.0884,
				0.5063,
				0.0852,
				0.5082,
				0.0874,
				0.5029,
				0.1519,
				0.5034,
				0.1968,
				0.5122,
				0.2747,
				0.5196,
				0.3267,
				0.5217,
				0.3315,
				0.5217,
				0.3403,
				0.5235,
				0.3433,
				0.5385,
				0.4585,
				0.5402,
				0.4966,
				0.5418,
				0.4995,
				0.5413,
				0.5093,
				0.5431,
				0.5122,
				0.5424,
				0.522,
				0.5441,
				0.5249,
				0.5487,
				0.5845,
				0.5504,
				0.6655,
				0.5485,
				0.6987,
				0.5463,
				0.7095,
				0.5474,
				0.7124,
				0.5382,
				0.7749,
				0.5253,
				0.8325,
				0.5141,
				0.8667,
				0.5097,
				0.8862,
				0.5101,
				0.9185,
				0.5137,
				0.9614,
				0.5077,
				0.9653,
				0.5063,
				0.9767
			],
			"mean": {
				"upper": [
					0.10106,
					0.22365,
					0.01217
				],
				"lower": [
					0.25188,
					0.31662,
					0.17627
				]
			},
			"veins": {
				"luminance": 0.16644,
				"contrast": 3.427
			},
			"profile": {
				"upper": [
					0.18287,
					0.18325,
					0.18221,
					0.18089,
					0.1813,
					0.17971,
					0.17853,
					0.21255
				],
				"lower": [
					0.29406,
					0.29221,
					0.29281,
					0.29252,
					0.29176,
					0.29079,
					0.29422,
					0.30069
				]
			},
			"coverage": 0.0665
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.6,
						0.6
					],
					"mean": [
						0.17095,
						0.14297,
						0.1274
					],
					"height": {
						"offset": 0.1478,
						"depth": 0.054541
					}
				}
			],
			"young": {
				"tile": [
					0.2,
					0.2
				],
				"mean": [
					0.24907,
					0.17271,
					0.04376
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "e2335f35b0fe56506bbaece5d5b0aade624bea566c6dcf1424316c8ea926f5f5",
				"bytes": 118647
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "91fac849353b28f25196dfa9d463d22aeaaeb619187b54a255f9206cb779605e",
				"bytes": 19574
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "a41e9c9410391306e4dedfa8a303cbed1c37ae1984df7e89a02cdefbae099215",
				"bytes": 46546
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "766db17c7f677a44cb45491c29a0730db200a5cb94c5d7fd360fd44836a302f7",
				"bytes": 4943
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "c59d273c79494073b74b4070a133db503d0637ce903eaf7cf8178aab413fe022",
				"bytes": 195531
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "23e02636b4003d678f9b3cfbd4880255427b2fdbf5d8f470e78e0affae8c4389",
				"bytes": 240136
			},
			{
				"file": "young-color.ktx2",
				"sha256": "95602b311a562289357b695889f1e304dc6b1710d0e03356ddab79a1c8b288aa",
				"bytes": 55812
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "db77142e41101577e92e538727497b81bade893d17d42970cafbb1892c5763ad",
				"bytes": 57201
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "d56c2df2ab8020b11b49593cffc2605273ba7986f1a2f9285deba8805ae3a494",
				"bytes": 54063
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "35ad2170c372a9b3b285418d9086c94ee425edab4449297f1447e250dddcdc55",
				"bytes": 71433
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "034d46b50259e68fdc0455eec91e6ba3914f384641c7bbd29f7dd96553eea6cb",
				"bytes": 14801
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "4ec52457a893cac68f111c18354315ae13be2636d4a7aef4002c55f8601ac26a",
				"bytes": 13526
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
