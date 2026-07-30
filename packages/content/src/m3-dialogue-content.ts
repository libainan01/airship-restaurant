import type {
  AmbientDialogueContext,
  AmbientDialogueDefinition,
  DialogueFamiliarity,
  DialogueLineDefinition,
  DialogueSpeakerDefinition,
  LocationDefinition,
  StoryDialogueDefinition,
} from "./definitions";

const LINE_DURATION_MS = 5_000;
const AMBIENT_COOLDOWN_MS = 10 * 60_000;
const localizations: Record<string, string> = {};

interface DialogueLineDraft {
  readonly speakerId: string;
  readonly text: string;
}

function createSpeaker(
  id: string,
  name: string,
  characterId: string | null = null,
): DialogueSpeakerDefinition {
  const localizationKey = `localization.${id}.name`;
  localizations[localizationKey] = name;
  return Object.freeze({
    id,
    name,
    localizationKey,
    characterId,
  });
}

function createLines(
  dialogueId: string,
  drafts: readonly DialogueLineDraft[],
): readonly DialogueLineDefinition[] {
  return Object.freeze(
    drafts.map((draft, index) => {
      const localizationKey =
        `localization.${dialogueId}.line_${index + 1}`;
      localizations[localizationKey] = draft.text;
      return Object.freeze({
        speakerId: draft.speakerId,
        localizationKey,
        durationMs: LINE_DURATION_MS,
      });
    }),
  );
}

function createAmbientDialogue(
  suffix: string,
  contexts: readonly AmbientDialogueContext[],
  minimumFamiliarity: DialogueFamiliarity,
  drafts: readonly DialogueLineDraft[],
  prerequisiteEventIds: readonly string[] = [],
): AmbientDialogueDefinition {
  const id = `dialogue.ambient.${suffix}`;
  return Object.freeze({
    id,
    kind: "ambient",
    locationId: "location.greyfeather_beacon",
    contexts: Object.freeze([...contexts]),
    minimumFamiliarity,
    weight: 100,
    cooldownMs: AMBIENT_COOLDOWN_MS,
    maxPlaysPerSession: 1,
    prerequisiteEventIds: Object.freeze([
      ...prerequisiteEventIds,
    ]),
    lines: createLines(id, drafts),
  });
}

function createStoryDialogue(
  suffix: string,
  drafts: readonly DialogueLineDraft[],
): StoryDialogueDefinition {
  const id = `dialogue.story.${suffix}`;
  return Object.freeze({
    id,
    kind: "story",
    lines: createLines(id, drafts),
  });
}

const greyfeatherLocationKey =
  "localization.location.greyfeather_beacon.name";
localizations[greyfeatherLocationKey] = "灰羽航标塔";

export const M3_LOCATIONS: readonly LocationDefinition[] =
  Object.freeze([
    Object.freeze({
      id: "location.greyfeather_beacon",
      name: "灰羽航标塔",
      localizationKey: greyfeatherLocationKey,
    }),
  ]);

export const M3_DIALOGUE_SPEAKERS:
  readonly DialogueSpeakerDefinition[] = Object.freeze([
  createSpeaker(
    "speaker.baiyecheng",
    "白夜城",
    "character.baiyecheng",
  ),
  createSpeaker("speaker.otto", "奥托", "character.otto"),
  createSpeaker(
    "speaker.martha_bell",
    "玛莎·贝尔",
    "character.martha_bell",
  ),
  createSpeaker(
    "speaker.thomas_bell",
    "托马斯·贝尔",
    "character.thomas_bell",
  ),
  createSpeaker("speaker.courier", "送信员"),
  createSpeaker("speaker.mechanic", "修理工"),
  createSpeaker("speaker.linesman", "巡线员"),
  createSpeaker("speaker.merchant", "商贩"),
  createSpeaker("speaker.traveler", "旅客"),
  createSpeaker("speaker.miner", "矿工"),
  createSpeaker("speaker.older_woman", "老妇人"),
  createSpeaker("speaker.apprentice", "学徒"),
  createSpeaker("speaker.guard", "守卫"),
  createSpeaker("speaker.mercenary", "佣兵"),
  createSpeaker("speaker.bookkeeper", "记账员"),
  createSpeaker("speaker.young_guest", "年轻客人"),
  createSpeaker("speaker.older_guest", "老人"),
  createSpeaker("speaker.crew_member", "乘务员"),
  createSpeaker("speaker.porter", "搬运工"),
  createSpeaker("speaker.regular_a", "熟客甲"),
  createSpeaker("speaker.regular_b", "熟客乙"),
  createSpeaker("speaker.regular", "熟客"),
  createSpeaker("speaker.colleague", "同事"),
  createSpeaker("speaker.mother", "母亲"),
  createSpeaker("speaker.neighbor", "邻居"),
]);

export const M3_DIALOGUES = Object.freeze([
  createAmbientDialogue(
    "d001_cold_wind",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.courier",
        text: "先来碗热汤。风快把耳朵刮走了。",
      },
    ],
  ),
  createAmbientDialogue(
    "d002_no_machine_oil",
    ["arrival"],
    "new",
    [
      {
        speakerId: "speaker.mechanic",
        text: "闻着不像机油。好兆头。",
      },
    ],
  ),
  createAmbientDialogue(
    "d003_crisp_bread",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.linesman",
        text: "面包烤脆一点，我还得走半天。",
      },
    ],
  ),
  createAmbientDialogue(
    "d004_one_more_plate",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.merchant",
        text: "我只坐一会儿……再加一份也行。",
      },
    ],
  ),
  createAmbientDialogue(
    "d005_airship_sickness",
    ["arrival"],
    "new",
    [
      {
        speakerId: "speaker.traveler",
        text: "飞艇餐厅？吃完不会晕船吧？",
      },
    ],
  ),
  createAmbientDialogue(
    "d006_yesterday_drinks",
    ["arrival"],
    "new",
    [
      {
        speakerId: "speaker.miner",
        text: "今天不喝酒。昨天的我已经喝过了。",
      },
    ],
  ),
  createAmbientDialogue(
    "d007_dip_the_soup",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.older_woman",
        text: "别急着收盘，我还想蘸一点汤。",
      },
    ],
  ),
  createAmbientDialogue(
    "d008_more_meat",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.apprentice",
        text: "最便宜的套餐……肉多一点可以吗？",
      },
    ],
  ),
  createAmbientDialogue(
    "d009_bridge_closed",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.courier",
        text: "北边的桥又封了。",
      },
      {
        speakerId: "speaker.linesman",
        text: "昨天不是刚修好吗？",
      },
      {
        speakerId: "speaker.courier",
        text: "昨天是风，今天是羊群。",
      },
    ],
  ),
  createAmbientDialogue(
    "d010_workshop_smell",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.mechanic",
        text: "你闻到我身上的机油味了吗？",
      },
      {
        speakerId: "speaker.apprentice",
        text: "没有。",
      },
      {
        speakerId: "speaker.mechanic",
        text: "那就先吃饭，别回工坊了。",
      },
    ],
  ),
  createAmbientDialogue(
    "d011_borrowed_armor",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.guard",
        text: "你这身盔甲是新的？",
      },
      {
        speakerId: "speaker.mercenary",
        text: "借来的。",
      },
      {
        speakerId: "speaker.guard",
        text: "那喝汤的时候小心点。",
      },
    ],
  ),
  createAmbientDialogue(
    "d012_flying_restaurant",
    ["arrival"],
    "new",
    [
      {
        speakerId: "speaker.merchant",
        text: "听说这家餐厅是从旧港飞来的。",
      },
      {
        speakerId: "speaker.bookkeeper",
        text: "先吃一口，再决定信不信。",
      },
    ],
  ),
  createAmbientDialogue(
    "d013_someone_with_me",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.young_guest",
        text: "你怎么每天都点一样的？",
      },
      {
        speakerId: "speaker.older_guest",
        text: "今天和昨天不一样。",
      },
      {
        speakerId: "speaker.young_guest",
        text: "哪里不一样？",
      },
      {
        speakerId: "speaker.older_guest",
        text: "今天有人陪我吃。",
      },
    ],
  ),
  createAmbientDialogue(
    "d014_new_route",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.crew_member",
        text: "新航线快是快，就是看不见地面了。",
      },
      {
        speakerId: "speaker.traveler",
        text: "看不见也好，省得害怕。",
      },
    ],
  ),
  createAmbientDialogue(
    "d015_beacon_light",
    ["waiting"],
    "new",
    [
      {
        speakerId: "speaker.linesman",
        text: "灰羽航标塔以前整夜都亮着。",
      },
      {
        speakerId: "speaker.courier",
        text: "现在呢？",
      },
      {
        speakerId: "speaker.linesman",
        text: "现在只为偶尔经过的人亮。",
      },
    ],
  ),
  createAmbientDialogue(
    "d016_southern_route",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.merchant",
        text: "听说南边又开了一条航路。",
      },
      {
        speakerId: "speaker.porter",
        text: "那这里会更冷清吧？",
      },
      {
        speakerId: "speaker.merchant",
        text: "有热饭就不算冷清。",
      },
    ],
  ),
  createAmbientDialogue(
    "d017_magic_stove",
    ["eating"],
    "new",
    [
      {
        speakerId: "speaker.mechanic",
        text: "新式魔导炉不用煤了。",
      },
      {
        speakerId: "speaker.miner",
        text: "那你为什么脸还是黑的？",
      },
      {
        speakerId: "speaker.mechanic",
        text: "我昨天修的是旧式的。",
      },
    ],
  ),
  createAmbientDialogue(
    "d018_salty_stew",
    ["eating"],
    "regular",
    [
      {
        speakerId: "speaker.regular_a",
        text: "上次那份炖菜还有吗？",
      },
      {
        speakerId: "speaker.regular_b",
        text: "你不是说太咸？",
      },
      {
        speakerId: "speaker.regular_a",
        text: "所以我今天带了水。",
      },
    ],
  ),
  createAmbientDialogue(
    "d019_brought_colleague",
    ["arrival"],
    "returning",
    [
      {
        speakerId: "speaker.regular",
        text: "我把同事带来了。",
      },
      {
        speakerId: "speaker.colleague",
        text: "你没说餐厅会晃。",
      },
      {
        speakerId: "speaker.regular",
        text: "我也没说饭这么香。",
      },
    ],
  ),
  createAmbientDialogue(
    "d020_waiting_for_return",
    ["departing"],
    "regular",
    [
      {
        speakerId: "speaker.linesman",
        text: "他们还会回来吗？",
      },
      {
        speakerId: "speaker.mechanic",
        text: "你都问第三次了。",
      },
      {
        speakerId: "speaker.linesman",
        text: "那你怎么也天天在这里等？",
      },
    ],
    ["story.bell_stew_first_service"],
  ),
  createAmbientDialogue(
    "d021_son_returns",
    ["waiting"],
    "returning",
    [
      {
        speakerId: "speaker.mother",
        text: "我儿子下周从矿区回来。",
      },
      {
        speakerId: "speaker.neighbor",
        text: "那得多点一道菜。",
      },
      {
        speakerId: "speaker.mother",
        text: "等他真的回来再点。",
      },
    ],
  ),
  createStoryDialogue("greyfeather_arrival", [
    {
      speakerId: "speaker.baiyecheng",
      text: "这页……是玛莎写的。",
    },
    {
      speakerId: "speaker.otto",
      text: "灰羽航标塔就在前方。",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "那先把炉子点起来吧。",
    },
  ]),
  createStoryDialogue("bell_reunion", [
    {
      speakerId: "speaker.martha_bell",
      text: "炊事班长？",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "现在是餐馆老板。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "开到天上去了？",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "厨房先到了，招牌还在路上。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "我就说这味道熟悉。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "你闻见炖菜都这么说。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "所以这次总算说对了。",
    },
  ]),
  createStoryDialogue("martha_wartime_wish", [
    {
      speakerId: "speaker.baiyecheng",
      text: "你的愿望，我还留着。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "那本破册子还没扔？",
    },
    {
      speakerId: "speaker.otto",
      text: "保存状况：不建议触碰。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "她其实一直记得。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "当年那锅可别照原样做。",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "胡萝卜别煮软，我记得。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "我们后来改过一些。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "是改过很多。",
    },
  ]),
  createStoryDialogue("bell_stew_cooking", [
    {
      speakerId: "speaker.martha_bell",
      text: "胡萝卜最后再放。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "我记得。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "你上次也这么说。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "可你上次也吃完了。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "那是因为不能浪费。",
    },
  ]),
  createStoryDialogue("bell_stew_first_service", [
    {
      speakerId: "speaker.otto",
      text: "贝尔家的炖菜，两份。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "先放他那边，他怕烫还吃得急。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "她那份胡萝卜要先盛。",
    },
    {
      speakerId: "speaker.otto",
      text: "正在处理相互矛盾的优先级。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "胡萝卜还行。",
    },
    {
      speakerId: "speaker.thomas_bell",
      text: "这对她来说就是很好。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "吃你的。",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "和我记得的不太一样。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "人都老了，菜还不许改？",
    },
  ]),
  createStoryDialogue("linesman_new_wish", [
    {
      speakerId: "speaker.linesman",
      text: "下次会做奶酪面包吗？",
    },
    {
      speakerId: "speaker.otto",
      text: "当前食谱没有记录。",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "笔记末尾还有空页。",
    },
    {
      speakerId: "speaker.linesman",
      text: "那……可以先写上吗？",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "当然可以。",
    },
  ]),
  createStoryDialogue("bell_departure", [
    {
      speakerId: "speaker.thomas_bell",
      text: "下次来，我给你们留些塔下的香草。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "先说好，不是送，是换饭。",
    },
    {
      speakerId: "speaker.baiyecheng",
      text: "那得多来几次才换得完。",
    },
    {
      speakerId: "speaker.martha_bell",
      text: "少得意。",
    },
  ]),
]);

export const M3_DIALOGUE_LOCALIZATIONS:
  Readonly<Record<string, string>> = Object.freeze({
  ...localizations,
});
