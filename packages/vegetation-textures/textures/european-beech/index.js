// Written by tools/plant-textures from the reference set: the texture files of the species
// european-beech, as `bun run plants:textures european-beech` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "european-beech",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "fc0c561799df705a6541013cd08de6bb8831a95c753fedea47a0f8edd9d576af",
					"job": "9b3c461e-cad9-46fd-9083-e05eddc5d63e"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "c5d82b3498ef9d031e2450c47246ba2cfdef887f09baec870f4a0305d628b11e",
					"job": "7bcbc6f0-d90d-45f2-9e89-1756f4f3dec5"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "66c72eb3f3b4971e5503c57d4c2bf5efbdd18dbf74d7de583e8060d0bc541b5c",
					"job": "8b52621b-dcdb-43b3-9166-8e7ff280c159"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "a858447cd0c5df6cf334863411ffabaf8028d805b797507cc1fc7da1c784b6e0",
					"job": "ec102ed4-4305-4a5a-83db-5f7398198043"
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
			"length": 0.88135,
			"frame": {
				"petiole": [
					0.5,
					0.02285
				],
				"base": [
					0.5,
					0.0918
				],
				"tip": [
					0.5,
					0.97314
				]
			},
			"outline": [
				0.4985,
				0.9792,
				0.4802,
				0.9526,
				0.4653,
				0.9395,
				0.397,
				0.9071,
				0.3804,
				0.888,
				0.356,
				0.8774,
				0.3494,
				0.8638,
				0.3247,
				0.8511,
				0.3157,
				0.8403,
				0.3044,
				0.813,
				0.2775,
				0.7964,
				0.2588,
				0.772,
				0.2321,
				0.7124,
				0.2153,
				0.6892,
				0.2027,
				0.6187,
				0.18,
				0.5864,
				0.1779,
				0.561,
				0.1872,
				0.5327,
				0.1889,
				0.5093,
				0.167,
				0.4526,
				0.1699,
				0.4302,
				0.1862,
				0.395,
				0.1879,
				0.3472,
				0.2111,
				0.3052,
				0.243,
				0.272,
				0.2531,
				0.23,
				0.2624,
				0.2163,
				0.3159,
				0.1785,
				0.353,
				0.1375,
				0.3911,
				0.1118,
				0.4341,
				0.0951,
				0.4858,
				0.0829,
				0.4896,
				0.0757,
				0.4895,
				0.0259,
				0.4995,
				0.0205,
				0.509,
				0.022,
				0.5198,
				0.0376,
				0.5143,
				0.0884,
				0.5796,
				0.1049,
				0.6177,
				0.1316,
				0.6436,
				0.1431,
				0.7046,
				0.1997,
				0.7271,
				0.2134,
				0.7536,
				0.2427,
				0.7606,
				0.2544,
				0.766,
				0.2964,
				0.7974,
				0.3391,
				0.8105,
				0.3667,
				0.8135,
				0.3901,
				0.8077,
				0.4263,
				0.8264,
				0.5015,
				0.8076,
				0.562,
				0.8103,
				0.6011,
				0.8061,
				0.6304,
				0.7736,
				0.6812,
				0.7534,
				0.7426,
				0.712,
				0.7827,
				0.6831,
				0.8377,
				0.6509,
				0.855,
				0.602,
				0.9048,
				0.5786,
				0.9119,
				0.5356,
				0.9361,
				0.5249,
				0.9468,
				0.5147,
				0.9673
			],
			"mean": {
				"upper": [
					0.06885,
					0.15132,
					0.01712
				],
				"lower": [
					0.25904,
					0.29286,
					0.13552
				]
			},
			"veins": {
				"luminance": 0.11535,
				"contrast": 6.646
			},
			"profile": {
				"upper": [
					0.1243,
					0.12439,
					0.12303,
					0.12411,
					0.12364,
					0.12403,
					0.12496,
					0.12444
				],
				"lower": [
					0.2757,
					0.27462,
					0.27446,
					0.27497,
					0.27494,
					0.27406,
					0.27365,
					0.26689
				]
			},
			"coverage": 0.4017
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
						0.32744,
						0.32973,
						0.33157
					],
					"height": {
						"offset": 0.32937,
						"depth": 0.005019
					}
				}
			],
			"young": {
				"tile": [
					0.2,
					0.2
				],
				"mean": [
					0.2051,
					0.19375,
					0.15557
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "1f9dad3fb7ab1b1c27f92cd402a2b6400acaff3da8fd1f6192aa2a407b66fb88",
				"bytes": 235082
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "f558e10adac979c6b660a83120836f87802a06493dda53b0430de110306f8365",
				"bytes": 63516
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "51318bb08a8498d370abad7730e1dd6dc7b5122a0c8126ff87fe6ac7c677b1f8",
				"bytes": 74933
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "42b80f5468fcaccadec9f66c34c1247b795e865b34d5bd507a9379acbee8fa89",
				"bytes": 14597
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "621679e91af0084c5b85e9b2c31fbf0321dba8917af997e7904d8fb52322c75d",
				"bytes": 172100
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "ab0e6003369123db7fbf3e010e599b0f202dfbdda78f85a115a063c4dede6d49",
				"bytes": 169171
			},
			{
				"file": "young-color.ktx2",
				"sha256": "e4f1333a853923239b6ade9cfef0a41b16af7fa05c2f974b3f2b803ad96d8c1d",
				"bytes": 52398
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "be065195ff4616883c43f9c6a07908e84ebe8eed5b6290359285adae6fc3c6d4",
				"bytes": 56240
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "6a079d9a7324c3f02a52308372c433616a161265379378a6d5eebfdc2862e264",
				"bytes": 49254
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "b3cc009a6ece9077192523051510d06c304bdeaecce1ff83b35cd1bf47ca590a",
				"bytes": 51266
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "1bab3b2ec98facae375adecbd30817db10102ff048ff6476d6955227c2f85bbd",
				"bytes": 13569
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "2ae63d471e1455ae087cc882b29a2901fb28ce82beb9824f096b0cb108abf00d",
				"bytes": 12880
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
