# 初版组件边界

- GuideView：渲染独立使用指南，通过主导航访问，不进入文献索引或论文统计；正文来自 docs/使用指南.md。

- App：组合应用壳、页面和全局通知，使用 useWorkspace 管理数据流。
- AppHeader：显示导航、仓库连接与账号状态；通过事件请求导航、登录和退出。
- LibraryView：接收笔记索引，派生搜索、标签和排序；触发打开与新增事件。
- LibraryToolbar：通过 query、sort、layout 的 v-model 接收筛选与显示状态，触发刷新事件。
- PaperCard：接收 PaperGroup，显示一篇论文和各人的独立笔记入口，触发 open(id)。
- NoteOptions：接收 notes/currentId，在文献列表和阅读页显示作者、GitHub 原账号及各份笔记，触发 open(id)。
- ProfileDialog：接收 user/save，负责可清空的昵称表单、保存状态与错误反馈，触发 close。
- 文献库默认采用紧凑列表，PaperCard 同时承担列表与卡片条目的纯展示，不持有筛选状态。
- ImportWorkspace：使用 useImporter，处理选文件、解析和草稿；接收会话配置，触发发布和保存事件。
- TemplateEditor：通过 defineModel 接收可编辑草稿，组合论文信息与完整正文编辑，保留原章节。
- NotePreview：接收笔记与资源解析函数，渲染经消毒的 Markdown。
- PaperReader：接收 note/notes/user，展示当前笔记和同论文的其他笔记，仅允许编辑本人的已发布笔记，触发 back/edit/open/contribute。
- SetupDialog：说明真实授权所需配置，关闭时触发事件。
- ReviewJobsView：接收当前成员的提交状态、问题与补充来源，通过事件请求刷新、修改、重试或阅读已发布笔记。
- useReviewJobs：在登录后获取本人任务并轮询未完成审核，负责状态刷新和失败恢复。
- ReviewReceipt：展示已发布笔记的自动归类与可溯源资料补充，不修改个人思考。

纯转换逻辑放 services/importer 与 shared/note；浏览器持久化放 services/storage；真实仓库提交与鉴权位于 worker，界面不持有应用密钥。

审核服务边界：worker/app 管理身份与入口；reviewQueue 持久化任务、限额与后台唤醒；review 负责规则、有限检索和 DeepSeek JSON 审核。未经通过的任务不进入 GitHub 文献索引。

- PaperMetadataEditor：维护论文信息，接收 authorLocked 保持已登录署名锁定。
- NoteBodyEditor：通过 v-model 接收完整正文，管理可视化排版、表格、插图与参考模板。
- NoteAssetPanel：显示图片清单，触发插入与移除。
- PdfFigureTool：从独立 PDF 的指定页面生成插图。
- ImageLightbox：显示原尺寸图片，支持键盘关闭。
- shared/document：完整正文与旧版章节兼容、参考模板和 GitHub 路径。
- services/htmlToMarkdown：保留表格结构，安全转换可视化正文。
