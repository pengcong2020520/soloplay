import type { GeneratedScript } from "@/types/game";

/**
 * 无 ANTHROPIC_API_KEY 时使用的样例剧本（推理本），
 * 让整套流程在零配置下也能完整跑通。
 * 角色1 = 玩家角色（林晚），凶手为「陈默」。
 */
export const MOCK_DEDUCTION_SCRIPT: GeneratedScript = {
  title: "雾港庄园谋杀案",
  publicStory: `1925 年深秋，民国南方的雾港。盐商巨贾沈鸿庄在自家「雾港庄园」举办六十大寿宴。当夜暴雨，宾客滞留庄园过夜。次日清晨，仆人推开书房门，发现沈鸿庄伏案而亡，颈侧有一道细长伤口，桌上的安神茶已凉。法医初判：死亡时间在凌晨一点到三点之间，死因为颈动脉被锐器割破，但现场不见凶器。书房门窗自内反锁，唯一钥匙在死者腰间。庄园当夜共有六人留宿：沈鸿庄的养女、远房侄子、管家、宴会上请来的说书先生、一位旧友，以及一名不速之客。暴雨冲走了庭院的脚印，也冲淡了每个人脸上的从容。谁在那个雨夜走进了反锁的书房？又是谁，有理由让这位富商闭上眼睛？`,
  setting: { era: "民国", location: "庄园" },
  characters: [
    {
      name: "林晚",
      gender: "女",
      occupation: "沈家养女",
      publicProfile:
        "沈鸿庄收养多年的养女，温婉知礼，在庄园中地位微妙。表面对养父恭顺，与各房关系尚可。",
      privateStory:
        "你是被沈鸿庄从孤儿院带回的养女，名为「养」，实为账房学徒。三年前你无意间发现养父的盐业账目有大笔款项流向不明，疑似走私军火。你一直暗中誊抄账册留作证据，想在合适时机交给报馆。寿宴前夜，养父察觉你动了账册，警告你「再多事，就送你回该去的地方」。你恨他，却没有杀他的胆量——你需要的是真相，不是他的命。",
      secrets:
        "1. 你私藏了养父走私账册的抄本；2. 案发前夜你曾偷偷进书房想取回原账册，但门已锁；3. 你听见书房里有第二个人的脚步声。",
      hiddenGoal: "找出真凶，并保住你手中的账册不被发现。",
      victoryCondition: "在投票阶段正确指认凶手「陈默」，且全程未暴露你私藏账册的秘密。",
      unknownFacts: "你不知道是谁最终杀了养父，也不知道陈默的真实身份。",
      relationships: {
        沈明远: "名义上的表兄，对你颇为忌惮",
        周管家: "看你长大的老人，唯一对你和善者",
      },
      isMurderer: false,
      isVictim: false,
    },
    {
      name: "沈明远",
      gender: "男",
      occupation: "远房侄子 / 落魄商人",
      publicProfile:
        "沈鸿庄的远房侄子，西装革履却眼神浮躁。生意接连失败，此次前来据说是为「叙旧」。",
      privateStory:
        "你欠了一身赌债，债主已放话月底不还就要你的命。你来庄园是想求伯父借钱周转，却被当众羞辱、一口回绝。当晚你在书房外徘徊到深夜，确实动过歹念，甚至摸到了书房门口——但门锁着，你最终怯懦地退回了房间。你没有杀人，可你的衣袖上沾了庭院的泥，你说不清自己那一夜到底走到了哪一步。",
      secrets:
        "1. 你欠下巨额赌债，急需用钱；2. 案发当晚你确实到过书房门外；3. 你弄丢了一颗西装袖扣，不知遗落在何处。",
      hiddenGoal: "洗清自己的嫌疑，并设法从遗产中分得一杯羹。",
      victoryCondition: "游戏结束时未被多数票投为凶手。",
      unknownFacts: "你不知道书房当晚真正进去的人是谁。",
      relationships: { 林晚: "看不起这个「捡来的」养女" },
      isMurderer: false,
      isVictim: false,
    },
    {
      name: "陈默",
      gender: "男",
      occupation: "说书先生（伪装）",
      publicProfile:
        "宴会上请来助兴的说书先生，谈吐不凡，一口好嗓。来历是临时雇佣，众人皆不甚熟悉。",
      privateStory:
        "你真正的身份是十年前被沈鸿庄害得家破人亡的故人之子。你父亲曾是沈的生意伙伴，因发现沈走私军火而被其灭口、伪造成意外。你隐姓埋名十年，以说书先生身份混入寿宴。深夜，你用事先配好的钥匙（早年从沈的旧账房处偷得）潜入书房，在他的安神茶里没有下毒——你要他清醒地认出你，再用一把薄如柳叶的刻刀割开他的喉咙。你做到了。离开时你反锁了门，把刻刀藏进了说书用的醒木夹层里。",
      secrets:
        "1. 你是沈鸿庄十年前灭口的故人之子，前来复仇；2. 你持有一把能配上书房门的旧钥匙；3. 凶器是藏在醒木夹层里的柳叶刻刀。",
      hiddenGoal: "完成复仇后全身而退，绝不能被指认。",
      victoryCondition: "游戏结束时未被多数票投出，成功逃脱嫌疑。",
      unknownFacts: "你不知道林晚也在暗中调查沈的账目。",
      relationships: { 周管家: "管家隐约觉得你的口音不像本地说书人" },
      isMurderer: true,
      isVictim: false,
    },
    {
      name: "周管家",
      gender: "男",
      occupation: "庄园管家",
      publicProfile:
        "在沈家做了三十年的老管家，忠心耿耿，对庄园里每一块砖瓦都了如指掌。",
      privateStory:
        "你侍奉沈家三十年，是少数知道老爷「另一面」的人。你曾亲眼见过老爷与陌生人在码头交接货箱，也替他销毁过一些「不该留」的信件。你对林晚有真感情，把她当孙女看。案发那夜你起夜，隐约看到一个穿长衫的身影从书房方向离开，但雨太大、灯太暗，你没看清脸——只记得那人手里攥着一块醒木。",
      secrets:
        "1. 你知道老爷涉足走私，并替他销毁过证据；2. 案发夜你目击一个攥着醒木的长衫身影离开书房。",
      hiddenGoal: "保护林晚不受牵连，同时不暴露自己曾替老爷做过的脏活。",
      victoryCondition: "真凶被指认，且林晚未被冤枉。",
      unknownFacts: "你没看清那个长衫身影的脸。",
      relationships: { 林晚: "视如孙女，处处维护" },
      isMurderer: false,
      isVictim: false,
    },
    {
      name: "沈鸿庄",
      gender: "男",
      occupation: "盐商 / 死者",
      publicProfile:
        "雾港首富，六十大寿当夜遇害。为人精明狠辣，生意场上手段不择。",
      privateStory:
        "（死者，不参与发言。其走私军火、灭口故人的旧事是全案核心动机。）",
      secrets: "走私军火；十年前灭口生意伙伴并伪造意外。",
      hiddenGoal: "（无）",
      victoryCondition: "（死者无胜利条件）",
      unknownFacts: "（无）",
      relationships: {},
      isMurderer: false,
      isVictim: true,
    },
  ],
  clueCards: [
    {
      title: "凉透的安神茶",
      content:
        "书房桌上的安神茶已凉，茶中并未检出毒物。死者是清醒状态下被割喉的——凶手似乎刻意要他「认清」什么。",
      clueType: "PHYSICAL",
      releasePhase: 3,
      isSecret: false,
    },
    {
      title: "反锁的房门",
      content:
        "书房门窗自内反锁，唯一钥匙在死者腰间。但门锁是老式铜锁，理论上存在第二把配匙的可能。",
      clueType: "PHYSICAL",
      releasePhase: 3,
      isSecret: false,
    },
    {
      title: "一颗西装袖扣",
      content:
        "书房门外的回廊地砖缝里，发现一颗银质西装袖扣，样式新潮，与庄园老派陈设格格不入。",
      clueType: "PHYSICAL",
      releasePhase: 3,
      isSecret: false,
    },
    {
      title: "醒木的夹层",
      content:
        "说书先生用的醒木，底部有一道几乎看不出的接缝，似乎可以打开。仔细查验，夹层内壁有暗红色干涸痕迹。",
      clueType: "PHYSICAL",
      releasePhase: 3,
      isSecret: true,
    },
    {
      title: "管家的证词",
      content:
        "周管家称，案发夜他起夜时看到一个穿长衫、手攥醒木的身影从书房方向离开，但雨大灯暗，未看清面容。",
      clueType: "TESTIMONY",
      releasePhase: 4,
      isSecret: false,
    },
  ],
  phaseConfig: [
    { name: "阅本阶段", description: "玩家阅读角色剧本，熟悉雾港庄园的背景", estimatedMinutes: 10, objectives: ["理解角色身份与秘密"] },
    { name: "入戏自我介绍", description: "每位宾客依次介绍自己与死者的关系", estimatedMinutes: 10, objectives: ["建立人物关系图"] },
    { name: "自由交流阶段", description: "宾客自由讨论案发当晚的行踪", estimatedMinutes: 20, objectives: ["试探彼此的不在场证明"] },
    { name: "独立搜证阶段", description: "DM 发布现场线索，各方分析", estimatedMinutes: 20, objectives: ["收集物证与证词"] },
    { name: "公开质询阶段", description: "针对矛盾点公开质询", estimatedMinutes: 15, objectives: ["揭穿谎言"] },
    { name: "最终陈词", description: "每位宾客发表最终陈词", estimatedMinutes: 10, objectives: ["陈述结论"] },
    { name: "投票指凶", description: "提交最终投票", estimatedMinutes: 5, objectives: ["指认凶手"] },
    { name: "复盘揭秘", description: "真相揭示，胜负宣判", estimatedMinutes: 10, objectives: ["还原真相"] },
  ],
  murderSummary: `凶手是「陈默」——十年前被沈鸿庄走私军火案灭口的生意伙伴之子。他隐姓埋名十年，以说书先生身份混入寿宴。凌晨一点后，他用早年从沈家旧账房偷得的配匙打开反锁的书房，故意不在安神茶里下毒，让沈在清醒中认出自己，再用藏在醒木夹层里的柳叶刻刀割喉，作案后反锁房门离开。关键证据链：①茶无毒→凶手要死者清醒（私人恩怨）；②反锁门+第二把配匙→熟悉庄园旧物的人；③醒木夹层血迹→说书先生陈默；④管家目击攥醒木的长衫身影。沈明远的袖扣是干扰项（他到过门外但未进入）。林晚案发前夜想取回账册但门已锁，并听到第二人脚步，可作侧证。`,
};
