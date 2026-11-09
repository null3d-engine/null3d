// Written by tools/plant-textures from the reference set: the texture files of the species
// common-ash, as `bun run plants:textures common-ash` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "common-ash",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "8edb420fc94be26e8bb4d4d3a9977113b5321f582687ac807b43301dcdbdfcce",
					"job": "c6366f49-ed16-41a8-86ef-204bd53a38b5"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "8e898f932dab1f48ada50c0d2b80b9d611ec1204dff4a0223ab7ebf4d0864113",
					"job": "799f4957-d0fc-4340-8a3b-ef8586448a58"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "d97325e566c82f766ab01a0d469f5d4ecff41949094ca5776c6cf7727f0f224e",
					"job": "f7cb99b8-e5cf-4195-b888-4217f3116f5f"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "f59dc4c05f0712cf55c96ac19e36e7cdc215a10c2947e5f77cabad9b661ebe0b",
					"job": "3641cde9-1fb4-436b-a2c7-0031a42c1056"
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
			"length": 0.88539,
			"frame": {
				"petiole": [
					0.5,
					0.03682
				],
				"base": [
					0.5,
					0.0957
				],
				"tip": [
					0.5,
					0.98109
				]
			},
			"outline": [
				0.4966,
				0.9812,
				0.4853,
				0.8433,
				0.4439,
				0.7163,
				0.436,
				0.7198,
				0.4311,
				0.7095,
				0.4212,
				0.6558,
				0.4106,
				0.6587,
				0.4012,
				0.6089,
				0.395,
				0.594,
				0.3868,
				0.5952,
				0.3849,
				0.5308,
				0.3705,
				0.5298,
				0.3696,
				0.4855,
				0.3658,
				0.4673,
				0.3591,
				0.4653,
				0.3604,
				0.4038,
				0.3549,
				0.4009,
				0.3664,
				0.3394,
				0.3559,
				0.3345,
				0.3716,
				0.2661,
				0.3649,
				0.2642,
				0.39,
				0.1841,
				0.4377,
				0.0991,
				0.4844,
				0.0415,
				0.4866,
				0.0337,
				0.4764,
				0.021,
				0.5024,
				0.019,
				0.5366,
				0.0445,
				0.5591,
				0.0331,
				0.6002,
				0.0366,
				0.58,
				0.0522,
				0.5771,
				0.0708,
				0.6159,
				0.1479,
				0.648,
				0.2534,
				0.6512,
				0.2739,
				0.6465,
				0.2769,
				0.6572,
				0.3267,
				0.6474,
				0.3306,
				0.6582,
				0.3843,
				0.6472,
				0.3892,
				0.6531,
				0.4536,
				0.6428,
				0.4565,
				0.6483,
				0.4976,
				0.6431,
				0.5236,
				0.637,
				0.5249,
				0.6325,
				0.5835,
				0.6304,
				0.5889,
				0.6212,
				0.5864,
				0.6164,
				0.6509,
				0.6087,
				0.6499,
				0.6072,
				0.6812,
				0.6021,
				0.694,
				0.5962,
				0.6899,
				0.5846,
				0.7466,
				0.5753,
				0.7485,
				0.5708,
				0.7886,
				0.5644,
				0.7905,
				0.5552,
				0.9071,
				0.5483,
				0.9231,
				0.5298,
				0.8959,
				0.5065,
				0.9683
			],
			"mean": {
				"upper": [
					0.06545,
					0.13044,
					0.01373
				],
				"lower": [
					0.16877,
					0.24815,
					0.06166
				]
			},
			"veins": {
				"luminance": 0.10468,
				"contrast": 14.812
			},
			"profile": {
				"upper": [
					0.10782,
					0.10888,
					0.10766,
					0.10838,
					0.10807,
					0.10766,
					0.10863,
					0.10676
				],
				"lower": [
					0.21842,
					0.21834,
					0.21864,
					0.21773,
					0.21765,
					0.21628,
					0.21571,
					0.20933
				]
			},
			"coverage": 0.1768
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
						0.28905,
						0.26684,
						0.25698
					],
					"height": {
						"offset": 0.27085,
						"depth": 0.030601
					}
				}
			],
			"young": {
				"tile": [
					0.2,
					0.2
				],
				"mean": [
					0.18467,
					0.20102,
					0.11272
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "f2784bf8010895d87354aecf7973814022ef83219d335a1a9fbc1f5da67dc534",
				"bytes": 170634
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "d35de36a10bb7a2fdee1993b77fd16e02683e41c9aee9bb2838cac609c5bacda",
				"bytes": 27810
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "3dc389a20c013c127f6cb8d34e7cd0682e7b1a1f80b1ea427c57978462874c83",
				"bytes": 60676
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "4af005f9b0a096c8676943183f48c4fba971e9efbdc1ceec4d252257564982be",
				"bytes": 6599
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "52c9b4b669d1b472248594a1a0177e92b8eb279d885fe8460bebcf8be10ea337",
				"bytes": 191760
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "23272304e1497ac6c9fbf6526d3cddc6610eb1fd739d21bdbb6a695a15708bf9",
				"bytes": 240317
			},
			{
				"file": "young-color.ktx2",
				"sha256": "ca7601224e778eeca2b8f7342629311743f78a6001c85ecbf68697fc39b4d6fc",
				"bytes": 53779
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "6c8b58e0a0a99427bc5c499a10b87bcc44f901ea1b1f6b71f21a8e5d1852cddc",
				"bytes": 51046
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "c2cac3559b3d07a44d006db2774ef81d70d7cae238100c9114cae30f29111b66",
				"bytes": 53248
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "6cc4b8a86c257ec11fd30ad93fff147c3ca20323363b37e376263bb6743793ba",
				"bytes": 71453
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "f494d8ccf2db10cda8a9aa4fd0bb9af2d80b6a83ffd54afcce0197aaf4c441fa",
				"bytes": 14018
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "751a6feb8328a0e935f16bb1bad5d2813a6c8ad1c4aeba87f88f30a66b86e242",
				"bytes": 11706
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
