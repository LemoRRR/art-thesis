# 本周交付状态

更新时间：2026-06-29

## 当前线上版本

- 正式站点：https://paper-ai-tool.vercel.app
- 当前线上代码提交：`ca15a10 Enforce research workflow ordering`
- 当前部署：`paper-ai-tool-miv6zynim-lemorrrs-projects.vercel.app`
- 正式域名 alias：已指向最新部署。

## 已验证

- `npx tsc --noEmit --pretty false` 通过。
- `npm run build` 通过。
- `npm run smoke:research-ui-contract` 通过。
- `npm run smoke:bundle-size` 通过。
- `npm run smoke:prod-auth-project` 通过：生产环境正式注册、登录、`/me`、项目创建/列表/读取/更新/删除均正常。
- `npm run smoke:prod-citation-enhance` 通过：生产环境使用正式临时账号生成 4 条引用增强补丁，覆盖 2 个章节、多个来源。
- `npm run smoke:citation-docx` 通过：正文脚注引用、footnotes relationship/content type 正常。
- `npm run smoke:footnote-persistence` 通过：脚注可恢复并可导出到 docx。
- `npm run smoke:citation-enhance` 通过：生成 3 条引用增强补丁，docx 脚注结构正常。
- `npm run smoke:citation-patch-docx` 通过：引用补丁可幂等应用，重复运行不重复插入。
- `npm run smoke:research-chain` 通过：真实 KANO/熵权样本生成 3 张表、4 张图、24 个研究组件，并分配到方法/结果/讨论章节。
- `npm run smoke:research-word-render` 通过：研究链路导出的 docx 可渲染为 7 页 PDF/PNG，页面非空白。
- `GET /api/health` 返回 `{"ok":true,"service":"paper-ai-tool-api"}`。
- 正式站首页返回 200。
- 正式站登录页返回 200。
- 生产环境 `/api/auth/demo-login` 返回 403，符合“正式环境禁用演示登录”的安全预期。

## 本轮新增验证输出

- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-patch-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-enhance-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\research-chain-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\word-render-research-chain-smoke\word-render-smoke.pdf`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\word-render-research-chain-smoke\contact-sheet.png`

## 本轮已补齐

### P0 稳定性

- Stage3 全文生成写入长任务状态：准备、检索文献、生成计划、逐章生成、保存云端、完成、失败。
- Stage3 刷新后如发现上次任务处于 pending/running，会显示可恢复提示，不再静默消失。
- 研究计算写入长任务状态：准备分析、识别方案、等待确认、运行计算、生成论文表述、完成、失败。
- 研究计算刷新后如上次任务中断，会提示用户重新生成，不再表现为无反应。

### 研究工作流顺序

- 项目首页“研究计算”入口会先判断是否已有全文初稿。
- 没有全文时，入口引导到 Stage3，并提示“请先进入文章生成，生成或确认全文初稿后再做研究计算”。
- 直达 `/projects/:id/research` 时，如果没有全文初稿，会显示守门页，引导先生成或确认正文。
- `/projects/:id/research/assets` 仍可作为研究资产库查看入口，不被全文守门阻断。

### 研究计算体验

- 上传 Excel/CSV/TXT 后显示数据集卡片。
- 卡片展示文件名、文件类型、样本量、字段数、上传时间、状态。
- 分析结果优先展示图像、表格、论文表述，底部保留可编辑文本。
- 定量分析在正式计算前有“确认分析方案/变量映射”步骤。

## 仍需补齐

### 必须人工或真实账号验证

- 正式账号登录。
- 换浏览器登录后，项目、大纲、正文、研究资产是否完整恢复。
- Stage1 → Stage2 → Stage3 → 导出 Word 的完整线上流程。
- 上传真实 Excel → 确认分析方案 → 生成图表/表格 → 写入论文 → 导出 Word。

### 仍未完全产品化

- 长任务状态目前是前端持久化，不是完整后端任务队列；刷新可提示恢复，但不能在后台继续执行已断开的生成。
- 引用增强本地冒烟已通过；仍需要真实客户项目验收观点与来源匹配度。
- Word-like 分页编辑仍采用连续编辑器 + 视觉层方向，不是完整 Word 排版引擎。
- 线上错误观测还不够完整，建议接入服务端日志聚合或 Sentry。

## 下一步建议

1. 准备正式客户演示账号。
2. 用该账号跑一遍完整线上主链路。
3. 用正式账号上传客户真实 Excel 样本，确认线上研究计算链路与本地冒烟一致。
4. 导出 Word 并人工打开检查格式、脚注、图表、表题。
5. 如果以上通过，再把域名、账号、演示项目固定给客户。
