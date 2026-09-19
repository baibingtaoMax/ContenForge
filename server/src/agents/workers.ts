// ============================================
// 领域 Worker（调查员下属的执行层子智能体）
// 每个 worker 负责一个领域，自己跑一轮 function calling 取数，
// 不做风险判断，只把该领域的事实和异常点交回给调查员。
// ============================================

import type { AgentConfig } from '../types/index.js';

/** Worker 领域标识 */
export type WorkerDomain =
  | 'business'      // 工商
  | 'credit'        // 征信
  | 'financial'     // 财务
  | 'litigation'    // 司法
  | 'tax';          // 税务

export interface WorkerConfig extends AgentConfig {
  domain: WorkerDomain;
  /** 中文短名，气泡标题用 */
  shortName: string;
  /** 该 worker 专属的数据工具名（核心取数工具） */
  dataTool: string;
}

const COMMON_RULES = `工作规则：
1. 你只负责自己这个领域的调查，调用手头的工具取数，不要跨领域、不要做综合风险判断。
2. 如果指令中列出了可用附件，使用 read_attachment 读取与本领域相关的材料，与工具数据交叉核对；指令没列附件就不要去找附件。
3. 如实引用关键数字和异常点，严禁编造。工具或附件里没有的字段，不要编造。
4. 调完工具、拿到数据后即可结束，不需要写总结或小结——结果会直接交给调查主管汇总。
5. 全程使用中文。
6. 外部数据交叉验证：你的工具列表中可能存在名称以「[外部数据源:...]」开头的工具（如产业、工商公开数据等 MCP 数据源）。当内置数据缺失、字段存疑、或需要核实真实企业背景时，应主动调用这些外部工具进行交叉验证；若内置数据与外部数据不一致，如实并列说明差异，不要擅自取舍。外部工具不是每次必调，按需使用。`;

export const WORKERS: Record<WorkerDomain, WorkerConfig> = {
  business: {
    name: '工商调查员',
    shortName: '工商',
    role: 'worker_business' as any,
    domain: 'business',
    dataTool: 'getEnterpriseBasic',
    availableTools: ['getEnterpriseBasic'],
    systemPrompt: `你是融资担保风控团队的工商调查专员，负责核查企业的工商登记背景。${COMMON_RULES}
重点关注：成立时间、注册资本实缴情况、法定代表人、经营状态是否异常、经营范围与实际是否匹配、股权结构、注册地址是否集中。`,
  },
  credit: {
    name: '征信调查员',
    shortName: '征信',
    role: 'worker_credit' as any,
    domain: 'credit',
    dataTool: 'getCreditReport',
    availableTools: ['getCreditReport'],
    systemPrompt: `你是融资担保风控团队的征信调查专员，负责核查企业和实际控制人的征信情况。${COMMON_RULES}
重点关注：贷款余额与结构、逾期/欠息记录、征信查询频率是否异常、对外担保规模、票据兑付、不良信用记录。`,
  },
  financial: {
    name: '财务调查员',
    shortName: '财务',
    role: 'worker_financial' as any,
    domain: 'financial',
    dataTool: 'getFinancialData',
    availableTools: ['getFinancialData'],
    systemPrompt: `你是融资担保风控团队的财务调查专员，负责核查企业财务真实性与偿债能力。${COMMON_RULES}
重点关注：资产负债率、流动/速动比率、营收与利润趋势、经营性现金流、应收账款和其他应收款占比、存货周转、有无虚增收入迹象。`,
  },
  litigation: {
    name: '司法调查员',
    shortName: '司法',
    role: 'worker_litigation' as any,
    domain: 'litigation',
    dataTool: 'getLitigationRecords',
    availableTools: ['getLitigationRecords'],
    systemPrompt: `你是融资担保风控团队的司法调查专员，负责核查企业涉诉与被执行情况。${COMMON_RULES}
重点关注：作为被告/被执行人的案件、涉案金额、失信被执行、限制高消费、民间借贷纠纷、股权冻结、行政处罚。`,
  },
  tax: {
    name: '税务调查员',
    shortName: '税务',
    role: 'worker_tax' as any,
    domain: 'tax',
    dataTool: 'getTaxInfo',
    availableTools: ['getTaxInfo'],
    systemPrompt: `你是融资担保风控团队的税务调查专员，负责核查企业纳税合规与经营稳定性。${COMMON_RULES}
重点关注：纳税信用等级、实缴税款与营收是否匹配、欠税记录、税务行政处罚、是否非正常户、社保缴纳人数与稳定性。`,
  },
};

export const ALL_DOMAINS: WorkerDomain[] = [
  'business', 'credit', 'financial', 'litigation', 'tax',
];

export function getWorker(domain: WorkerDomain): WorkerConfig {
  return WORKERS[domain];
}
