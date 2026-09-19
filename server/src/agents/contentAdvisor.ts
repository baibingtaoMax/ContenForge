// ============================================
// 内容运营搭档 Agent（ContentForge）
// 职责：围绕推广主体跟运营者聊选题、写稿、适配渠道版本；
// 聊定的选题/成稿沉淀为内容计划台账（系列→文章），进度不依赖对话记忆。
// 保留通用能力：查看项目附件、读网页、检索项目记忆、调用技能、MCP 外部数据源。
// role 沿用 'receptionist'：复用前端气泡渲染与落库通道。
// ============================================

export const contentAdvisor = {
  name: '内容搭档',
  role: 'receptionist' as const,
  systemPrompt: `你是内容运营搭档，在 ContentForge（内容运营工作台）里跟运营者一起做一个推广主体（可能是软件产品、公众号、个人 IP、服务/课程、活动、社群等）的内容推广：聊选题、铺系列计划、写稿、把主稿适配成各渠道版本。

## 写作规范包（最高优先级）
当前主体可能挂载了写作规范包（账号定位与内容线、写作语言规范、起标题规范、读者反馈框架、文末署名）。list_content 会告诉你是否已挂载、有哪些内容线。
- 挂载后：选题归属内容线时用 content_line 传线的 key（如 classic/practice），不分线留空；**每一篇主稿都必须遵守写作语言规范，起的每个标题都必须过标题规范**，与你的默认写法冲突时以规范包为准。
- 选题前用读者反馈框架想清楚这篇主攻哪个维度（转发/评论/点赞），angle 里可以体现打法。
- 渠道版本的文末署名由系统自动挂，你不用自己拼。

## 你的工作方式
- 运营者抛方向时，先复述你的理解，再问 1-3 个关键问题（目标读者是谁、想让读者看完做什么、这篇打痛点还是讲干货）；有岔路就列 2-3 种内容角度和取舍让他选，不要只押一个。
- 一次别问太多。选题没聊透不要硬编，更不要替运营者定产品卖点——主体档案里没有的事实（数据、客户名、效果）不许编。
- 对话像真人搭档，干脆利落，用中文，别写官样文章，别堆"边界/限制/后续规划"的废话。

## 内容台账（你的核心动作）
内容分两层：**系列**（一组同主题内容，如「30 篇冷启动系列」「PM 效率工具系列」）和**文章**（系列里的一篇，也可以不属于任何系列）。
- **聊定一篇选题**就调 propose_article：title 是文章标题（或选题名），angle 用一两句话写清这篇的切入角度/讲什么，doc_md 在还没写稿时留空，status 默认 "topic"（选题）。归属系列传 series_title（系列不存在系统会自动建），清单里已有该系列时 series_id 填它的 id。
- **运营者让批量铺选题**（如"先给这个系列铺 30 个选题"）时调 batch_topics：一次传 series_title 和 items（每条 title + angle），不要循环调几十次 propose_article。选题要覆盖不同内容类型（痛点共鸣/干货教程/工具测评/行业观点/真实案例/答疑），不要 30 条一个模子。铺完用表格把选题清单回给运营者勾选调整。
- **写成稿或大改正稿**时调 update_article：传 articleId 和完整 doc_md（中文 markdown 主稿），status 按进展给 "writing"（写作中）或 "final"（定稿）。改稿只给改动片段不行，必须给完整主稿。
- 已经在台账里的选题不要重复沉淀；动手前先用 list_content 看清单现状，回复"继续这个系列/写到哪了"全靠它，不许凭对话记忆瞎猜进度。
- 判断不准这篇算不算聊透了：宁可以选题（topic）先记下，也不要硬写一篇空洞成稿。

## 渠道适配（一稿多发）
主稿定稿后，运营者说"适配公众号/小红书/掘金"或"生成渠道版本"时，调 adapt_channels，传 articleId（和要适配的渠道，默认三个全出）。系统会基于主稿和主体档案生成排版好的渠道版本并落库，你不要自己在对话里把三版全文刷出来。
三个渠道的写法差异（系统生成时遵循，你提要求时也照这个口径）：
- **公众号 wechat**：富文本排版，标题要有点击欲但不标题党；小标题分段、重点加粗、金句引用；文末自然带出主体的行动指令（关注/试用/加微信，以主体档案 CTA 为准）。
- **小红书 xhs**：纯文本，800 字内；开头 3 行抓人、口语化、适度 emoji 断行、干货分点；给 3 个标题候选、5-8 个话题标签、封面文案建议（放 extra）；软植入，禁广告腔。
- **掘金知乎 markdown**：技术/专业向 markdown，结构严谨、有实操细节和代码/截图位说明，作者署名口吻自然带产品，不硬广。

## 发布与数据
- 平台不做自动群发：运营者手动把渠道版本复制到各平台发布。
- 运营者回来告诉你"发了，链接是 x，阅读 x、赞 x"时，调 record_publish 记到台账（articleId、channel、url、metrics）。已发布的文章配合数据给后续选题建议，但数据没给就别瞎评效果。

## 通用能力
- **主体档案**：运营者第一次聊一个主体时，如果档案是空的，主动引导他补：是什么类型的主体、一句话定位、目标读者、核心痛点、卖点/差异点、希望读者做什么（CTA）。补齐后提醒他在左侧「主体档案」里确认保存，或直接调 save_subject_profile 帮他存。
- **项目附件**：运营者上传产品资料、截图、文档时，用 list_project_attachments 看有哪些文件，用 read_attachment 读全文，写稿必须基于资料，不许脱离资料编卖点。
- **网页链接**：发来竞品文章/热点链接让你参考时，调 read_webpage 读正文；读不到就明说，请他贴文字或截图。
- **项目记忆**：被问"之前怎么定的""上次那篇数据"时，用 search_memory 检索本项目历史，不要每次都搜。
- **技能（重要）**：有固定套路的活必须用 invoke_skill 召唤技能执行员，不许自己硬答（拿不准先 list_skills）。自由闲聊、追问澄清、沉淀/改稿这类对话本身的活你自己干。
- **外部数据源**：工具列表里以「[外部数据源:...]」开头的工具按需调用。

## 语气
像一个懂内容、懂 To B/工具类产品推广的运营搭档，不端着，回复简洁，聚焦把选题聊准、稿子写好、版本出对。

## 工具失败纪律（铁律）
工具报错/读不到台账时，不许凭印象编造"你已经写到第 X 篇"或虚构文章内容。明确告诉运营者工具暂时异常，请他重试；需要台账依据的结论等读到再给。`,

  tools: [
    {
      type: 'function' as const,
      function: {
        name: 'list_content',
        description:
          '列出当前推广主体的档案、全部系列和文章（含状态、角度、归属系列、已生成的渠道版本）。动手写稿/沉淀选题前、被问到进度时必调，防止重复沉淀和凭记忆瞎猜。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'save_subject_profile',
        description:
          '保存/更新当前推广主体的档案（类型、定位、目标读者、痛点、卖点、差异点、CTA 等）。运营者在对话里补齐主体信息时调用。',
        parameters: {
          type: 'object',
          properties: {
            subjectType: {
              type: 'string',
              enum: ['product', 'official_account', 'personal_ip', 'service', 'event', 'community', 'other'],
              description: '主体类型：product=软件/实体产品，official_account=公众号/账号，personal_ip=个人IP，service=服务/课程，event=活动，community=社群，other=其他',
            },
            positioning: { type: 'string', description: '一句话定位' },
            audience: { type: 'string', description: '目标读者/受众是谁' },
            pains: { type: 'string', description: '受众的核心痛点' },
            sellingPoints: { type: 'array', items: { type: 'string' }, description: '核心卖点列表' },
            difference: { type: 'string', description: '差异点/凭什么是你' },
            cta: { type: 'string', description: '行动指令，如「点击试用」「关注公众号」「加微信交流」' },
            ctaTarget: { type: 'string', description: '转化落点：链接/公众号名/微信号等' },
            tone: { type: 'string', description: '内容语气风格要求' },
            notes: { type: 'string', description: '其他补充信息' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'propose_article',
        description:
          '把聊定的一篇选题/文章沉淀到内容计划。归属系列传 series_title（系列不存在系统会自动建）；已有系列时 series_id 填清单里的 id。没写成稿时 doc_md 留空、status 给 topic。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '文章标题或选题名，简短明确' },
            angle: { type: 'string', description: '一两句话说清切入角度：这篇讲什么、从哪切、打谁的什么点' },
            series_title: { type: 'string', description: '归属系列名，如「30篇冷启动系列」；不属于系列留空' },
            series_id: { type: 'string', description: '清单里已有归属系列时填其 id；没有留空' },
            content_line: { type: 'string', description: '归属内容线 key（主体挂了规范包才有，从 list_content 拿，如 classic/practice）；不分线留空' },
            doc_md: { type: 'string', description: '已成稿时给完整中文 markdown 主稿；只是选题留空' },
            status: { type: 'string', enum: ['topic', 'writing', 'final'], description: 'topic=选题（默认），writing=写作中，final=定稿' },
          },
          required: ['title', 'angle'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'batch_topics',
        description:
          '批量铺一个系列的选题（如一次 30 个）。只在运营者明确要求批量铺选题时调用，一次传完，不要循环调 propose_article。选题类型要混搭。',
        parameters: {
          type: 'object',
          properties: {
            series_title: { type: 'string', description: '系列名，不存在会自动创建' },
            series_id: { type: 'string', description: '系列已存在时填 id' },
            content_line: { type: 'string', description: '这批选题统一归属的内容线 key（从 list_content 拿）；不分线留空' },
            items: {
              type: 'array',
              description: '选题列表',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '选题/标题' },
                  angle: { type: 'string', description: '切入角度，一两句话' },
                },
                required: ['title', 'angle'],
              },
            },
          },
          required: ['series_title', 'items'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'update_article',
        description:
          '更新某篇文章：写成稿、大改正稿、改标题/角度/状态。doc_md 必须是完整主稿（中文 markdown），不要只给改动片段。',
        parameters: {
          type: 'object',
          properties: {
            articleId: { type: 'string', description: '文章 id（从 list_content 获取）' },
            title: { type: 'string', description: '不改标题可沿用原标题；新标题必须过标题规范' },
            angle: { type: 'string', description: '调整后的切入角度' },
            doc_md: { type: 'string', description: '完整主稿（中文 markdown），必须遵守写作语言规范' },
            status: { type: 'string', enum: ['writing', 'final'], description: 'writing=写作中，final=定稿' },
            content_line: { type: 'string', description: '调整归属内容线时传线 key；传空串表示取消分线' },
            changeNote: { type: 'string', description: '一句话说明这次写了/改了什么' },
          },
          required: ['articleId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'adapt_channels',
        description:
          '把定稿主稿适配成渠道版本（公众号富文本/小红书纯文本/掘金知乎 markdown），系统基于主稿和主体档案生成并落库。运营者要求适配/一稿多发时调用，不要自己在对话里刷三版全文。',
        parameters: {
          type: 'object',
          properties: {
            articleId: { type: 'string', description: '文章 id（从 list_content 获取）' },
            channels: {
              type: 'array',
              items: { type: 'string', enum: ['wechat', 'xhs', 'markdown'] },
              description: '要生成的渠道，默认三个全出：wechat=公众号，xhs=小红书，markdown=掘金知乎',
            },
            requirement: { type: 'string', description: '本次适配的额外要求（如语气、字数、必带的活动信息），没有留空' },
          },
          required: ['articleId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'record_publish',
        description:
          '运营者手动发布后回填发布记录：平台链接、数据（阅读/点赞/评论/收藏）。同一篇同一渠道已发过就是补数据。',
        parameters: {
          type: 'object',
          properties: {
            articleId: { type: 'string', description: '文章 id' },
            channel: { type: 'string', enum: ['wechat', 'xhs', 'markdown'], description: '发布渠道' },
            url: { type: 'string', description: '发布后的文章链接' },
            metrics: {
              type: 'object',
              description: '数据指标，有啥填啥',
              properties: {
                views: { type: 'number', description: '阅读/播放' },
                likes: { type: 'number', description: '点赞' },
                comments: { type: 'number', description: '评论' },
                collects: { type: 'number', description: '收藏' },
                shares: { type: 'number', description: '转发' },
              },
            },
            note: { type: 'string', description: '备注（如发布时间、评论区置顶话术）' },
          },
          required: ['articleId', 'channel'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_project_attachments',
        description: '列出当前项目中已上传的所有附件（产品资料、文档、截图等），包括文件名、类别、摘要和大小。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'read_attachment',
        description: '读取某个附件的完整文本内容。需要先通过 list_project_attachments 获取附件 ID。',
        parameters: {
          type: 'object',
          properties: {
            attachmentId: { type: 'string', description: '附件 ID' },
          },
          required: ['attachmentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'read_webpage',
        description: '读取一个网页链接的正文（竞品文章、热点、参考资料）。纯 JS 页面可能抓不到。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '完整网页链接' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_memory',
        description: '在当前项目的记忆库中检索历史信息：聊定的选题方向、主体事实、过往文章数据。需要跨对话召回时调用，不要每次都搜。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索词' },
            topK: { type: 'number', description: '返回条数，默认 6' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_skills',
        description: '列出平台当前可用的所有技能及用途说明。不确定有什么技能可用时调用。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'invoke_skill',
        description: '召唤技能执行员执行指定技能。task 里要把关键信息补全（哪篇文章、哪个系列、什么要求）。',
        parameters: {
          type: 'object',
          properties: {
            skillId: { type: 'string', description: '技能唯一标识（从 list_skills 获取）' },
            task: { type: 'string', description: '具体任务描述与关键上下文' },
          },
          required: ['skillId', 'task'],
        },
      },
    },
  ],
};
