# Paper Commons

论文与阅读笔记管理网站，支持 GitHub 登录、文件导入、图文编辑、协作笔记和审核发布。

## 使用

- 公开阅读无需登录；上传和修改需要仓库写权限。
- 同一论文可保留多人的独立笔记，可按作者切换阅读。
- 支持 DOCX、文字型 PDF、Markdown、TXT 和 ZIP 笔记包；正文可编辑图片和表格。
- 笔记提交后在「我的提交」查看审核结果，通过后公开归档。
- 「按标题收录」检索论文，核对候选后确认，后台获取 PDF 并收录，之后可添加自己的笔记。允许再分发且不超过 4 MB 的 PDF 自动归档，其余保留来源信息。
- 详细操作见网站「使用指南」。

## 本地运行

需要 Node.js 24 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

启动接口服务前，将 `.dev.vars.example` 复制为 `.dev.vars` 并填写配置，然后运行 `pnpm worker:dev`。没有配置远端仓库时，可使用本地体验模式。

## 部署

在服务端配置 `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_CLIENT_ID`，并将 `GITHUB_CLIENT_SECRET`、`SESSION_SECRET`、`DEEPSEEK_API_KEY` 保存为 Secret。GitHub App 需要目标仓库的 Contents 读写权限，登录回调为网站域名下的 `/api/auth/callback`。`SESSION_SECRET` 至少使用 32 个随机字符。

```sh
pnpm test
pnpm build
pnpm exec wrangler deploy
```

部署环境中的配置通过 `keep_vars` 保留，凭据和个人部署地址不写入源码。笔记位于 `data/`，阅读版位于 `papers/`，附件位于 `assets/uploads/`；请通过网站维护这些内容。
