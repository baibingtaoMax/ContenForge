// ============================================
// Mock 企业数据
// 三家河北企业：正常 / 有风险 / 高风险
// ============================================

import type { EnterpriseBasic, EnterpriseSummary, EnterpriseShareholder, EnterpriseInvestment } from '../types/index.js';

/** 企业列表（简要） */
export const ENTERPRISES: EnterpriseSummary[] = [
  { id: 'HB-HS-001', name: '河北宏盛建材有限公司', creditCode: '91130100MA07X1AB12', legalPerson: '王建国', industry: '建筑材料' },
  { id: 'SJZ-HT-002', name: '石家庄恒通贸易有限公司', creditCode: '91130100MA08Y2CD34', legalPerson: '李国强', industry: '批发零售' },
  { id: 'HB-XD-003', name: '河北鑫达钢铁有限公司', creditCode: '91130200MA09Z3EF56', legalPerson: '赵志明', industry: '钢铁冶炼' },
];

/** 企业完整数据（按 enterpriseId 索引） */
interface EnterpriseFullData {
  basic: EnterpriseBasic;
  creditReport: string;
  financial: string;
  litigation: string;
  tax: string;
}

const DATA: Record<string, EnterpriseFullData> = {
  // ------------------------------------------------------------------
  // 1. 河北宏盛建材有限公司 —— 正常企业
  // ------------------------------------------------------------------
  'HB-HS-001': {
    basic: {
      id: 'HB-HS-001',
      name: '河北宏盛建材有限公司',
      creditCode: '91130100MA07X1AB12',
      legalPerson: '王建国',
      registeredCapital: '5000 万元人民币',
      establishDate: '2012-03-15',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市裕华区建华南大街 168 号',
      businessScope:
        '建筑材料、装饰材料、金属材料、五金交电的批发零售；建筑工程施工；货物进出口。（依法须经批准的项目，经相关部门批准后方可开展经营活动）',
      shareholders: [
        { name: '王建国', type: '自然人', ratio: '60%' },
        { name: '河北宏盛投资集团有限公司', type: '企业', ratio: '30%', enterpriseId: 'HB-HS-GROUP' },
        { name: '张丽华', type: '自然人', ratio: '10%' },
      ],
      outwardInvestments: [
        { name: '河北宏盛物流有限公司', ratio: '100%', enterpriseId: 'HB-HS-LOGI' },
      ],
    },
    creditReport:
      '【征信摘要】数据截止 2026-06-30。近 24 个月贷款查询共 3 次，均为正常贷后管理查询；其中近 6 个月无贷款审批查询，近 3 个月无任何查询，查询频率正常。' +
      '当前未结清贷款余额 1200 万元，分别为建设银行 800 万元（抵押，剩余期限 2 年，按月正常还款）、河北银行 400 万元（信用，剩余期限 1 年，按月正常还款）；' +
      '无逾期记录，无欠息，无不良/关注类贷款；对外担保 200 万元（被担保方为关联企业河北宏盛物流有限公司，担保期限 2024-03 至 2027-03，被担保方近 2 年营收稳定、无逾期无诉讼，资信良好）；' +
      '信用卡使用额度 5 万元，使用率 12%。',
    financial:
      '【财报关键指标】2025 年度：总资产 2.8 亿元，总负债 1.12 亿元，资产负债率 40%；' +
      '流动资产 1.9 亿元，流动负债 0.75 亿元，流动比率 2.53，速动比率 1.86；' +
      '营业收入 3.6 亿元，同比增长 8.2%；净利润 2850 万元（2024 年度净利润 2610 万元，同比增长 9.2%，盈利稳中有升）；' +
      '经营性现金流净额 3200 万元；应收账款周转天数 62 天；' +
      '其他应收款 380 万元，占流动资产 2.0%（主要为押金、保证金及员工备用金，无关联方资金拆借，账龄均在 1 年以内）；' +
      '存货周转天数 48 天。',
    litigation:
      '【司法诉讼】近 3 年作为原告涉及 2 起买卖合同纠纷（均已胜诉并执行到位，追回货款共计 86 万元）；' +
      '无作为被告的民事案件；无行政处罚记录；无失信被执行、限制高消费记录。',
    tax:
      '【税务信息】纳税信用等级 A 级（连续 5 年）；2025 年度实缴税款 1860 万元（增值税 1120 万元、企业所得税 580 万元、其他 160 万元）；' +
      '无欠税、无税务行政处罚、无非正常户记录；社保缴纳人数 186 人，缴纳基数合规。',
  },

  // ------------------------------------------------------------------
  // 2. 石家庄恒通贸易有限公司 —— 有风险企业
  // ------------------------------------------------------------------
  'SJZ-HT-002': {
    basic: {
      id: 'SJZ-HT-002',
      name: '石家庄恒通贸易有限公司',
      creditCode: '91130100MA08Y2CD34',
      legalPerson: '李国强',
      registeredCapital: '2000 万元人民币',
      establishDate: '2016-08-22',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市长安区和平东路 299 号',
      businessScope:
        '钢材、建材、化工产品（危险化学品除外）、机电设备的销售；仓储服务（危险品除外）；普通货运。',
      shareholders: [
        { name: '李国强', type: '自然人', ratio: '51%' },
        { name: '河北恒通实业有限公司', type: '企业', ratio: '49%', enterpriseId: 'HB-HT-IND' },
      ],
      outwardInvestments: [],
    },
    creditReport:
      '【征信摘要】近 6 个月贷款审批查询 8 次（其中 5 次为近 3 个月），查询机构包括 4 家城商行和 2 家小贷公司，' +
      '查询频率明显偏高；当前未结清贷款余额 2600 万元：工商银行 1000 万元（抵押）、' +
      '河北银行 600 万元（保证）、张家口银行 500 万元（信用）、某小贷公司 500 万元（信用，利率 15.6%）；' +
      '近 12 个月有 1 次逾期（320 万元，逾期 12 天，已结清）；对外担保 800 万元（被担保方法人代表与本企业为同一人）；' +
      '存在 2 笔未结清银行承兑汇票敞口共计 450 万元。',
    financial:
      '【财报关键指标（2025 年度）】总资产 1.45 亿元，总负债 1.06 亿元，资产负债率 73.1%（同比上升 8.4 个百分点）；' +
      '流动资产 0.98 亿元，流动负债 0.89 亿元，流动比率 1.10，速动比率 0.72；' +
      '营业收入 2.1 亿元，同比下降 6.5%；净利润 320 万元，净利率 1.5%；' +
      '经营性现金流净额 -180 万元（连续两年为负）；应收账款 3200 万元，周转天数 128 天；' +
      '其他应收款 1960 万元，占流动资产 20.0%（主要为关联方资金拆借 1500 万元，账龄 2 年以上）；' +
      '存货 2800 万元，周转天数 142 天（存在积压）。',
    litigation:
      '【司法诉讼】近 2 年涉及 3 起诉讼：（1）作为被告，2025 年 6 月因买卖合同纠纷被某钢铁公司起诉，' +
      '涉案金额 380 万元，法院一审判决本公司支付货款及违约金共计 402 万元，目前处于二审阶段；' +
      '（2）作为原告，2025 年 11 月起诉下游客户拖欠货款 220 万元，尚未开庭；' +
      '（3）2026 年 3 月因运输合同纠纷被起诉，涉案金额 45 万元，已调解。' +
      '无失信被执行记录，无限制高消费记录。',
    tax:
      '【税务信息】纳税信用等级 B 级；2025 年度实缴税款 320 万元（同比下降 28%）；' +
      '2025 年 9 月因增值税申报数据与发票数据比对异常被税务机关约谈，已补税并缴纳滞纳金 8.6 万元；' +
      '无欠税余额，无重大税务行政处罚；社保缴纳人数 68 人。',
  },

  // ------------------------------------------------------------------
  // 3. 河北鑫达钢铁有限公司 —— 高风险企业（失信被执行）
  // ------------------------------------------------------------------
  'HB-XD-003': {
    basic: {
      id: 'HB-XD-003',
      name: '河北鑫达钢铁有限公司',
      creditCode: '91130200MA09Z3EF56',
      legalPerson: '赵志明',
      registeredCapital: '1.2 亿元人民币',
      establishDate: '2008-05-10',
      status: '存续（在营、开业、在册）',
      address: '河北省唐山市丰润区工业园区 8 号',
      businessScope:
        '钢铁冶炼、钢材轧制、金属制品加工销售；焦炭、铁矿石、铁合金销售；自营和代理货物进出口。',
      shareholders: [
        { name: '赵志明', type: '自然人', ratio: '40%' },
        { name: '唐山鑫达实业集团有限公司', type: '企业', ratio: '35%', enterpriseId: 'TS-XD-GROUP' },
        { name: '河北志诚投资有限公司', type: '企业', ratio: '25%', enterpriseId: 'HB-ZC-INV' },
      ],
      outwardInvestments: [
        { name: '唐山鑫达矿业有限公司', ratio: '80%', enterpriseId: 'TS-XD-MINE' },
        { name: '河北鑫达贸易有限公司', ratio: '60%', enterpriseId: 'HB-XD-TRADE' },
      ],
    },
    creditReport:
      '【征信摘要】近 3 个月贷款审批查询 6 次，均被拒绝；当前未结清贷款余额 1.85 亿元，' +
      '其中已逾期 5 笔共计 9600 万元（最长逾期 218 天），分类均为"次级/可疑"；' +
      '欠息累计 1280 万元；涉及 3 家银行（工商银行 4200 万元、中国银行 3800 万元、唐山银行 1600 万元）及' +
      '2 家融资租赁公司合计 8900 万元；对外担保 6000 万元，其中 3000 万元已被代偿；' +
      '票据贴现逾期 1200 万元；已被列入银行多头借贷黑名单。',
    financial:
      '【财报关键指标（2025 年度）】总资产 8.6 亿元，总负债 9.8 亿元，资产负债率 113.9%（已资不抵债）；' +
      '流动资产 3.2 亿元，流动负债 6.1 亿元，流动比率 0.52，速动比率 0.31；' +
      '营业收入 12.5 亿元，同比下降 22.8%；净利润 -1.86 亿元（连续三年亏损）；' +
      '经营性现金流净额 -2.4 亿元；应收账款 1.8 亿元，周转天数 285 天（其中 8000 万元账龄超 2 年）；' +
      '其他应收款 1.2 亿元，占流动资产 37.5%（含对关联方担保代偿款 9000 万元）；' +
      '存货 3.6 亿元（部分钢材市价已低于成本价，存在明显减值风险）；' +
      '固定资产 4.2 亿元，已抵押 3.8 亿元。',
    litigation:
      '【司法诉讼】近 3 年涉及诉讼 23 起，其中作为被告 19 起，涉案总金额约 2.1 亿元；' +
      '（1）2025 年 8 月被某原料供应商起诉，涉案金额 6800 万元，已判决，未履行；' +
      '（2）2025 年 12 月被某银行起诉金融借款合同纠纷，涉案金额 4200 万元及利息，已判决，未履行；' +
      '（3）2026 年 2 月因环保违法被行政处罚 280 万元，尚未缴纳；' +
      '已被列入失信被执行人名单（案号 (2025)冀02执1289号），法定代表人赵志明被限制高消费；' +
      '名下 3 处不动产及 2 个银行账户已被查封冻结。',
    tax:
      '【税务信息】纳税信用等级 D 级（2025 年度评定）；2025 年 11 月因虚开增值税专用发票被税务稽查，' +
      '涉及税额 1860 万元，目前案件已移送公安机关；欠缴税款合计 2380 万元及滞纳金；' +
      '2026 年 1 月被认定为非正常户；存在 3 笔税务行政处罚记录，共计罚款 520 万元；' +
      '社保缴纳人数从两年前的 820 人降至 186 人，存在欠缴社保情况。',
  },

  // ------------------------------------------------------------------
  // 关联企业（股权穿透用，仅工商信息，其他域暂无数据）
  // ------------------------------------------------------------------
  'HB-HS-GROUP': {
    basic: {
      id: 'HB-HS-GROUP',
      name: '河北宏盛投资集团有限公司',
      creditCode: '91130100MA05G1HI88',
      legalPerson: '王建国',
      registeredCapital: '2 亿元人民币',
      establishDate: '2005-09-08',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市桥西区中山西路 99 号',
      businessScope: '以自有资金对制造业、物流业、房地产业进行投资；企业管理咨询。',
      shareholders: [
        { name: '王建国', type: '自然人', ratio: '80%' },
        { name: '王建华', type: '自然人', ratio: '20%' },
      ],
      outwardInvestments: [
        { name: '河北宏盛建材有限公司', ratio: '30%', enterpriseId: 'HB-HS-001' },
      ],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'HB-HS-LOGI': {
    basic: {
      id: 'HB-HS-LOGI',
      name: '河北宏盛物流有限公司',
      creditCode: '91130100MA0D2LO210',
      legalPerson: '王建国',
      registeredCapital: '1000 万元人民币',
      establishDate: '2018-04-20',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市裕华区建华南大街 170 号',
      businessScope: '普通货物道路运输；仓储服务（危险品除外）；货运代理；物流信息咨询。',
      shareholders: [
        { name: '河北宏盛建材有限公司', type: '企业', ratio: '100%', enterpriseId: 'HB-HS-001' },
      ],
      outwardInvestments: [],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'HB-HT-IND': {
    basic: {
      id: 'HB-HT-IND',
      name: '河北恒通实业有限公司',
      creditCode: '91130100MA06HT7799',
      legalPerson: '李国强',
      registeredCapital: '5000 万元人民币',
      establishDate: '2010-11-15',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市长安区和平东路 301 号',
      businessScope: '钢材、建材、金属材料销售；实业投资；仓储服务。',
      shareholders: [
        { name: '李国强', type: '自然人', ratio: '100%' },
      ],
      outwardInvestments: [
        { name: '石家庄恒通贸易有限公司', ratio: '49%', enterpriseId: 'SJZ-HT-002' },
      ],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'TS-XD-GROUP': {
    basic: {
      id: 'TS-XD-GROUP',
      name: '唐山鑫达实业集团有限公司',
      creditCode: '91130200MA02XD7700',
      legalPerson: '赵志明',
      registeredCapital: '3 亿元人民币',
      establishDate: '2001-06-18',
      status: '存续（在营、开业、在册）',
      address: '河北省唐山市丰润区工业园区 1 号',
      businessScope: '钢铁、矿业、制造业投资；企业管理；金属材料销售。',
      shareholders: [
        { name: '赵志明', type: '自然人', ratio: '70%' },
        { name: '赵志强', type: '自然人', ratio: '30%' },
      ],
      outwardInvestments: [
        { name: '河北鑫达钢铁有限公司', ratio: '35%', enterpriseId: 'HB-XD-003' },
        { name: '唐山鑫达矿业有限公司', ratio: '20%', enterpriseId: 'TS-XD-MINE' },
      ],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'HB-ZC-INV': {
    basic: {
      id: 'HB-ZC-INV',
      name: '河北志诚投资有限公司',
      creditCode: '91130100MA07ZC0520',
      legalPerson: '孙志诚',
      registeredCapital: '8000 万元人民币',
      establishDate: '2014-03-22',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市裕华区槐安东路 120 号',
      businessScope: '以自有资金对矿业、钢铁业进行投资；投资咨询。',
      shareholders: [
        { name: '孙志诚', type: '自然人', ratio: '60%' },
        { name: '赵志明', type: '自然人', ratio: '40%' },
      ],
      outwardInvestments: [
        { name: '河北鑫达钢铁有限公司', ratio: '25%', enterpriseId: 'HB-XD-003' },
      ],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'TS-XD-MINE': {
    basic: {
      id: 'TS-XD-MINE',
      name: '唐山鑫达矿业有限公司',
      creditCode: '91130200MA08MN0033',
      legalPerson: '赵志明',
      registeredCapital: '6000 万元人民币',
      establishDate: '2015-07-09',
      status: '存续（在营、开业、在册）',
      address: '河北省唐山市迁安市首钢工业园区',
      businessScope: '铁矿石开采、加工、销售；矿产品销售。',
      shareholders: [
        { name: '河北鑫达钢铁有限公司', type: '企业', ratio: '80%', enterpriseId: 'HB-XD-003' },
        { name: '唐山鑫达实业集团有限公司', type: '企业', ratio: '20%', enterpriseId: 'TS-XD-GROUP' },
      ],
      outwardInvestments: [],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },

  'HB-XD-TRADE': {
    basic: {
      id: 'HB-XD-TRADE',
      name: '河北鑫达贸易有限公司',
      creditCode: '91130100MA09TR0044',
      legalPerson: '赵志强',
      registeredCapital: '3000 万元人民币',
      establishDate: '2016-10-11',
      status: '存续（在营、开业、在册）',
      address: '河北省石家庄市长安区建设北大街 88 号',
      businessScope: '钢材、铁矿石、焦炭、金属材料销售；货物进出口。',
      shareholders: [
        { name: '河北鑫达钢铁有限公司', type: '企业', ratio: '60%', enterpriseId: 'HB-XD-003' },
        { name: '赵志强', type: '自然人', ratio: '40%' },
      ],
      outwardInvestments: [],
    },
    creditReport: '【征信摘要】该关联企业暂未接入征信详细数据。',
    financial: '【财报信息】该关联企业暂未接入财报详细数据。',
    litigation: '【司法诉讼】该关联企业暂未接入司法详细数据。',
    tax: '【税务信息】该关联企业暂未接入税务详细数据。',
  },
};

/**
 * 获取企业完整数据（内部辅助）
 */
export function getEnterpriseData(enterpriseId: string): EnterpriseFullData | null {
  return DATA[enterpriseId] || null;
}

/**
 * 获取所有企业简要列表
 */
export function listEnterprises(): EnterpriseSummary[] {
  return ENTERPRISES;
}
