# 站外标注 + 原型重建方案（仅有链接的存量项目）

> 状态：**待评审，未开工** ｜ 2026-09-15
> 适用：接手的存量项目**只有一个可访问地址**，无源码、无 build 文件（本版只收束这一种情况）。
> 参考对象：担易信 http://192.168.108.125:2461/showcase （Vue SPA，5 域约 27 页）

## 1. 一句话方案

Chrome 扩展在真实页面上标注；点「采集本页」时把**渲染后 DOM + 关键样式 + 资源 URL + 该页意见**抽出来回传 PF；PF 用这些一手结构信息重建出 PF 原生页面（不是照截图猜）。逐页采集、逐页重建，不做全量克隆。

## 2. 为什么是抽 DOM，不是截图

- DOM 里有精确的字段、表格列、层级、文案、Tailwind class（class 本身就是布局信息）
- computed style 给真实颜色/字体/间距，资源 URL 给图片图标
- 截图只作为 canvas 图表区域的补充，不当主输入

## 3. 三个必须处理的缺口

| 缺口 | 处理 |
|---|---|
| DOM 只是某一瞬间，弹窗/抽屉/空态/报错/分页第 2 页不在里面 | **一页可采多次快照**：打开弹窗后「再抓一份当前状态」，多快照一起喂给生成，AI 把状态还原成真实可点交互（弹窗就做成可点开的） |
| 行为逻辑 DOM 里没有（点了调什么接口、跳哪） | 不还原真逻辑，靠标注意见描述 + AI 造假数据静态交互——原型阶段够用 |
| `<canvas>` 图表（风控看板必有）抽不到图形 | 采集时检测 canvas，**自动对该区域补一张截图**随快照上报 |

## 4. 三块施工

### A. Chrome 扩展（自用，开发者模式本地加载）

content script 注入从 proto-shell 抽出的圈选标注器（圈选/粒度拨杆/贴意见/角标，现成逻辑），去掉壳相关部分，样式加前缀隔离。

- popup：选归属 PF 项目、PF 地址（默认 localhost:3100）、当前页意见数
- 元素锚点：沿用 `tag:nth-of-type(n)[文本锚点]` 路径（无源可拿组件名）
- 「采集本页」抽取规则：
  1. 克隆渲染后 DOM，删 `<script>/<style>/事件属性/svg 内的冗余节点`，保留 class / 文本 / 表单结构
  2. 主要节点采少量关键 computed style（color、font、背景、margin/padding、flex/grid、宽高、边框圆角），不全采（防上下文爆炸）
  3. 图片/图标资源 URL 原样保留（可访问的内网站点直接引用；不可访问时后续考虑下载入库）
  4. canvas 区域自动截图补入
  5. 支持「追加当前状态快照」
- 首次在某站使用时，顺带上报一份**站点导航菜单**（一级/二级菜单文案+URL），用于在 PF 壳里生成导航
- background 发请求绕过 CORS；本地 token 鉴权，不做账号体系

### B. PF 后端

- `annotations` 表加列：`page_url TEXT`、`origin TEXT DEFAULT 'shell'`（存量行不受影响）
- 新接口：
  - `POST /api/external/annotations` 贴意见（projectId + pageUrl + 锚点 + 内容）
  - `GET  /api/external/annotations?projectId=&url=` 拉本页意见
  - `POST /api/external/collect` 上报采集包（URL、标题、DOM、样式、快照[]、canvas 截图、意见、导航表）→ 入队
  - `GET  /api/external/jobs/:id` 重建进度
- CORS 放行扩展 origin

### C. 重建生成

- 新增「外部页面重建」pipeline，复用 `buildPageHtml` 的模型调用与 HTML 校验，产出仍是过校验的 PF 原生片段
- prompt 硬指令：按给定真实 DOM 结构与样式 1:1 还原布局/字段/文案/配色；多快照还原成可点交互；数据用静态假数据；输出 Tailwind HTML 片段
- spec page 带来源标记，不绑 requirementId：
  ```json
  { "id": "ext-xxx", "title": "企业评估工作台", "group": "准入评估",
    "source": { "type": "external", "url": "http://...", "capturedAt": "..." } }
  ```
- 导航：已重建页走 PF 原生页；**未重建页保留为外链项，点击新开真站 URL**——采到哪页，哪页并轨
- spec 升 v3（source/externalUrl 为可选字段，v2 数据兼容）

## 5. 边界（不做）

- 不做运行时覆盖/补丁注入那条产品线
- 不自动建需求、不做页面→需求反推
- 不保证逻辑级 1:1；复杂自研组件还原为原型级静态版
- 不做多用户、权限、Chrome 商店

## 6. 施工顺序

1. **半天验链路**：bookmarklet 注入标注器 → 意见回传本地 PF → PF 可见
2. B：表迁移 + 接口（curl 验）
3. A：扩展标注/回传/采集
4. C：单页跑通「DOM+样式 → 重建页」，再多快照、canvas 截图、导航外链
5. 逐页采集担易信 v1.1 涉及页面

## 7. 待确认

1. 测试账号（业务页要登录才能采）
2. 内网图片资源在 PF 原型里直接外链引用是否可接受（你本机和演示机都能连 192.168 网段即可）
3. vision/生成模型沿用现有配置，重建 token 费用只在采集时发生
