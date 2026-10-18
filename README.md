# MCS_BIEP · 论文与阅读笔记

课题组共同维护的论文知识库。成员在网站导入 PDF、Word 或 Markdown，确认并编辑统一模板，再提交到 GitHub 仓库。

在线地址：[MCS_BIEP 论文库](https://mcs-biep-ra.zn77710.workers.dev)。网站已部署到 Cloudflare 免费 Workers；GitHub 登录还需要维护者完成密钥设置。

## 当前初版

- 论文卡片、方向标签、标题/标签/作者/摘要搜索、移动端阅读。
- 浏览器内导入 DOCX、文字型 PDF、Markdown 和 TXT。
- 根据已有标题整理模板；未分类内容保留，不自动编写个人观点。
- 原文对照、笔记编辑、DOCX 图片提取、手动插图、Markdown 导出。
- 本机草稿和笔记保存，刷新后仍可读取。
- GitHub App 授权接口、加密会话、仓库权限检查和单次多文件提交。
- 冲突检测与重复提交保护；真实发布成功后返回 GitHub 提交地址。

**真实登录和发布需要完成 GitHub App 与 Cloudflare 配置。** 未配置时，界面明确显示“本地体验版”，保存只发生在当前浏览器，不会模拟上传成功。

## 本地运行

安装 Node.js 24 与 pnpm 11，然后执行：

```bash
pnpm install --frozen-lockfile
pnpm dev --port 5188
```

浏览器打开 `http://127.0.0.1:5188/`。未运行接口时仍可体验本地功能；要运行授权接口，请先构建并在另一终端启动 Worker：

```bash
pnpm build
pnpm worker:dev
```

本地初始的 3 篇笔记明确标为示例，并非课题组已经提交的阅读记录。它们放在 `public/data/`。连接真实仓库后，网站读取仓库根目录 `data/`，不会自动发布示例内容。

## 连接真实仓库

参见 [部署与授权配置](docs/部署与授权配置.md)。目标仓库：`nzy04/MCS_BIEP_RA`。

正式内容采用：

```text
data/library.json                  轻量目录索引
data/notes/note-<uuid>.json         笔记结构化源数据
papers/note-<uuid>.md               同一次提交生成的 Markdown 阅读副本
assets/uploads/note-<uuid>/         已确认发布的插图和可选 PDF
```

结构化 JSON 是编辑源数据，Markdown 是随之生成的阅读副本；修改正式笔记应优先通过网站。当前不提供从手改 Markdown 自动回写 JSON 的双向同步。

## 边界与限制

- 扫描 PDF 尚未接入 OCR；老式 `.doc` 需先另存为 `.docx`。
- PDF 首版提取文字，复杂分栏、表格、数学公式需人工确认；PDF 插图需手动补充。
- DOCX 图片支持 PNG、JPEG、WebP、GIF；部分 Office 特有图片格式需转换。
- 导入文件上限 15 MB、PDF 上限 100 页；发布时单张图片上限 2 MB，可选原文 PDF 上限 4 MB，附件总量上限 6 MB。
- 本机草稿不能跨设备自动同步；清除浏览器数据会移除本机保存内容，请及时导出或正式发布。
- 公开仓库中的正式内容公开可见。原始笔记文件默认在浏览器转换，只有确认后的内容进入仓库。
- 首版不调用大模型，不产生模型 API 费用。智能归纳与 OCR 可后续接入。
- Worker 免费额度与实际 CPU 用量仍需部署实测；不承诺任意文件和任意流量均可免费处理。

## 验证

```bash
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run
```

Python 浏览器验收脚本为 `tests/browser_smoke.py`，使用 Playwright、python-docx 和 reportlab 生成测试文件，验证实际导入、编辑、本机保存和手机布局。测试产物不入库。

GitHub 登录回调与真实仓库提交仍需在完成部署配置后端到端验收。接口单元测试使用模拟 GitHub 响应，不代表已经完成真实账号发布。
