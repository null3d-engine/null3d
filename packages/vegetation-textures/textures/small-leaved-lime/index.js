// Written by tools/plant-textures from the reference set: the texture files of the species
// small-leaved-lime, as `bun run plants:textures small-leaved-lime` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "small-leaved-lime",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "8583ac85d79f8a5bf41aa9617dd48720ea81cc3722a729ebb06e605740a41f6e",
					"job": "18ca09be-6025-4d2e-96ef-08a8f71b6cd2"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "5b6dfd2c0ab3305d00bd95ccfaecf05efe391ef8bc7eed985df0c7323df60630",
					"job": "f9b7550e-d026-4b3a-97b8-74513f46916f"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "6d9bc29779db0de14c7721dd89032bcd2287b3a33021a083a7e5cf8b8590daf2",
					"job": "aa8a6523-ba9a-4825-b911-d0220da20414"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "3958dae500bb8eea21fe5408ebce3278f80ee325b77c847ce658b3849029b802",
					"job": "9ca902a5-d235-4141-9684-4e005d65c1f8"
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
			"length": 0.59031,
			"frame": {
				"petiole": [
					0.5,
					0.19288
				],
				"base": [
					0.5,
					0.21387
				],
				"tip": [
					0.5,
					0.80417
				]
			},
			"outline": [
				0.4995,
				0.8087,
				0.4253,
				0.7981,
				0.3823,
				0.7808,
				0.3361,
				0.7495,
				0.3377,
				0.7407,
				0.2739,
				0.6846,
				0.2195,
				0.5747,
				0.2267,
				0.5659,
				0.2145,
				0.5532,
				0.2213,
				0.5454,
				0.209,
				0.5122,
				0.2169,
				0.5054,
				0.2099,
				0.4907,
				0.2189,
				0.48,
				0.2199,
				0.438,
				0.1908,
				0.4058,
				0.2368,
				0.3833,
				0.2615,
				0.3364,
				0.2591,
				0.3228,
				0.2745,
				0.3149,
				0.2717,
				0.3022,
				0.2876,
				0.2979,
				0.2866,
				0.2865,
				0.3022,
				0.284,
				0.3015,
				0.272,
				0.3149,
				0.2718,
				0.315,
				0.2612,
				0.3462,
				0.2449,
				0.3501,
				0.2319,
				0.3667,
				0.2332,
				0.3716,
				0.2204,
				0.3843,
				0.2235,
				0.4224,
				0.2004,
				0.479,
				0.1984,
				0.4819,
				0.191,
				0.5015,
				0.1982,
				0.5063,
				0.1905,
				0.5708,
				0.207,
				0.5767,
				0.2008,
				0.6421,
				0.2289,
				0.6753,
				0.263,
				0.6823,
				0.2583,
				0.6948,
				0.2798,
				0.7026,
				0.2759,
				0.7339,
				0.314,
				0.7396,
				0.3364,
				0.7476,
				0.3345,
				0.7802,
				0.4175,
				0.7749,
				0.4771,
				0.73,
				0.5283,
				0.6729,
				0.5435,
				0.8062,
				0.579,
				0.9751,
				0.6,
				0.9795,
				0.6099,
				0.9634,
				0.6303,
				0.6678,
				0.561,
				0.7143,
				0.6187,
				0.7207,
				0.6685,
				0.7096,
				0.7065,
				0.6987,
				0.7086,
				0.6938,
				0.7277,
				0.6694,
				0.7519,
				0.6294,
				0.7765,
				0.5728,
				0.799
			],
			"mean": {
				"upper": [
					0.03937,
					0.09255,
					0.01103
				],
				"lower": [
					0.26735,
					0.32276,
					0.20113
				]
			},
			"veins": {
				"luminance": 0.063,
				"contrast": 6.199
			},
			"profile": {
				"upper": [
					0.07476,
					0.07513,
					0.07504,
					0.07408,
					0.07612,
					0.07557,
					0.0751,
					0.07668
				],
				"lower": [
					0.30069,
					0.30281,
					0.3029,
					0.30346,
					0.30364,
					0.30157,
					0.30296,
					0.29874
				]
			},
			"coverage": 0.2653
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.5,
						0.5
					],
					"mean": [
						0.21385,
						0.18534,
						0.14651
					],
					"height": {
						"offset": 0.18086,
						"depth": 0.052519
					}
				}
			],
			"young": {
				"tile": [
					0.2,
					0.2
				],
				"mean": [
					0.18983,
					0.09816,
					0.03608
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "ef46e22231f29562a4f0bed4c4e83626ad9be1cf95ee1f17df9e40cdd49c0b91",
				"bytes": 206527
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "7ac1f4fddcbee2c7a93f21eaf346ac0b6a68b90bf8c3cb45bf84b70e7be06eb2",
				"bytes": 58727
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "95a633b3b3684dfe3759e2600d74fed4664465970063428b684df6d01777e2ae",
				"bytes": 70161
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "f145bb43152b9e228be7f8c4136d1c371241d1b9380c0357db22ffe9482cd444",
				"bytes": 17729
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "a030a6cb633b631978a9db9a36f3db2d254dbd5ada56bea7b6e82ff44ec7d567",
				"bytes": 186362
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "4a8a1dce84b87861e8eb26e8dfff9bda1da06e07e22b6274a0bfca44d8cc2bcc",
				"bytes": 241648
			},
			{
				"file": "young-color.ktx2",
				"sha256": "4fa2b64e572e694183e0e4a9d3a91141ade71e0de28aafdd98a06953bf943176",
				"bytes": 56761
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "2db68d628b989afa239495239c756490d08cb468a31d8997cbc51d97be8de58f",
				"bytes": 44818
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "661dcfe3a80b89d9ca5f325e3617736c537d96d9f3a868ff4364c78670ff109d",
				"bytes": 52612
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "7d9b6a625d7f51d6ee2102b582a0722bd4fbd76849b3ae254a0c63356e17c7c6",
				"bytes": 71788
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "9c03bfcb07fc7ff87f90ff204d9100383b6d2fce33243db20c75a89bc88e7609",
				"bytes": 14981
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "3155d216f785d172897d4d3437aa9434ee43b461e4362184cc27f2693208c681",
				"bytes": 9663
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
