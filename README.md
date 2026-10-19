# MCS_BIEP 论文库

论文与阅读笔记管理网站，支持 GitHub 登录、文件导入、图文编辑、协作笔记和审核发布。仓库只保存笔记、笔记图片和论文下载链接，不保存论文 PDF 文件。

## 使用

- 公开阅读无需登录；组员通过维护者的邀请链接，使用 GitHub 登录后自动加入，无需仓库协作者权限。
- 同一论文可保留多人的独立笔记，可按作者切换阅读。
- 主页与上传页均可新建研究方向，上传时可多选已有方向；这些操作无需调用模型。
- 右键「研究方向」新建；右键具体方向重命名或删除。删除只取消分类，所有笔记仍在「全部文献」中。重命名同步 GitHub 目录。
- 右键作者对应的笔记可删除本人上传的笔记，其他作者的笔记保留；网站和接口均校验上传者身份。
- 将论文卡片或单份笔记拖到左侧方向即可移动，也可使用「移动」按钮。选择具体方向时移动会保留其他分类；在「全部文献」中移动会改为目标方向。
- 支持 DOCX、文字型 PDF、Markdown、TXT 和 ZIP 笔记包；正文可编辑图片和表格。
- 笔记提交后在「我的提交」查看审核结果，通过后公开归档。
- 退回时红色列出修改原因，修改页定位问题字段或原句。
- 缺少 PDF 下载链接时，确认提交后在后台自动检索补充链接；优先使用公开接口，搜索仅作兜底。只补充地址，不下载或归档 PDF 文件；无法可靠匹配时反馈原因。
- 详细操作见网站「使用指南」。
- 维护者在网站「组员管理」生成或复制邀请链接、停用链接、移除或恢复成员。链接默认7天有效，最多加入50人；到期不影响已加入成员。
- 邀请组员、备份、故障处理和容量限制见 [维护说明](MAINTENANCE.md)。

## 本地运行

需要 Node.js 24 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

启动接口服务前，将 `.dev.vars.example` 复制为 `.dev.vars` 并填写配置，然后运行 `pnpm worker:dev`。没有配置远端仓库时，可使用本地体验模式。

## 部署

在服务端配置 `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_CLIENT_ID`，并将 `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`DEEPSEEK_API_KEY`、`GITHUB_APP_PRIVATE_KEY` 保存为 Secret。GitHub App 仅安装到目标仓库，授予 Contents 读写和 Metadata 读取权限；登录回调为网站域名下的 `/api/auth/callback`。`SESSION_SECRET` 至少使用32个随机字符。应用私钥使用 GitHub 下载的完整 PEM 内容，仅保存在服务端。

后台使用仅针对目标仓库的短期安装令牌保存内容，用户 GitHub 账号只用于身份与署名。成员名单和邀请凭据保存在私有的 `MemberRegistry` Durable Object，不进入公开 GitHub 仓库。维护者是 `GITHUB_OWNER` 对应的 GitHub 账号；成员权限每次写入重新核验，移除成员不会删除其笔记。

```sh
pnpm test
pnpm audit --audit-level high
pnpm build
pnpm exec wrangler deploy
```

部署环境中的配置通过 `keep_vars` 保留，凭据和个人部署地址不写入源码。

笔记原始数据保存在 `data/notes/<笔记ID>.json`，总目录为 `data/library.json`，研究方向为 `data/directions.json`。GitHub 阅读版按方向分别保存在 `papers/方向-<方向名称>/<笔记ID>.md`，每个方向有独立 README。多选方向生成多份阅读版，共用同一份笔记数据与附件；未分类笔记放在 `papers/_未分类/`。方向名称中的斜线等路径字符自动转义。

发布、移动和修改昵称会在一次 Git 提交中同步数据、目录及阅读版，并清理已移出的旧阅读版。笔记图片保存在 `assets/uploads/`，移动时无需复制。PDF 只记录在笔记的 `pdfUrl` 字段；本地选择 PDF 仅用于文字提取、预览和选页插图，原文件不会发送到服务器。组员有仓库写权限即可整理任意笔记的分类，正文修改仍只限本人。请通过网站维护这些内容。

源码变更会运行单元测试、真实 SQLite 队列测试及浏览器工作流；正式数据变更会单独检查索引、阅读版和附件完整性。测试论文只放在 `tests/fixtures/`，不随网站展示。
