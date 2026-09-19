# 原型生成 v2：AI 生成页面代码（2026-09-04 定型）

> v1 是「AI 填 JSON 配置 → 三个写死的 Vue 骨架渲染」，布局/视觉表达力到顶（按钮变色、搜索框换位都做不到）。
> v2：**AI 直接产出页面代码**（HTML 片段 + Tailwind + 原生 JS），壳注入 PF SDK 管数据/导航/标注。局部 patch 原则不变。

## 产物结构（prototypes.spec_json，version: 2）

```jsonc
{
  "version": 2,
  "appName": "担保业务管理系统",
  "nav": [ { "pageId": "GuaranteeList", "title": "台账列表", "group": "台账管理", "requirementId": "可选" } ],
  "pages": [
    { "id": "GuaranteeList", "title": "台账列表", "kind": "form|list|detail",
      "html": "<页面 HTML 片段>", "requirementId": "可选" }
  ],
  "datasets": [
    { "name": "guarantees", "statusField": "status",
      "statusMap": { "pending": {"text":"待审核","type":"warning"} },
      "records": [ {"id":"r1", ...} ] }
  ],
  "pageStatus": { "GuaranteeList": "ready" },  // pending|ready|error，逐页点亮
  "requirements": [ { "id": "...", "title": "...", "kind": "page|module", "docMd": "..." } ]
}
```

## 渲染

- 壳：`server/src/assets/proto-shell.html`（Tailwind play CDN 离线内联：`assets/tailwind-play.js`）。
- 页面 html 是**片段**（无 `<html>/<head>/<body>`），注入 `#pf-page-root`，其中 `<script>` 手动取出执行（innerHTML 插入的 script 不跑）。
- 在线：`GET /proto/:projectId`（壳 fetch spec 轮询）；导出：单文件 HTML（spec 内联，`__PF_OFFLINE__`）。
- 平台内嵌：PrototypePanel iframe 指向 `/proto/:id`（vite proxy 已加）。

## PF SDK（页面代码里的全局对象）

| API | 作用 |
| --- | --- |
| `PF.records(ds)` / `PF.findRecord(ds, id)` | 读数据集（深拷贝） |
| `PF.addRecord(ds, obj, status?)` / `PF.updateRecord(ds, id, patch)` | 写（内存态，刷新复位） |
| `PF.go(pageId, params?)` / `PF.params()` | 导航（hash 路由 `#/page/<id>?id=xx`） |
| `PF.toast(msg, type)` | 顶部提示 |
| `PF.money(n)` / `PF.statusMap(ds)` / `PF_STATUS_CLASS` | 格式化 |
| `data-annot="field|action|section" data-label="中文名"` | 标注锚点（壳事件委托拦截） |

## 生成管线（prototypeCodeGen.ts）

1. **骨架 worker**：需求文档 → JSON 契约（nav/pages 清单 + datasets + mock 数据），落库前端先见导航。
2. **页面 worker 并行**：每页一个 AI 调用，输出 HTML 片段；`checkPageHtml` 校验（片段约束、PF.go/数据集引用存在、`<script>` 语法 `new Function` 编译）；好一页写回一页。
3. **patch（prototypePatcher.ts）**：意见 → AI 看全部页面代码，只输出涉及页面的完整 html → 按 id 替换；未涉及页面不经 AI；businessRule 序号分流（UI 类结单 / 业务类挂 needs_req 同步需求）。

## 铁律

- 页面代码不许 fetch / localStorage 造假数据，数据只走 PF。
- patch 只动涉及页面；业务口径全局一致（同字段多页要一起改）。
- 旧 v1 数据不兼容（spec.version !== 2 直接提示重新生成）。
