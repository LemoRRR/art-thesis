# 论文 AI 工具生产交付总文档

更新时间：2026-06-30

## 1. 项目定位

本项目是一个面向论文写作、资料管理、AI 生成、研究计算和 Word 导出的在线工具。

核心目标是让用户按照真实论文工作流完成：

1. 创建论文项目。
2. 输入题目、研究方向、资料和要求。
3. 生成并确认大纲。
4. 生成全文并继续编辑。
5. 自动或手动补充引用、脚注、参考文献。
6. 上传问卷/访谈/实验数据，生成研究计算结果。
7. 将图表、表格和论文表述插入正文。
8. 导出 Word 文档。

当前正式站点：

- 正式访问地址：https://paper-ai-tool.vercel.app
- 生产状态文档：`docs/delivery-status.md`
- 客户演示 Runbook：`docs/customer-demo-runbook.md`

## 2. 当前推荐商业部署方案

当前建议使用 Supabase 作为正式数据后台。

Supabase 的定位：

- 不是传统服务器。
- 更像已经搭好的数据后台服务。
- 负责用户账号、登录、数据库、权限、数据同步、文件存储和备份能力。

当前业务判断：

- 使用团队约 6-7 人。
- 业务是阶段性/季度性使用。
- 高峰周期约 90 篇论文，不是全年持续高并发。
- 日常小批量时可以先用 Supabase Free。
- 高峰期建议开 Supabase Pro，约 25 美金/月，折合约 180 元人民币/月；全年连续开约 2160 元人民币。
- Free 项目低活跃一段时间后可能暂停，暂停后可从后台恢复；高峰期使用 Pro 更稳。

当前暂不建议马上自建服务器作为主数据库，原因：

- 自建服务器需要维护系统、数据库、备份、安全、证书、磁盘和日志。
- 当前只有少量工程维护能力，Supabase Pro 更省心。
- 真正需要自建服务器的场景是：国内访问明显不稳定、长任务需要后台队列、Python 计算/Word 导出负载明显变大、或 Supabase/Vercel 账单长期高于运维成本。

## 3. 系统功能总览

### 3.1 登录和用户

功能：

- 用户注册。
- 用户登录。
- 登录状态恢复。
- 正式环境禁用 Demo 登录入口。
- 用户数据按账号隔离。

主要数据：

- 用户账号。
- session/access token。
- 用户拥有的项目、资料、正文、研究包。

### 3.2 项目管理

一个项目对应一篇论文或一个研究任务。

功能：

- 创建项目。
- 查看项目列表。
- 进入项目首页。
- 保存项目题目、描述、研究对象、学段/论文规格。
- 绑定资料库资料。
- 进入 Stage1、Stage2、Stage3、研究计算。

项目保存内容：

- 论文题目。
- 项目上下文。
- 当前阶段。
- 绑定资料。
- 大纲。
- 正文。
- 研究计算包。
- 版本历史。
- 引用/脚注数据。

### 3.3 资料库

资料库用于沉淀长期资料。

功能：

- 上传 PDF/Word/TXT 等资料。
- 手动录入资料文本。
- 解析资料文本。
- 保存资料标题、摘要、标签。
- 将资料绑定到某个论文项目。
- 在 AI 生成和引用中调用资料。

注意：

- 资料库是长期资产，不是单次生成临时附件。
- 后续如果文件数量增多，建议接 Supabase Storage 或对象存储。

### 3.4 Stage1：题目和材料理解

目标：

- 让 AI 先理解论文题目、研究对象、资料、课程要求和写作边界。

用户输入：

- 论文题目。
- 研究方向。
- 写作要求。
- 学校/课程要求。
- 已有摘要或初稿。
- 上传资料。

系统输出：

- 题目理解。
- 研究对象识别。
- 可写方向。
- 风险和缺口。
- 后续大纲生成基础。

### 3.5 Stage2：大纲生成和确认

目标：

- 形成论文结构母版。

功能：

- 基于 Stage1 结果生成大纲。
- 支持摘要、Abstract、一级标题、二级标题。
- 支持大纲编辑、排序、新增、删除。
- 支持确认大纲。
- 大纲确认后进入 Stage3。

产品规则：

- 大纲是正文结构的来源。
- 大纲排序应反映到正文结构。
- 后续新增章节时，优先只生成新增章节，不重写全文。

### 3.6 Stage3：全文生成和编辑

目标：

- 生成完整论文初稿，并让用户继续像 Word 一样编辑。

功能：

- 读取已确认大纲。
- 生成全文。
- 显示生成进度。
- 保存正文到云端。
- 刷新后恢复正文。
- 支持连续 TipTap/ProseMirror 编辑器。
- 支持段落编辑、删除、复制粘贴、撤回/重做。
- 支持框选后 AI 改写。
- 支持脚注/引用。
- 支持分页视觉预览。
- 支持 Word 导出。

当前分页策略：

- 主编辑体验仍是连续编辑器，保证好用。
- 页面/脚注是视觉层和导出层，不强行把编辑 DOM 切成真实 Word 页面。
- 导出 Word 后由 Word/WPS 处理最终分页。

### 3.7 引用、脚注和参考文献

功能：

- 正文中展示 `[1]`、`[2]` 等引用编号。
- 引用和 footnote/citation 数据绑定。
- 支持选区添加脚注。
- 支持查看来源。
- 支持 Word 导出时保留脚注和参考文献信息。
- 支持自动文献增强生成。

当前策略：

- 生成全文前可自动检索 OpenAlex/Crossref。
- AI 筛选来源。
- 逐章生成正文时使用来源。
- 后续可以在已有正文基础上补充引用。

风险：

- 引用质量仍需要人工抽查。
- 尤其要确认“观点和文献是否真实对应”。

### 3.8 研究计算

研究计算用于把数据分析结果融入论文，而不是作为独立模块堆在论文外。

支持场景：

- 还没有数据：生成问卷、访谈提纲、AHP 表。
- 已有数据：上传 Excel/CSV/TXT 分析。
- 已有问卷：优化问卷、检查量表。

当前支持/规划的方法：

- KANO。
- 熵权法。
- AHP。
- 普通定量分析。
- 描述统计。
- 信度分析。
- 相关分析。
- 方差分析。
- 因子分析。
- 回归分析。
- 中介分析。
- 定性编码。
- 访谈分析。

输出内容：

- 研究方法表述。
- 数据质量判断。
- 图表。
- 表格。
- 论文可用结果描述。
- 讨论/结论建议。
- 可插入 Stage3 正文的研究组件。

### 3.9 Word 导出

功能：

- 导出 `.docx`。
- 包含论文标题、摘要、正文、图表、表题、图题、脚注/参考文献。
- 研究计算插入后的图表可进入 Word。

交付前必须人工打开检查：

- 标题是否正常。
- 表格是否可读。
- 图片是否显示。
- 图题/表题是否重复。
- 脚注/参考文献是否正常。

### 3.10 云端恢复和稳定性

已完成能力：

- 登录后恢复项目。
- 恢复大纲。
- 恢复正文。
- 恢复研究包。
- 修复新浏览器打开远端项目导致重复创建本地占位项目的问题。
- localStorage 超限时裁剪聊天记录和版本快照，降低页面卡住风险。
- 生成全文/研究计算有长任务状态提示。

当前限制：

- 长任务状态主要是前端持久化，不是完整后端队列。
- 刷新后可提示恢复或重试，但不能保证断开的任务继续在后台执行。

## 4. 技术架构

### 4.1 前端

技术：

- React。
- Vite。
- TypeScript。
- TipTap/ProseMirror。
- docx 导出。
- xlsx 解析。

主要页面：

- `src/pages/Login.tsx`
- `src/pages/Projects.tsx`
- `src/pages/ProjectHome.tsx`
- `src/pages/Library.tsx`
- `src/pages/Stage1.tsx`
- `src/pages/Stage2.tsx`
- `src/pages/Stage3.tsx`
- `src/pages/ResearchCenter.tsx`
- `src/pages/ResearchHub.tsx`
- `src/pages/StyleProfiles.tsx`

### 4.2 后端

技术：

- Express。
- Supabase JS。
- OpenAI/Doubao API。
- Python 研究计算服务。
- Sentry 接入点。

主要路由：

- `/api/health`
- `/api/auth`
- `/api/projects`
- `/api/outlines`
- `/api/sections`
- `/api/chat`
- `/api/library`
- `/api/research`
- `/api/research-packages`
- `/api/references`
- `/api/scholar`
- `/api/ai`
- `/api/files`

### 4.3 数据后台

当前推荐：

- Supabase。

负责：

- Auth。
- PostgreSQL。
- 用户数据隔离。
- 项目数据。
- 大纲数据。
- 正文数据。
- 研究包。
- 聊天记录。
- 版本历史。

### 4.4 AI 服务

支持 provider：

- OpenAI。
- 豆包。

关键环境变量：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DOUBAO_BASE_URL`
- `DOUBAO_API_KEY`
- `DOUBAO_MODEL`

所有 key 应放在后端环境变量，不应写进前端代码或 Git。

### 4.5 Python 研究计算

用途：

- Excel/CSV 数据分析。
- KANO/熵权/AHP/定量/定性分析。
- 生成图表。
- 生成研究计算结果。

关键环境变量：

- `PYTHON_STATS_URL`
- `INTERNAL_SECRET`

### 4.6 监控

已接入：

- Sentry 前端/后端初始化代码。

当前状态：

- `/api/health` 显示生产环境 `sentry:false`，表示 Sentry DSN 尚未配置。

需要配置：

- `SENTRY_DSN`
- `VITE_SENTRY_DSN`

## 5. 使用说明

### 5.1 普通用户完整流程

1. 打开正式站点。
2. 注册或登录。
3. 创建论文项目。
4. 在 Stage1 输入题目、要求和资料。
5. 让 AI 理解材料。
6. 进入 Stage2 生成大纲。
7. 调整并确认大纲。
8. 进入 Stage3。
9. 点击生成全文。
10. 编辑正文。
11. 需要时框选文本进行 AI 改写。
12. 需要时进入研究计算。
13. 上传数据并生成分析结果。
14. 将研究结果插入论文。
15. 导出 Word。

### 5.2 客户演示流程

详见：

- `docs/customer-demo-runbook.md`

推荐不要在客户面前完全从零等待长任务生成。

推荐使用：

- 固定演示账号。
- 预置演示项目。
- 已有正文。
- 已有研究包。
- 可导出的 Word。

### 5.3 运维/交付检查

常用命令：

```bash
npm run build
npm run smoke:prod-health
npm run smoke:prod-auth-project
npm run smoke:prod-cloud-restore
npm run smoke:prod-stage3-generation-e2e
npm run smoke:prod-stage3-research-e2e
npm run smoke:prod-research-kano
npm run seed:prod-demo
npm run check:prod-delivery
npm run check:prod-delivery -- --full
```

`check:prod-delivery` 默认覆盖：

- build。
- 生产健康检查。
- 登录/项目 CRUD。
- 云端恢复。
- Stage3 全文生成。
- 演示项目刷新。

`--full` 会追加：

- 引用增强。
- KANO 研究计算。
- Stage3 研究计算到 Word 导出。

## 6. 账号、密码和关键信息

重要原则：

- 不要把真实密码、API key、数据库密钥写进 Git。
- 不要把真实密钥写到本文件。
- 真实信息应保存在密码管理器、公司内部安全文档或本地加密文件。
- 下面只列出需要登记的项目和用途。

### 6.1 正式站点

| 项目 | 当前信息 | 备注 |
| --- | --- | --- |
| 正式站点 | `https://paper-ai-tool.vercel.app` | 当前客户访问入口 |
| Vercel 项目 | `paper-ai-tool` | 用于前端/API 部署 |
| 生产健康检查 | `https://paper-ai-tool.vercel.app/api/health` | 查看部署和配置状态 |

### 6.2 Vercel

需要保存：

| 信息 | 是否敏感 | 保存位置 |
| --- | --- | --- |
| Vercel 登录邮箱 | 是 | 密码管理器 |
| Vercel 登录密码/SSO | 是 | 密码管理器 |
| Vercel team/project 权限 | 是 | 密码管理器/内部记录 |
| 生产部署 URL | 否 | 本文件可记录 |
| 环境变量 | 是 | Vercel Dashboard，不进 Git |

Vercel 必备环境变量：

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
DOUBAO_BASE_URL=
DOUBAO_API_KEY=
DOUBAO_MODEL=
PYTHON_STATS_URL=
INTERNAL_SECRET=
SENTRY_DSN=
VITE_SENTRY_DSN=
```

### 6.3 Supabase

需要保存：

| 信息 | 是否敏感 | 保存位置 |
| --- | --- | --- |
| Supabase 登录邮箱 | 是 | 密码管理器 |
| Supabase 登录密码/SSO | 是 | 密码管理器 |
| Project URL | 否/低敏 | 可记录 |
| anon key | 中敏 | 环境变量 |
| service role key | 高敏 | 密码管理器 + Vercel 环境变量 |
| 数据库连接串 | 高敏 | 密码管理器 |
| Pro 开通状态 | 否 | 运营记录 |

当前策略：

- 日常低频可先 Free。
- 业务高峰期开 Pro。
- Pro 约 25 美金/月，约 180 元人民币/月。
- 全年连续开约 2160 元人民币。

### 6.4 AI Provider

需要保存：

| Provider | 信息 | 是否敏感 |
| --- | --- | --- |
| OpenAI | API key | 高敏 |
| OpenAI | base URL | 低敏 |
| OpenAI | model | 低敏 |
| 豆包 | API key | 高敏 |
| 豆包 | base URL | 低敏 |
| 豆包 | model | 低敏 |

注意：

- API key 只放后端环境变量。
- 不要放到前端 `VITE_` 变量。
- 不要发到微信聊天截图里。

### 6.5 Sentry

需要保存：

| 信息 | 是否敏感 | 保存位置 |
| --- | --- | --- |
| Sentry 登录账号 | 是 | 密码管理器 |
| Sentry DSN | 中敏 | Vercel 环境变量 |
| 项目 URL | 低敏 | 内部记录 |

当前缺口：

- 代码已接入。
- 生产健康检查显示 `sentry:false`。
- 需要配置 `SENTRY_DSN` 和 `VITE_SENTRY_DSN`。

### 6.6 客户演示账号

不要把正式演示账号密码写进 Git。

建议登记到密码管理器：

| 信息 | 示例/说明 |
| --- | --- |
| 演示账号邮箱 | 由负责人填写 |
| 演示账号密码 | 由负责人填写 |
| 演示项目 URL | seed 后输出 |
| 演示项目用途 | 客户演示、培训、售前 |
| 最近刷新时间 | 每次 seed 后记录 |

刷新演示项目：

```bash
$env:PROD_DEMO_EMAIL="demo@example.com"
$env:PROD_DEMO_PASSWORD="replace-with-real-password"
$env:PROD_DEMO_PROJECT_ID="customer-demo-main"
npm run seed:prod-demo
```

### 6.7 域名

可选，但正式客户建议购买。

需要保存：

| 信息 | 是否敏感 |
| --- | --- |
| 域名注册商账号 | 是 |
| 域名 | 否 |
| DNS 控制权限 | 是 |
| 解析记录 | 低敏 |

当前可暂用：

- `paper-ai-tool.vercel.app`

### 6.8 本地私密清单模板

建议在本地另建一个不提交 Git 的文件，例如：

```text
private-ops-secrets.md
```

建议记录：

```text
# 私密运维信息，不提交 Git

Vercel:
- 登录邮箱:
- 登录方式:
- 项目:

Supabase:
- 登录邮箱:
- Project URL:
- anon key:
- service role key:
- database password/connection string:

OpenAI:
- API key:
- model:
- base URL:

Doubao:
- API key:
- model:
- base URL:

Sentry:
- DSN:
- 项目:

客户演示账号:
- 邮箱:
- 密码:
- 项目 URL:

域名:
- 注册商:
- 账号:
- 域名:
```

## 7. 当前已验证状态

详见：

- `docs/delivery-status.md`

当前关键验证包括：

- `npm run build` 通过。
- `npm run smoke:prod-health` 通过。
- `npm run smoke:prod-auth-project` 通过。
- `npm run smoke:prod-cloud-restore` 通过。
- `npm run smoke:prod-stage3-generation-e2e` 通过。
- `npm run smoke:prod-stage3-research-e2e` 通过。
- `npm run smoke:prod-research-kano` 通过。
- `npm run smoke:prod-citation-enhance` 通过。

## 8. 当前剩余风险

### 8.1 必须运营确认

- 是否高峰期开 Supabase Pro。
- 是否购买独立域名。
- 是否配置 Sentry DSN。
- 是否准备固定客户演示账号。
- 是否用客户真实 Excel 做一次完整验收。

### 8.2 技术风险

- 长任务仍不是完整后端任务队列。
- 引用质量需要人工抽查。
- Word-like 编辑器不是完整 Word 排版引擎。
- 研究计算结果对客户 Excel 字段结构仍需适配。
- 免费 Supabase 淡季可能暂停。

### 8.3 数据风险

- 免费数据库容量、备份和不活跃暂停限制。
- 文件资产增长后需要规划 Storage/OSS。
- API key 和 service role key 必须严格保密。
- 需要定期导出/备份关键客户项目。

## 9. 推荐近期交付动作

1. 配置 Sentry。
2. 准备固定客户演示账号。
3. 购买或确认域名策略。
4. 高峰期前开 Supabase Pro。
5. 用真实客户 Excel 跑一次研究计算。
6. 导出 Word 并人工检查。
7. 把真实账号和 key 存入密码管理器，不进 Git。

## 10. 维护联系人和交接建议

建议明确：

- 产品负责人。
- 工程负责人。
- Supabase 管理员。
- Vercel 管理员。
- AI key 管理人。
- 客户演示账号管理人。

交接时应同时提供：

- 本文档。
- `docs/customer-demo-runbook.md`。
- `docs/delivery-status.md`。
- 密码管理器中的真实账号和密钥。
