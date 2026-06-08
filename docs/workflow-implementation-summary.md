# 论文助手完整工具流实现总结

## 当前完成状态

本项目已从最初的线性 Demo 页面，升级为一个更完整的“库 + 项目 + 阶段工作流”结构。

核心产品逻辑已经变为：

- `库`：用户长期上传、保存、搜索和复用资料。
- `项目`：类似 Claude Project，用来承载某一篇论文或一个研究任务。
- `阶段一`：材料理解。
- `阶段二`：章节生成、正文修改、版本历史。
- `阶段三`：全文检查、润色与导出前准备。
- `引用面板`：阶段一、二、三都可以随时引用库资料或项目内容。
- `AI 上下文组装`：所有 AI 调用统一经过项目上下文、资料引用、章节内容的组装。

---

## 已实现页面

### 1. 资料库页面

文件：`src/pages/Library.tsx`

已实现：

- 上传资料入口。
- 粘贴文本资料并存入库。
- 资料列表。
- 资料搜索。
- 资料预览。
- 删除资料。
- 将资料绑定到当前项目。

当前 Demo 中，`.txt` 文件可以读取正文；PDF/Word 文件先保存文件名和占位文本。完整版后端会负责真实解析 PDF/Word。

---

### 2. 项目列表页面

文件：`src/pages/Projects.tsx`

已实现：

- 项目列表。
- 新建项目。
- 项目卡片。
- 进入项目首页。
- 显示章节完成进度。

项目的定位类似 Claude Project：每个项目都有自己的论文主题、上下文、绑定资料、阶段状态和文档内容。

---

### 3. 项目首页

文件：`src/pages/ProjectHome.tsx`

已实现：

- 项目标题和说明展示。
- 项目信息编辑。
- 三阶段入口：
  - 阶段一：材料理解。
  - 阶段二：框架生成。
  - 阶段三：文稿撰写。
- 项目绑定资料列表。
- 绑定或解绑库资料。
- 最近章节预览。

---

### 4. 阶段一：材料理解

文件：`src/pages/Stage1.tsx`

已实现：

- 项目内独立对话。
- AI 欢迎语。
- 用户输入论文题目、背景、研究框架。
- 上传文件入口。
- GPT 流式回复。
- 检测 `【理解完成】` 后显示进入阶段二按钮。
- 将理解结果同步到项目上下文。
- 支持打开引用面板，引用库资料或项目内容。

---

### 5. 阶段二：框架生成与正文修改

文件：`src/pages/Stage2.tsx`

已实现：

- 左侧对话面板。
- 写新内容 / 按意见修改两种模式。
- 右侧文档编辑区。
- 章节新增。
- GPT 生成章节内容。
- 豆包按意见修改章节。
- 内容自动保存到项目。
- 版本历史入口。
- 复制全文。
- 支持打开引用面板。
- AI 请求会带入项目上下文和引用资料。

---

### 6. 阶段三：文稿润色与导出前检查

文件：`src/pages/Stage3.tsx`

已实现：

- 全文预览。
- 章节统计。
- 字数统计。
- 全文检查入口。
- 复制全文。
- 导出 Word 占位按钮。
- 引用上下文预览。
- 支持打开引用面板。

当前阶段三是 Demo 版结构检查。完整版会接入后端 AI，做全文润色、结构检查、引用一致性检查和导出格式检查。

---

## 已实现组件

### 1. 侧栏

文件：`src/components/Sidebar.tsx`

已实现：

- Logo 和 Demo 标识。
- 新对话入口。
- `库` 入口。
- `项目` 入口。
- 应用 / 更多占位入口。
- 最近项目列表。
- 用户信息区域。

侧栏已经在阶段一、阶段二、阶段三、库和项目页面中复用。

---

### 2. 引用面板

文件：`src/components/ReferencePanel.tsx`

已实现：

- 在任意阶段打开引用面板。
- 搜索库资料。
- 勾选库资料。
- 勾选项目章节。
- 选择是否包含项目理解模型。
- 选择是否包含最近对话摘要。
- 保存每个项目、每个阶段的引用选择。

引用面板是后续 AI 上下文系统的核心入口。

---

### 3. 文档编辑区

文件：`src/components/DocArea.tsx`

已实现：

- 章节渲染。
- `contenteditable` 正文编辑。
- AI 流式内容同步。
- 手动编辑 debounce 保存。
- Blur 时生成版本快照。
- 框选工具栏入口。
- 生成中动画。

---

### 4. 框选工具栏

文件：`src/components/SelectionToolbar.tsx`

已实现：

- 选中文字后浮出工具栏。
- AI 改写。
- 缩短。
- 扩写。
- 学术化。
- 调用豆包 API。
- 替换选中内容。
- 替换完成提示。

---

### 5. 版本历史面板

文件：`src/components/VersionPanel.tsx`

已实现：

- 版本列表。
- 当前版本标记。
- 版本预览。
- 恢复旧版本。
- 空状态。
- 右侧滑入动画。

---

## 数据模型与本地存储

文件：`src/lib/storage.ts`

已新增或扩展：

- `LibraryItem`：库资料。
- `Project`：项目。
- `ProjectContext`：项目理解模型。
- `ProjectThread`：项目阶段对话。
- `ReferenceSelection`：引用选择。
- `WorkflowStage`：阶段类型。
- `DocSection` 扩展：
  - `projectId`
  - `order`
  - `sourceRefs`
- `VersionSnapshot` 扩展：
  - `projectId`

已新增 store：

- `libraryStore`
- `projectStore`
- `referenceStore`

已扩展 store：

- `chatStore.getByProject()`
- `chatStore.saveForProject()`
- `sectionStore.getByProject()`
- `sectionStore.saveForProject()`
- `versionStore.getByProject()`

---

## AI 上下文系统

文件：`src/lib/context.ts`

已实现 `buildAIContext()`。

它会统一组装：

- 当前项目标题和说明。
- 项目理解模型。
- 写作要求。
- 禁用表达。
- 项目绑定的库资料。
- 用户在引用面板中手动选择的库资料。
- 用户在引用面板中选择的项目章节。
- 当前章节。
- 最近对话摘要。
- 用户本次输入。

这个函数已经接入：

- 阶段一材料理解。
- 阶段二写新内容。
- 阶段二按意见修改。
- 阶段三全文检查上下文预览。

---

## 路由结构

文件：`src/App.tsx`

当前路由包括：

```text
/library
/projects
/projects/:projectId
/projects/:projectId/stage1
/projects/:projectId/stage2
/projects/:projectId/stage3
/stage1
/stage2
/stage3
```

其中 `/stage1`、`/stage2`、`/stage3` 继续保留兼容入口。

---

## 字体与视觉

文件：`src/index.css`

已改为苹果系统字体栈：

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
--font-serif: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
```

整体视觉已向参考图靠近：

- 左侧栏。
- 深绿色主色。
- 米白背景。
- 轻量边框。
- 类 Apple / Claude 风格布局。

---

## 后端迁移方案

文件：`docs/backend-architecture.md`

已规划：

- FastAPI 后端。
- PostgreSQL 数据库。
- S3 / R2 / OSS 文件存储。
- PDF / Word / txt 文件解析。
- 服务端 AI 调用。
- 多用户隔离。
- 后端版上下文组装。
- 版本历史和资料库 API。

后端迁移后，前端不再暴露 API Key。

---

## 已验证内容

已运行：

```bash
npm run build
```

结果：构建成功。

已验证路由：

```text
/library = 200
/projects = 200
/projects/default-project = 200
/projects/default-project/stage1 = 200
/projects/default-project/stage2 = 200
/projects/default-project/stage3 = 200
```

---

## 当前仍是 Demo 的部分

以下功能目前是前端 Demo 版，后续需要后端支持：

- PDF / Word 正文解析。
- 多用户登录。
- 服务端保存项目和资料。
- 服务端 AI 调用。
- 向量检索。
- Word 导出。
- 阶段三真实 AI 全文润色。
- 文件长期存储。
- 权限和团队协作。

---

## 下一步建议

1. 先继续完善前端视觉，让库、项目、阶段页面更贴近参考图。
2. 再把资料库上传改为真实文件解析。
3. 然后迁移 AI API 到后端，移除前端 API Key。
4. 最后接入数据库、多用户和部署。
