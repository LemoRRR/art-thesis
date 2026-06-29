# 客户演示 Runbook

更新时间：2026-06-29

## 目标

这份 Runbook 用来保证客户演示不是临场撞运气，而是可重复、可恢复、可检查的流程。

正式演示建议只使用固定演示账号和预置演示项目。不要在客户面前从空项目开始等待完整 AI 生成，除非目的是专门展示生成过程。

## 演示前 30 分钟

1. 确认正式站点可访问：
   - https://paper-ai-tool.vercel.app

2. 先看生产健康检查：

```bash
npm run smoke:prod-health
```

它会确认 `/api/health` 可访问，并检查 Supabase 与 AI provider 是否已配置。输出只包含布尔状态和部署版本，不包含密钥。

3. 运行快速生产验收：

```bash
npm run check:prod-delivery -- --skip-seed
```

4. 如果要重新刷新演示项目，使用固定账号运行：

```bash
# PowerShell 示例
$env:PROD_DEMO_EMAIL="demo@example.com"
$env:PROD_DEMO_PASSWORD="replace-with-real-password"
$env:PROD_DEMO_PROJECT_ID="customer-demo-main"
npm run seed:prod-demo
```

不要把真实邮箱和密码写入仓库。演示账号密码只放在本机临时环境变量、密码管理器或 Vercel/运维记录中。

5. 人工打开一次演示项目：
   - 登录固定演示账号。
   - 打开 seed 命令输出的 Stage3 项目链接。
   - 确认页面能看到论文标题、正文、导出按钮。
   - 打开“研究计算”，确认能看到研究资产或可进入上传数据流程。

6. 导出一次 Word：
   - 在 Stage3 点击导出 Word。
   - 本地打开 docx。
   - 检查标题、正文、脚注/参考文献、图题、表题是否可读。

## 推荐演示路径

### 1. 登录和项目

- 使用固定演示账号登录。
- 进入预置项目。
- 说明系统围绕论文工作流组织：题目/资料 → 大纲 → 正文 → 研究计算 → Word 导出。

### 2. 大纲和正文

- 展示已有大纲和正文。
- 展示 Stage3 编辑器可以继续改正文。
- 展示“生成全文”按钮和进度条，但客户正式演示时不建议等待完整重新生成。

### 3. 引用和脚注

- 展示正文中的引用编号。
- 说明编辑器中是连续编辑体验，脚注/引用数据用于导出 Word。
- 如果客户追问分页，说明当前是 Word-like 视觉层，不是完整 Word 排版引擎；最终 docx 会交给 Word/WPS 接管真实分页。

### 4. 研究计算

- 从项目或 Stage3 进入研究计算。
- 展示上传数据后形成数据集卡片。
- 展示分析结果中的表格、图片和论文表述。
- 展示一键插入论文对应章节。

### 5. Word 导出

- 导出 Word。
- 打开 docx 展示正文、图表、表题、脚注/参考文献。

## 如果现场出问题

### 登录失败

1. 先刷新页面。
2. 如果仍失败，运行：

```bash
npm run smoke:prod-auth-project
```

3. 如果 smoke 也失败，优先检查 Supabase/Auth 或网络。

### 项目打开为空

1. 不要现场手动补数据。
2. 重新运行固定账号 seed：

```bash
$env:PROD_DEMO_EMAIL="demo@example.com"
$env:PROD_DEMO_PASSWORD="replace-with-real-password"
$env:PROD_DEMO_PROJECT_ID="customer-demo-main"
npm run seed:prod-demo
```

3. 重新打开 seed 输出的项目链接。

### 点击生成全文很久没动

1. 先确认进度条是否出现。
2. 如果没有进度条，刷新页面后重试。
3. 如果仍不动，运行：

```bash
npm run smoke:prod-stage3-generation-e2e
```

4. 客户现场优先切回预置项目，不要等待临时排查。

### 研究计算失败

1. 用已验证样本跑一次：

```bash
npm run smoke:prod-research-kano
```

2. 如果样本通过，说明系统链路可用，问题大概率是客户 Excel 字段结构需要适配。
3. 如果样本失败，先不要演示实时计算，改展示预置研究包和已导出的 Word。

### Word 导出异常

1. 用生产研究 E2E 复查：

```bash
npm run smoke:prod-stage3-research-e2e
```

2. 如果 E2E 通过，现场问题多半是当前项目内容异常；切换到预置演示项目。

## 交付前必须确认

- 固定演示账号已经创建。
- 固定演示项目能打开。
- 演示项目有大纲、正文和研究包。
- Word 可以导出并打开。
- 客户真实 Excel 至少跑过一次，或提前说明现场只展示已验证样本。
- Sentry 环境变量已配置，或明确当前线上错误仍需靠人工反馈排查。

## 常用命令

```bash
npm run build
npm run check:prod-delivery
npm run check:prod-delivery -- --full
npm run smoke:prod-health
npm run seed:prod-demo
npm run smoke:prod-auth-project
npm run smoke:prod-cloud-restore
npm run smoke:prod-stage3-generation-e2e
npm run smoke:prod-stage3-research-e2e
npm run smoke:prod-research-kano
```
