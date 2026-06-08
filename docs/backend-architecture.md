# 后端迁移方案

## 目标

当前前端 Demo 使用 localStorage 和浏览器直连 AI API。完整版需要把用户、库资料、项目、章节、版本历史和 AI 调用迁移到后端，解决 API Key 暴露、多用户隔离、文件解析和长期检索问题。

## 推荐技术栈

- API：FastAPI。适合文件解析、异步任务、AI 管线和后续向量检索。
- 数据库：PostgreSQL，推荐 Supabase 或 Neon。
- 文件存储：Cloudflare R2、S3 或阿里云 OSS。
- 队列：Redis + RQ/Celery，用于 PDF/Word 解析、摘要生成、向量索引。
- AI 服务：后端统一调用 OpenAI/豆包，前端只拿流式响应。

## 核心数据表

- `users`：用户账户、邮箱、创建时间。
- `library_items`：资料标题、类型、文件 URL、提取文本、摘要、标签、索引状态、用户 ID。
- `projects`：项目标题、说明、当前阶段、项目上下文、用户 ID。
- `project_library_items`：项目与库资料的绑定关系。
- `project_threads`：项目内阶段对话记录。
- `doc_sections`：章节标题、正文、顺序、状态、项目 ID、来源引用。
- `version_snapshots`：版本描述、章节快照、项目 ID。
- `reference_selections`：每次 AI 请求引用的库资料、项目章节和选项。

## API 草案

### 资料库

- `POST /library/upload`：上传 PDF/Word/txt，返回资料记录。
- `GET /library`：获取用户资料列表，支持关键词和标签过滤。
- `GET /library/{id}`：获取资料详情和提取文本。
- `PATCH /library/{id}`：更新标题、标签、摘要。
- `DELETE /library/{id}`：删除资料和索引。

### 项目

- `POST /projects`：新建项目。
- `GET /projects`：项目列表。
- `GET /projects/{id}`：项目首页数据。
- `PATCH /projects/{id}`：更新项目标题、说明、上下文、阶段。
- `POST /projects/{id}/library/{libraryItemId}`：绑定资料。
- `DELETE /projects/{id}/library/{libraryItemId}`：解绑资料。

### 文档与版本

- `GET /projects/{id}/sections`：获取章节。
- `POST /projects/{id}/sections`：新增章节。
- `PATCH /sections/{id}`：更新章节标题、正文、状态。
- `GET /projects/{id}/versions`：版本历史。
- `POST /projects/{id}/versions`：创建快照。
- `POST /versions/{id}/restore`：恢复快照。

### AI

- `POST /ai/stage1/chat`：材料理解对话，后端组装项目上下文和引用资料。
- `POST /ai/stage2/write`：按章节标题生成正文。
- `POST /ai/stage2/revise`：按意见修改当前章节。
- `POST /ai/selection/rewrite`：框选改写、缩短、扩写、学术化。
- `POST /ai/stage3/review`：全文润色、结构检查、引用一致性检查。

所有 AI 接口默认返回 Server-Sent Events，前端沿用当前流式 UI。

## 文件解析流程

1. 用户上传文件到后端。
2. 后端把原文件存入对象存储。
3. 创建 `library_items` 记录，状态为 `pending`。
4. 异步任务提取正文，生成摘要和标签。
5. 写回 `library_items.text`、`summary`、`tags`，状态改为 `ready`。
6. 后续加入向量检索时，为文本分块并写入向量库。

## AI 上下文组装

前端当前的 `src/lib/context.ts` 可迁移为后端 `ContextBuilder`：

- 加载项目上下文。
- 加载项目绑定资料。
- 加载本次引用选择。
- 加载当前章节或全文。
- 按 token 预算截断资料。
- 输出结构化 prompt 给模型。

## 安全要求

- API Key 只保存在后端环境变量。
- 前端不再包含 `VITE_OPENAI_API_KEY`、`VITE_DOUBAO_API_KEY`。
- 所有数据表按 `user_id` 隔离。
- 文件下载 URL 使用短期签名。
- AI 请求记录模型、耗时、token 和引用来源，便于审计与调试。

## 迁移顺序

1. 先保留当前前端 UI，新增后端项目和数据库 schema。
2. 把资料库上传迁移到后端。
3. 把项目、章节、版本历史迁移到后端。
4. 把 AI 调用迁移到后端流式接口。
5. 加入登录和多用户隔离。
6. 加入文件解析队列和检索索引。
7. 前端删除直连 AI 的 Key 配置。
