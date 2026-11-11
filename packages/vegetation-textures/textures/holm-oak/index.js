// Written by tools/plant-textures from the reference set: the texture files of the species
// holm-oak, as `bun run plants:textures holm-oak` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "holm-oak",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "b1ee03f96df8504ab0bfb24a75b43881645888dd7a51a3432cde6ecf04696c15",
					"job": "4b019242-c0dd-4d23-8e3d-e10327efd36d"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "9a37ac409ebe8780c66507811d6025f25c8ed56b9b8eb2a1901aaf6ad9d8c2c3",
					"job": "16796c77-59bc-464c-b83e-7236a021c24e"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "c31fb681abcc57912b60211542cf47920b7a41c432a0454cee1466862b7465f1",
					"job": "346ac59c-96cb-4297-a461-10cff08d1a83"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "93ad1ebe430d70bc2e4d35ec4796926618051237eb58b2b4db817526325b8a34",
					"job": "5048560c-b9bc-4339-b554-390efa6213f4"
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
			"length": 0.85065,
			"frame": {
				"petiole": [
					0.5,
					0.02146
				],
				"base": [
					0.5,
					0.12793
				],
				"tip": [
					0.5,
					0.97858
				]
			},
			"outline": [
				0.5005,
				0.9782,
				0.4948,
				0.9614,
				0.4906,
				0.9585,
				0.4807,
				0.938,
				0.46,
				0.9106,
				0.4507,
				0.9023,
				0.4419,
				0.8983,
				0.4351,
				0.8991,
				0.4246,
				0.9067,
				0.43,
				0.8921,
				0.4257,
				0.8774,
				0.3927,
				0.8306,
				0.3499,
				0.7534,
				0.3215,
				0.6792,
				0.3043,
				0.6167,
				0.2921,
				0.5376,
				0.2898,
				0.4858,
				0.2923,
				0.438,
				0.3019,
				0.3853,
				0.3225,
				0.3071,
				0.339,
				0.2661,
				0.3585,
				0.23,
				0.3906,
				0.1831,
				0.4048,
				0.1657,
				0.436,
				0.137,
				0.4714,
				0.1167,
				0.4767,
				0.0786,
				0.4862,
				0.0366,
				0.4907,
				0.0249,
				0.5005,
				0.0209,
				0.5161,
				0.0244,
				0.5224,
				0.0327,
				0.5226,
				0.0376,
				0.5122,
				0.0728,
				0.5156,
				0.0796,
				0.5154,
				0.0845,
				0.5115,
				0.0981,
				0.5103,
				0.1161,
				0.5337,
				0.1284,
				0.5526,
				0.1411,
				0.5726,
				0.1587,
				0.5934,
				0.1812,
				0.6268,
				0.23,
				0.6517,
				0.2749,
				0.665,
				0.3032,
				0.6772,
				0.3364,
				0.6981,
				0.4194,
				0.7037,
				0.4751,
				0.7038,
				0.5034,
				0.7007,
				0.5649,
				0.6963,
				0.604,
				0.6854,
				0.6528,
				0.6619,
				0.7241,
				0.6497,
				0.7505,
				0.6003,
				0.8384,
				0.5706,
				0.8813,
				0.5675,
				0.896,
				0.5728,
				0.9111,
				0.5591,
				0.9004,
				0.5532,
				0.9006,
				0.5435,
				0.9065,
				0.5304,
				0.9214,
				0.515,
				0.9438,
				0.5051,
				0.9624
			],
			"mean": {
				"upper": [
					0.03053,
					0.0587,
					0.01248
				],
				"lower": [
					0.31361,
					0.31615,
					0.25788
				]
			},
			"veins": {
				"luminance": 0.03797,
				"contrast": 7.485
			},
			"profile": {
				"upper": [
					0.04445,
					0.04888,
					0.04796,
					0.04868,
					0.04905,
					0.04827,
					0.04972,
					0.05446
				],
				"lower": [
					0.30684,
					0.31054,
					0.31184,
					0.31168,
					0.31272,
					0.31159,
					0.31444,
					0.31082
				]
			},
			"coverage": 0.2471
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.2,
						0.2
					],
					"mean": [
						0.06298,
						0.05696,
						0.05371
					],
					"height": {
						"offset": 0.058,
						"depth": 0.054377
					}
				}
			],
			"young": {
				"tile": [
					0.2,
					0.2
				],
				"mean": [
					0.10257,
					0.10022,
					0.095
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "3d39a5f2d12c777b38794a5c55835fc32d7c888e1afbeb581be2aec437c9280e",
				"bytes": 180951
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "2fc6d697ab9763b1f952d701c5d8e2cdd9b540ae63c430b98f112e6f3ec7545e",
				"bytes": 58291
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "6e80a4acde06037ec458fd6b19d4e5699cb14061d7254f68136a6969cbdd31f2",
				"bytes": 61269
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "c0e7e8b01617b6a8170b279eca8a6c350a0a909491bc14e295b6c6f7bac96e71",
				"bytes": 18299
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "27e4b36be976655c394edf3457e1207930275d970241b2a49daaac7c27de636f",
				"bytes": 186975
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "231762bc18c58fc95df98b55aca7296429569f84406365a4f4631151b673b91d",
				"bytes": 254768
			},
			{
				"file": "young-color.ktx2",
				"sha256": "0fd471877a30dbee941bd77f5a1dd9094f047d4a4d26aced6d068badb4077bc5",
				"bytes": 51653
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "ac49a93b3900268e5535342b4c37b8f54ed7b5a813a116da063133a8a0d910f5",
				"bytes": 58556
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "4ade2fc4458edd8fe581f840c2fdb38942d187896549cca957d0e7798a6f0e8d",
				"bytes": 52018
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "58144e8393275dff029a2cb3c1b27d99834c4be58b02df83e1b4e2525927ec62",
				"bytes": 73556
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "731d15018dd67a01644b0e536ca79bf6c7e6fc3460b52368ad482740fd93d751",
				"bytes": 13407
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "9d58e75902cbc6e6ead4fd1db59118299b8ed0799d3217fa9b97b39dd77f274f",
				"bytes": 13388
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
