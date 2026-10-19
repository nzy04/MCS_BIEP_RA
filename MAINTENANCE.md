# 维护说明

本项目适合课题组公开分享论文笔记。GitHub 只保存笔记、笔记图片和论文 PDF 下载链接，不保存 PDF 原文件；Cloudflare 保存网站、授权接口和短期审核任务。免费托管不等于无限容量或永久可用保证。

## 邀请组员

1. 仓库维护者进入 GitHub 仓库 → Settings → Collaborators → Add people。
2. 输入组员的 GitHub 用户名，发送邀请；组员需要接受邀请。
3. 组员打开网站，点击 GitHub 登录并授权现有登录应用，即可新建方向和提交笔记。无需注册 Cloudflare，也不需要填写 API Key。
4. 如果接受邀请后仍显示没有写权限，退出网站并重新登录，以更新权限。

公开阅读不需要邀请。个人仓库的 collaborator 拥有仓库写权限，能够直接通过 GitHub 改代码和他人文件；网站中的“仅能编辑自己的正文”不是 GitHub 层面的隔离。只邀请可信组员。未来如需严格区分代码维护者和笔记贡献者，需要把内容仓库与代码仓库分开并调整授权流程。

官方步骤：[邀请协作者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)。

## 当前范围和限制

| 项目       | 当前行为                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文件导入   | DOCX、文字型 PDF、Markdown、TXT、ZIP；单文件最多 15 MB，PDF 最多 100 页；Word 展开后最多 30 MB                                                               |
| 内容保真   | DOCX 图片、普通表格和合并表格可导入；PDF 排版、公式和分栏需要人工核对。扫描件作为笔记导入时需先 OCR；本地参考 PDF 可用于预览和选页插图，原文件不会上传       |
| 发布图片   | 单张图 2 MB，最多 25 张，合计 6 MB；后端拒绝 PDF 附件，只保存 PDF 下载链接                                                                                   |
| PDF 链接   | 优先填写官方稳定链接；留空时在确认发布后后台检索补充，只查找地址，不下载原文件。外部链接可能失效或受访问权限限制，需定期人工核对                             |
| 正文整理   | 最多 40,000 字符，只在确认发布时执行。无最低字数或必填栏目；模型的内容意见仅作可选建议。仅缺少标题/实际内容/可定位来源或超过容量时要求修改；不代写观点和数据 |
| 公式       | 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 和 math 代码块；编辑及导出保留 TeX 源码。Word/PDF 中未识别出的公式需在 Markdown 中手动核对，不自动推断原式     |
| 审核额度   | 不设个人或全组每日提交/重试次数上限；保留重复提交去重和发布重试复用，实际费用及限流取决于模型与检索接口                                                      |
| 队列       | 串行处理，关网页后继续；失败需查看原因再重试，遇到不确定的模型调用中断不自动再次计费                                                                         |
| 草稿与任务 | 服务器审核草稿保留 24 小时，任务记录保留 7 天；已发布笔记长期保存在 GitHub。浏览器草稿不是备份，换设备或清理浏览器可能丢失                                   |
| 研究方向   | 最多 500 个目录，每份笔记最多 8 个方向；一次移动最多 30 份笔记；重命名或删除每次最多同步 250 份笔记、更新数据不超过 8 MB。删除只移除分类，保留笔记和图片     |
| 大目录     | 支持超过 GitHub 1 MB 内联限制的 raw JSON；写入时单份仓库 JSON 限 8 MB。首页仍加载完整索引，增长后需要分页或数据库                                            |

GitHub 常规 Git 文件超过 100 MiB 会被拒绝；官方建议仓库理想小于 1 GB，并强烈建议小于 5 GB。这不是无限网盘。删除当前文件不会消除历史版本体积。[GitHub 大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。

Cloudflare Workers 免费计划当前为每天 100,000 请求、每次 10 ms CPU、128 MB 内存、50 个外部子请求。SQLite Durable Objects 还有单独的请求、执行时长、读写和存储额度。大附件、多次并发冲突或批量历史更新可能触及这些限制；本地通过不代表已经验证线上免费 CPU 上限。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects 额度](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

只保存笔记和链接能显著减少仓库增长，容量主要取决于图片数量、大小和修改历史。建议在完整 Git 仓库约 500 MB、索引约 2 MB、明显出现加载变慢或频繁提交冲突时安排扩容评估。这是本项目的维护建议，不是平台硬限制。图片增长较多时可压缩或迁移图片存储；大量检索和并发编辑应迁移到分页索引/数据库。

## 日常维护

- 代码更新检查 GitHub Actions 和 Cloudflare 构建均成功；内容更新检查 Repository data integrity。自动检查失败时先保留原文件和提交记录，避免连续覆盖。
- Cloudflare 构建应排除 `data/**`、`papers/**`、`assets/uploads/**`，避免每次笔记更新重建网站。正式内容通过 API 从 GitHub 读取，不需要重新部署。免费构建当前有每月 3,000 分钟额度。[构建限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)。
- 查看 Cloudflare Metrics 中的错误与 CPU；GitHub 限流、模型余额不足和网络故障会暂时影响提交。出现 401 重新登录；429 等待额度恢复；409 先保留草稿、刷新比较版本再修改；502/504 先确认仓库是否已保存，再重试。
- 每月检查依赖安全公告。当前 PDF、Tiptap、ZIP 已更新至修复版本；`mammoth → argparse → sprintf-js` 仍有一个未修复的中风险命令行依赖公告。网站仅导入 `mammoth.browser`，该命令行依赖未进入网页产物，CI 阻止新增高危/严重漏洞；仍需关注上游修复。[上游公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。
- GitHub 和 Cloudflare 账号应有恢复方式，并指定交接维护者。正式内容公开，不要上传保密或未经允许公开的材料。

自动检查在代码或内容变更时执行，未启用全天在线探测和自动故障通知。服务商或网络在无代码变更时发生故障，仍需维护者查看状态和运行指标。

## 备份与恢复

建议定期将完整仓库镜像保存到另一台设备或学校存储。首次备份可运行 `git clone --mirror <仓库HTTPS地址> <备份目录>`，之后在该备份目录运行 `git remote update --prune`；保留独立历史快照，避免误操作同时同步到唯一备份。

Git 镜像包含代码、笔记、阅读版、附件和提交历史，不包含 Cloudflare Secret、GitHub App 私密配置以及未发布的临时审核草稿。这些配置由维护者独立保管，不提交到仓库、不发给组员。

数据出错时，从 GitHub 历史找回对应 `data/notes/`、`data/library.json`、`papers/` 和附件，放在同一次恢复提交中；先运行 `node scripts/check-repository.mjs`，再提交。不要仅恢复 Markdown 而漏掉网站 JSON。

更新应用密钥后重新登录；更换 `SESSION_SECRET` 会使旧登录和待审核草稿的加密失效，应先处理完待审核任务，再更换，并让成员重新登录。代码回滚不需要删除审核 Durable Object；重新部署时保留既有绑定、迁移和 Secret。

## 重跑检查

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm audit --audit-level high
pnpm build
pnpm exec wrangler deploy --dry-run --outdir test-results/review-bundle
node tests/review_runtime.mjs
node tests/workflow_runtime.mjs
node scripts/check-repository.mjs
```

浏览器验收安装 `tests/requirements.txt` 和 Playwright Chromium，启动 Vite 预览服务器后运行 `python tests/run_browser.py`。Linux 设置 `TEST_BROWSER_CHANNEL` 为空，Windows 默认使用 Edge。测试报告和截图写入忽略目录 `test-results/`；测试会替换外部 API，不会向正式仓库写入或消耗模型额度。

这些检查能发现回归、权限、事务和恢复问题；短时间受控测试不能证明数月无故障，也不能取代真实账号验收、备份和运行指标检查。
