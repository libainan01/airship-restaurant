/* 此文件由 npm run dialogue:generate 自动生成，请勿手动编辑。 */

export const GENERATED_DIALOGUE_CATALOG = {
  "schemaVersion": 1,
  "locations": [
    {
      "id": "location.greyfeather_beacon",
      "name": "灰羽航标塔"
    }
  ],
  "speakers": [
    {
      "id": "speaker.baiyecheng",
      "name": "白夜城",
      "characterId": "character.baiyecheng"
    },
    {
      "id": "speaker.otto",
      "name": "奥托",
      "characterId": "character.otto"
    },
    {
      "id": "speaker.martha_bell",
      "name": "玛莎·贝尔",
      "characterId": "character.martha_bell"
    },
    {
      "id": "speaker.thomas_bell",
      "name": "托马斯·贝尔",
      "characterId": "character.thomas_bell"
    },
    {
      "id": "speaker.courier",
      "name": "送信员",
      "characterId": null
    },
    {
      "id": "speaker.mechanic",
      "name": "修理工",
      "characterId": null
    },
    {
      "id": "speaker.linesman",
      "name": "巡线员",
      "characterId": null
    },
    {
      "id": "speaker.merchant",
      "name": "商贩",
      "characterId": null
    },
    {
      "id": "speaker.traveler",
      "name": "旅客",
      "characterId": null
    },
    {
      "id": "speaker.miner",
      "name": "矿工",
      "characterId": null
    },
    {
      "id": "speaker.older_woman",
      "name": "老妇人",
      "characterId": null
    },
    {
      "id": "speaker.apprentice",
      "name": "学徒",
      "characterId": null
    },
    {
      "id": "speaker.guard",
      "name": "守卫",
      "characterId": null
    },
    {
      "id": "speaker.mercenary",
      "name": "佣兵",
      "characterId": null
    },
    {
      "id": "speaker.bookkeeper",
      "name": "记账员",
      "characterId": null
    },
    {
      "id": "speaker.young_guest",
      "name": "年轻客人",
      "characterId": null
    },
    {
      "id": "speaker.older_guest",
      "name": "老人",
      "characterId": null
    },
    {
      "id": "speaker.crew_member",
      "name": "乘务员",
      "characterId": null
    },
    {
      "id": "speaker.porter",
      "name": "搬运工",
      "characterId": null
    },
    {
      "id": "speaker.regular_a",
      "name": "熟客甲",
      "characterId": null
    },
    {
      "id": "speaker.regular_b",
      "name": "熟客乙",
      "characterId": null
    },
    {
      "id": "speaker.regular",
      "name": "熟客",
      "characterId": null
    },
    {
      "id": "speaker.colleague",
      "name": "同事",
      "characterId": null
    },
    {
      "id": "speaker.mother",
      "name": "母亲",
      "characterId": null
    },
    {
      "id": "speaker.neighbor",
      "name": "邻居",
      "characterId": null
    }
  ]
} as const;

export const GENERATED_DIALOGUE_CHAPTERS = [
  {
    "schemaVersion": 1,
    "chapterId": "chapter.m3.greyfeather",
    "title": "M3 灰羽航标塔",
    "locationId": "location.greyfeather_beacon",
    "defaults": {
      "lineDurationMs": 5000,
      "ambientWeight": 100,
      "ambientCooldownMs": 600000,
      "ambientMaxPlaysPerSession": 1
    },
    "ambientDialogues": [
      {
        "id": "dialogue.ambient.d001_cold_wind",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.courier",
            "text": "先来碗热汤。风快把耳朵刮走了。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d002_no_machine_oil",
        "contexts": [
          "arrival"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.mechanic",
            "text": "闻着不像机油。好兆头。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d003_crisp_bread",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.linesman",
            "text": "面包烤脆一点，我还得走半天。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d004_one_more_plate",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.merchant",
            "text": "我只坐一会儿……再加一份也行。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d005_airship_sickness",
        "contexts": [
          "arrival"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.traveler",
            "text": "飞艇餐厅？吃完不会晕船吧？"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d006_yesterday_drinks",
        "contexts": [
          "arrival"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.miner",
            "text": "今天不喝酒。昨天的我已经喝过了。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d007_dip_the_soup",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.older_woman",
            "text": "别急着收盘，我还想蘸一点汤。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d008_more_meat",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.apprentice",
            "text": "最便宜的套餐……肉多一点可以吗？"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d009_bridge_closed",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.courier",
            "text": "北边的桥又封了。"
          },
          {
            "speakerId": "speaker.linesman",
            "text": "昨天不是刚修好吗？"
          },
          {
            "speakerId": "speaker.courier",
            "text": "昨天是风，今天是羊群。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d010_workshop_smell",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.mechanic",
            "text": "你闻到我身上的机油味了吗？"
          },
          {
            "speakerId": "speaker.apprentice",
            "text": "没有。"
          },
          {
            "speakerId": "speaker.mechanic",
            "text": "那就先吃饭，别回工坊了。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d011_borrowed_armor",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.guard",
            "text": "你这身盔甲是新的？"
          },
          {
            "speakerId": "speaker.mercenary",
            "text": "借来的。"
          },
          {
            "speakerId": "speaker.guard",
            "text": "那喝汤的时候小心点。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d012_flying_restaurant",
        "contexts": [
          "arrival"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.merchant",
            "text": "听说这家餐厅是从旧港飞来的。"
          },
          {
            "speakerId": "speaker.bookkeeper",
            "text": "先吃一口，再决定信不信。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d013_someone_with_me",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.young_guest",
            "text": "你怎么每天都点一样的？"
          },
          {
            "speakerId": "speaker.older_guest",
            "text": "今天和昨天不一样。"
          },
          {
            "speakerId": "speaker.young_guest",
            "text": "哪里不一样？"
          },
          {
            "speakerId": "speaker.older_guest",
            "text": "今天有人陪我吃。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d014_new_route",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.crew_member",
            "text": "新航线快是快，就是看不见地面了。"
          },
          {
            "speakerId": "speaker.traveler",
            "text": "看不见也好，省得害怕。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d015_beacon_light",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.linesman",
            "text": "灰羽航标塔以前整夜都亮着。"
          },
          {
            "speakerId": "speaker.courier",
            "text": "现在呢？"
          },
          {
            "speakerId": "speaker.linesman",
            "text": "现在只为偶尔经过的人亮。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d016_southern_route",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.merchant",
            "text": "听说南边又开了一条航路。"
          },
          {
            "speakerId": "speaker.porter",
            "text": "那这里会更冷清吧？"
          },
          {
            "speakerId": "speaker.merchant",
            "text": "有热饭就不算冷清。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d017_magic_stove",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "new",
        "lines": [
          {
            "speakerId": "speaker.mechanic",
            "text": "新式魔导炉不用煤了。"
          },
          {
            "speakerId": "speaker.miner",
            "text": "那你为什么脸还是黑的？"
          },
          {
            "speakerId": "speaker.mechanic",
            "text": "我昨天修的是旧式的。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d018_salty_stew",
        "contexts": [
          "eating"
        ],
        "minimumFamiliarity": "regular",
        "lines": [
          {
            "speakerId": "speaker.regular_a",
            "text": "上次那份炖菜还有吗？"
          },
          {
            "speakerId": "speaker.regular_b",
            "text": "你不是说太咸？"
          },
          {
            "speakerId": "speaker.regular_a",
            "text": "所以我今天带了水。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d019_brought_colleague",
        "contexts": [
          "arrival"
        ],
        "minimumFamiliarity": "returning",
        "lines": [
          {
            "speakerId": "speaker.regular",
            "text": "我把同事带来了。"
          },
          {
            "speakerId": "speaker.colleague",
            "text": "你没说餐厅会晃。"
          },
          {
            "speakerId": "speaker.regular",
            "text": "我也没说饭这么香。"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d020_waiting_for_return",
        "contexts": [
          "departing"
        ],
        "minimumFamiliarity": "regular",
        "prerequisiteEventIds": [
          "story.bell_stew_first_service"
        ],
        "lines": [
          {
            "speakerId": "speaker.linesman",
            "text": "他们还会回来吗？"
          },
          {
            "speakerId": "speaker.mechanic",
            "text": "你都问第三次了。"
          },
          {
            "speakerId": "speaker.linesman",
            "text": "那你怎么也天天在这里等？"
          }
        ]
      },
      {
        "id": "dialogue.ambient.d021_son_returns",
        "contexts": [
          "waiting"
        ],
        "minimumFamiliarity": "returning",
        "lines": [
          {
            "speakerId": "speaker.mother",
            "text": "我儿子下周从矿区回来。"
          },
          {
            "speakerId": "speaker.neighbor",
            "text": "那得多点一道菜。"
          },
          {
            "speakerId": "speaker.mother",
            "text": "等他真的回来再点。"
          }
        ]
      }
    ],
    "storyDialogues": [
      {
        "id": "dialogue.story.greyfeather_arrival",
        "lines": [
          {
            "speakerId": "speaker.baiyecheng",
            "text": "这页……是玛莎写的。"
          },
          {
            "speakerId": "speaker.otto",
            "text": "灰羽航标塔就在前方。"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "那先把炉子点起来吧。"
          }
        ]
      },
      {
        "id": "dialogue.story.bell_reunion",
        "lines": [
          {
            "speakerId": "speaker.martha_bell",
            "text": "炊事班长？"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "现在是餐馆老板。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "开到天上去了？"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "厨房先到了，招牌还在路上。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "我就说这味道熟悉。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "你闻见炖菜都这么说。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "所以这次总算说对了。"
          }
        ]
      },
      {
        "id": "dialogue.story.martha_wartime_wish",
        "lines": [
          {
            "speakerId": "speaker.baiyecheng",
            "text": "你的愿望，我还留着。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "那本破册子还没扔？"
          },
          {
            "speakerId": "speaker.otto",
            "text": "保存状况：不建议触碰。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "她其实一直记得。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "当年那锅可别照原样做。"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "胡萝卜别煮软，我记得。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "我们后来改过一些。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "是改过很多。"
          }
        ]
      },
      {
        "id": "dialogue.story.bell_stew_cooking",
        "lines": [
          {
            "speakerId": "speaker.martha_bell",
            "text": "胡萝卜最后再放。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "我记得。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "你上次也这么说。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "可你上次也吃完了。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "那是因为不能浪费。"
          }
        ]
      },
      {
        "id": "dialogue.story.bell_stew_first_service",
        "lines": [
          {
            "speakerId": "speaker.otto",
            "text": "贝尔家的炖菜，两份。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "先放他那边，他怕烫还吃得急。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "她那份胡萝卜要先盛。"
          },
          {
            "speakerId": "speaker.otto",
            "text": "正在处理相互矛盾的优先级。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "胡萝卜还行。"
          },
          {
            "speakerId": "speaker.thomas_bell",
            "text": "这对她来说就是很好。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "吃你的。"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "和我记得的不太一样。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "人都老了，菜还不许改？"
          }
        ]
      },
      {
        "id": "dialogue.story.linesman_new_wish",
        "lines": [
          {
            "speakerId": "speaker.linesman",
            "text": "下次会做奶酪面包吗？"
          },
          {
            "speakerId": "speaker.otto",
            "text": "当前食谱没有记录。"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "笔记末尾还有空页。"
          },
          {
            "speakerId": "speaker.linesman",
            "text": "那……可以先写上吗？"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "当然可以。"
          }
        ]
      },
      {
        "id": "dialogue.story.bell_departure",
        "lines": [
          {
            "speakerId": "speaker.thomas_bell",
            "text": "下次来，我给你们留些塔下的香草。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "先说好，不是送，是换饭。"
          },
          {
            "speakerId": "speaker.baiyecheng",
            "text": "那得多来几次才换得完。"
          },
          {
            "speakerId": "speaker.martha_bell",
            "text": "少得意。"
          }
        ]
      }
    ]
  }
] as const;
