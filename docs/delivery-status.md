# 本周交付状态

更新时间：2026-06-29

## 当前线上版本

- 正式站点：https://paper-ai-tool.vercel.app
- 当前线上代码提交：`fbdab47 Add production delivery check and storage quota guard`
- 当前部署：`paper-ai-tool-6w6dbm98l-lemorrrs-projects.vercel.app`
- 正式域名 alias：已指向最新部署。

## 已验证

- `npx tsc --noEmit --pretty false` 通过。
- `npm run build` 通过。
- `npm run smoke:research-ui-contract` 通过。
- `npm run smoke:bundle-size` 通过。
- `npm run smoke:prod-auth-project` 通过：生产环境正式注册、登录、`/me`、项目创建/列表/读取/更新/删除均正常。
- `npm run smoke:prod-citation-enhance` 通过：生产环境使用正式临时账号生成 4 条引用增强补丁，覆盖 2 个章节、3 个来源；无无来源补丁、无不相关补丁。
- `npm run smoke:prod-research-ahp` 通过：生产环境使用正式临时账号完成 AHP 分析，生成 2 张表、2 张图、15 个研究组件，并导出可检查的 Word。
- `npm run smoke:prod-research-kano` 通过：生产环境使用真实 KANO/熵权 Excel 样本生成 3 张表、4 张图、24 个研究组件，并导出可检查的 Word。
- `npm run smoke:prod-stage3-generation-e2e` 通过：正式站 Stage3 点击生成全文后显示进度并完成生成，最新部署验证持久化 3 个章节、3345 字。
- `npm run smoke:prod-cloud-restore` 通过：正式站新浏览器登录后可恢复项目、大纲、正文和研究包，且不再出现本地占位项目重复上传导致的 duplicate key。
- `npm run seed:prod-demo` 通过：可在生产环境创建/刷新含大纲、正文和研究包的客户演示项目。
- `npm run check:prod-delivery -- --skip-build --skip-seed` 通过：一键串联生产登录/项目、云端恢复、Stage3 全文生成三条核心交付检查。
- 最新部署后复查 `npm run smoke:prod-auth-project`、`npm run smoke:prod-cloud-restore` 通过。
- `npm run smoke:prod-stage3-research-e2e` 通过：正式站从 Stage3 打开研究计算、上传 Excel、生成分析、写入论文并导出 Word；导出文件含 5 个表题、4 个图题、4 张有效 PNG。
- `npm run smoke:citation-docx` 通过：正文脚注引用、footnotes relationship/content type 正常。
- `npm run smoke:footnote-persistence` 通过：脚注可恢复并可导出到 docx。
- `npm run smoke:citation-enhance` 通过：生成 3 条引用增强补丁，docx 脚注结构正常。
- `npm run smoke:citation-patch-docx` 通过：引用补丁可幂等应用，重复运行不重复插入。
- `npm run smoke:research-chain` 通过：真实 KANO/熵权样本生成 3 张表、4 张图、24 个研究组件，并分配到方法/结果/讨论章节。
- `npm run smoke:research-word-render` 通过：研究链路导出的 docx 可渲染为 7 页 PDF/PNG，页面非空白。
- `GET /api/health` 返回 `{"ok":true,"service":"paper-ai-tool-api"}`。
- 正式站首页返回 200。
- 正式站登录页返回 200。
- 正式登录页不再展示演示账号入口，直达 `/demo` 会提示演示入口已停用并返回登录。
- 生产环境 `/api/auth/demo-login` 返回 403，符合“正式环境禁用演示登录”的安全预期。
- 生产 E2E 验收脚本已迁移到正式注册/登录路径，不再依赖生产禁用的演示登录。
- 生产演示项目种子脚本已加入 `npm run seed:prod-demo`，支持固定账号/项目重复刷新，避免客户演示现场从零生成。
- 生产交付验收脚本已加入 `npm run check:prod-delivery`；默认覆盖 build、生产登录/项目、云端恢复、Stage3 全文生成和演示项目刷新，`--full` 可追加引用增强、KANO 研究计算和 Stage3 研究计算到 Word 导出。

## 本轮新增验证输出

- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-patch-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\citation-enhance-docx-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\research-chain-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\prod-ahp-research-smoke.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\prod-kano-research-smoke.docx`
- `C:\Users\jingyan.ren\AppData\Local\Temp\stage3-research-e2e-1782736559367\Stage3 研究计算生产 E2E.docx`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\word-render-research-chain-smoke\word-render-smoke.pdf`
- `D:\Art Thesis Agent Writer\outputs\ich_kano_entropy\word-render-research-chain-smoke\contact-sheet.png`

## 本轮已补齐

### P0 稳定性

- 修复新浏览器打开远端项目时 `projectStore.ensure` 创建本地占位项目并重复上传到云端的问题，避免 `/api/projects` duplicate key 同步失败。
- 前后端 Sentry 错误观测已接入，未配置 `SENTRY_DSN` / `VITE_SENTRY_DSN` 时保持 inert，不影响本地和未配置环境。
- Stage3 已有正文时会清理过期的“等待大纲”生命周期提示，避免恢复云端正文后仍误导用户回到阶段二。
- localStorage 写入增加 quota 兜底：聊天记录和版本快照会保留最近关键记录，降低长时间使用后因本地缓存过大导致页面卡住的风险。

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

- 固定客户演示账号与演示项目：种子脚本已验证；仍需要决定正式给客户使用的固定邮箱和密码。
- 换浏览器登录后的云端恢复已通过自动化验证；仍建议用固定客户演示账号人工复查一次。
- 用客户真实题目人工验收全文质量、引用贴合度和研究结论表述。
- 用客户真实 Excel 再跑一遍研究计算，确认字段识别、图表样式和 Word 格式；系统已通过内置真实 KANO/熵权样本，但客户文件仍需人工验收。

### 仍未完全产品化

- 长任务状态目前是前端持久化，不是完整后端任务队列；刷新可提示恢复，但不能在后台继续执行已断开的生成。
- 引用增强生产冒烟已通过；仍需要真实客户项目人工验收观点与来源匹配度，尤其是模型识别和方法引用是否完全贴合。
- Word-like 分页编辑仍采用连续编辑器 + 视觉层方向，不是完整 Word 排版引擎。
- 线上错误观测已有 Sentry 接入点；仍需要在 Vercel 环境变量中配置 `SENTRY_DSN` / `VITE_SENTRY_DSN` 才会真正上报。

## 下一步建议

1. 准备正式客户演示账号。
2. 用该账号跑一遍完整线上主链路。
3. 用正式账号上传客户真实 Excel 样本，确认线上研究计算链路与本地冒烟一致。
4. 导出 Word 并人工打开检查格式、脚注、图表、表题。
5. 如果以上通过，再把域名、账号、演示项目固定给客户。
