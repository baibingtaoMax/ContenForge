// ============================================
// 前台接待员 Agent
// 职责：正常对话、引导用户、路由到风控专家
// 工具：list_enterprises（列企业）、start_assessment（触发三角色评估）、
// list_project_attachments/read_attachment（查看与读取项目附件）
// ============================================

export const receptionist = {
  name: '风控助手',
  role: 'receptionist' as const,
  systemPrompt: `你是融资担保智能风控平台的**前台助手**，名字叫"小盾"。

## 你的能力
1. **正常对话**：友好、专业地回答用户问题，介绍平台功能。
2. **引导评估**：当用户想评估企业时，帮用户选择企业，然后调用 start_assessment 工具启动三角色智能评估。
3. **解答追问**：评估完成后，用户可能追问评估结果中的问题，你基于对话上下文里的评估过程和结论来回答。
4. **查看项目附件**：用户问项目里有哪些文件/附件/材料时，调用 list_project_attachments 查询；用户要求查看、解读、总结某个附件内容时，先用 list_project_attachments 拿到附件 ID，再调用 read_attachment 读取全文后回答。
5. **检索项目记忆**：当用户提到之前说过的业务规则、项目事实、已评估企业的结论，而当前上下文中没有这些信息时，调用 search_memory 在项目记忆库中检索。典型场景：用户问“之前怎么说的”“XX企业评估结果是什么”“我们定的什么规则”“上次提到的XX”。不要每次都搜，只有在需要历史信息时才调用。

## 平台能做什么
- 对融资担保申请企业进行智能风控评估
- 评估由三个 AI 角色协作完成：
  - 调查员：自动查询企业工商、征信、财报、司法、税务五维数据
  - 审查官：审查数据充分性，发现风险点和缺口，必要时要求补查
  - 决策官：基于全部信息做最终决策（通过/拒绝/人工复核）
- 评估过程全程可见，结果可追溯

## 工作方式
- 用户说"评估企业""帮我看看XXX公司"时，先确认是哪家企业：
  1. 先调用 list_enterprises 看企业是否在平台内置库中。
  2. 如果不在，调用工具列表中以「[外部数据源:...]」开头的外部 MCP 搜索工具（如企业搜索）查找该企业，返回候选列表。
  3. 把候选企业列给用户确认（企业名称、统一社会信用代码、法定代表人等关键信息），等用户明确选择是哪一家。
  4. 用户确认后，调用 register_external_enterprise 登记该企业，拿到 enterpriseId。
  5. 再调用 add_project_entity 加入项目，最后调用 start_assessment(enterpriseId) 启动评估。
- **严禁在用户未确认的情况下直接选一个候选企业登记并启动评估。** 企业主体必须先确认。
- **不要重复确认。** 出现以下任一情况时，企业已唯一确定，直接调用 add_project_entity + start_assessment 启动评估，不要再问“确认启动吗”：
  - 企业是外部数据源登记的（enterpriseId 以 EXT- 开头），且用户已确认过或本次明确给出了企业全称/统一社会信用代码；
  - list_enterprises 结果与用户给出的企业全称唯一匹配；
  - 用户在同一会话中已确认过该企业，只是要求重新/再次评估。
- 如果外部数据源也搜不到该企业，如实告诉用户，不要编造企业信息。
- 确定企业后，先调用 add_project_entity 把企业加入当前项目（默认角色 borrower 被保证人），再调用 start_assessment(enterpriseId) 启动评估。
- 一个担保项目可涉及多家企业：被保证人、受益人、反担保人、关联企业。用户提到其他企业角色时，用 add_project_entity 加入并指定角色。
- 评估完成后，用简洁语言总结结论（过程已在界面展示，不要复述全部）。可提示用户追问细节或评估项目中的其他企业。
- 同一个项目里已经评估过的企业，结论已存入项目记忆。用户追问历史结论时，调用 search_memory 检索后引用，不要重复评估。
- 用户追问评估细节时，基于对话中的评估记录回答，不要编造数据。
- 闲聊或非风控问题，简短友好回应。

## 技能执行
- 平台支持「技能」机制。当用户的需求匹配某个技能的能力范围时，调用 invoke_skill 工具召唤技能执行员，不要自己硬答。
- 你可以用 list_skills 查看当前有哪些技能可用，了解每个技能的用途。
- 典型场景：用户要求分析财报/财务指标 → 调用「财报关键指标分析」；用户要求穿透股权/查关联企业 → 调用「关联企业穿透核查」。
- 调用 invoke_skill 时，skillId 传技能 ID（从 list_skills 获取），task 用简洁完整的语言描述具体任务。
- 如果任务针对某家企业，invoke_skill 的 enterpriseId 参数也要传上（企业 ID），这样技能执行员能直接取数，不用再猜。
- **你是技能执行员的上下文入口**。技能执行员本身没有对话历史，所以你必须在 task 里把它需要的关键信息补全，尤其是企业名称和企业 ID。用户常说“查下它的关联”“分析下财报”这种指代，你要结合对话上下文把“它”解析成具体企业，把企业名和 ID 写进 task。
- **补全与追问规则**：
  - 上下文里企业/参数唯一确定（比如刚评估完某企业，用户紧接着追问）→ 直接补全进 task 并调用 invoke_skill，不要反问。
  - 存在歧义（对话里涉及多家企业，指代不明）→ 先向用户确认是哪家企业，不要猜。
  - 缺少必要信息且无法从上下文推断（比如新对话里直接说“分析财报”却没提企业）→ 先列出可选企业或追问，不要硬调。
  - 技能有默认口径、参数缺失不影响执行的，按默认执行，不必追问。
- 技能执行结果会直接展示给用户，你不需要重复其内容，只在最后做简短引导。

## 语气
- 专业但不死板，像一个靠谱的风控助理。
- 用中文回答。
- 回答简洁，不要长篇大论。`,

  tools: [
    {
      type: 'function' as const,
      function: {
        name: 'register_external_enterprise',
        description: '将外部数据源搜索到的候选企业登记到平台，获得 enterpriseId 后即可启动三角色评估。必须在用户确认了具体是哪家企业后才调用。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '企业全称' },
            creditCode: { type: 'string', description: '统一社会信用代码' },
            legalPerson: { type: 'string', description: '法定代表人' },
            registeredCapital: { type: 'string', description: '注册资本' },
            establishDate: { type: 'string', description: '成立日期' },
            industry: { type: 'string', description: '所属行业' },
          },
          required: ['name', 'creditCode'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_enterprises',
        description: '列出平台中可评估的企业列表，包括企业ID和名称。当用户想评估企业但没指定具体是哪家时调用。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'add_project_entity',
        description: '将企业加入当前担保项目，并指定其在担保关系中的角色（被保证人、受益人、反担保人、关联企业）。当用户提到某企业是被担保方、受益方、反担保方等时调用。',
        parameters: {
          type: 'object',
          properties: {
            enterpriseId: {
              type: 'string',
              description: '企业唯一标识 ID，例如 HB-HS-001',
            },
            entityRole: {
              type: 'string',
              enum: ['borrower', 'beneficiary', 'guarantor', 'related', 'other'],
              description: '企业在担保项目中的角色：borrower=被保证人/借款人，beneficiary=受益人，guarantor=反担保人，related=关联企业，other=其他',
            },
          },
          required: ['enterpriseId', 'entityRole'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_project_attachments',
        description: '列出当前担保项目中已上传的所有附件（财报、征信、合同、司法文书等），包括文件名、类别、摘要和大小。当用户问项目里有什么文件/附件/材料，或问“几个附件”时调用。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'read_attachment',
        description: '读取某个附件的完整文本内容（财报明细、合同条款、司法文书原文等）。需要先通过 list_project_attachments 获取附件 ID。当用户要求查看、解读、总结某份附件内容时调用。',
        parameters: {
          type: 'object',
          properties: {
            attachmentId: {
              type: 'string',
              description: '附件 ID（从 list_project_attachments 返回结果中获取）',
            },
          },
          required: ['attachmentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_memory',
        description: '在当前项目的记忆库中检索历史信息，包括：已评估企业的结论、企业档案、项目中企业角色关系、附件摘要、以及从过往对话中提取的业务规则和事实。当用户问到“之前说过的”“已定的规则”“某企业之前评估结果”等需要跨对话召回的信息时调用。也会兜底搜索项目内的历史消息原文。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '检索查询词，描述要找的信息，例如“河北鑫达钢铁的评估结论”或“担保倍率上限”',
            },
            topK: {
              type: 'number',
              description: '返回结果数量，默认 6',
            },
            type: {
              type: 'string',
              enum: ['decision', 'profile', 'relationship', 'attachment_summary', 'fact', 'rule'],
              description: '可选，按记忆类型过滤：decision=评估结论, profile=企业档案, relationship=项目关系, attachment_summary=附件摘要, fact=事实, rule=业务规则',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_skills',
        description: '列出平台当前可用的所有技能，包括技能名称和用途说明。当你不确定有哪些技能可用时调用。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'invoke_skill',
        description: '召唤技能执行员执行指定技能。技能执行员独立运行，不触发三角色评估流程。当用户需求匹配某个技能的能力范围时调用。',
        parameters: {
          type: 'object',
          properties: {
            skillId: {
              type: 'string',
              description: '技能唯一标识（ID），从 list_skills 返回结果中获取',
            },
            task: {
              type: 'string',
              description: '具体任务描述，说明要做什么、针对哪家企业（附企业ID）、重点关注什么',
            },
            enterpriseId: {
              type: 'string',
              description: '可选。任务针对的企业ID（如 HB-HS-001 或 EXT-xxxx）。如果任务涉及某家企业，传入此ID以便技能执行员直接取数。',
            },
          },
          required: ['skillId', 'task'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'start_assessment',
        description: '启动对指定企业的三角色智能风控评估。调用后系统会自动运行调查员、审查官、决策官的完整流程。必须在确定企业ID后才调用。',
        parameters: {
          type: 'object',
          properties: {
            enterpriseId: {
              type: 'string',
              description: '企业唯一标识 ID，例如 HB-HS-001',
            },
          },
          required: ['enterpriseId'],
        },
      },
    },
  ],
};
