# 初版组件边界

- App：组合应用壳、页面和全局通知，使用 useWorkspace 管理数据流。
- AppHeader：显示导航、仓库连接与账号状态；通过事件请求导航、登录和退出。
- LibraryView：接收笔记索引，派生搜索、标签和排序；触发打开与新增事件。
- PaperCard：显示单条笔记信息，触发打开事件。
- ImportWorkspace：使用 useImporter，处理选文件、解析和草稿；接收会话配置，触发发布和保存事件。
- TemplateEditor：通过 defineModel 接收可编辑草稿，只负责字段与章节编辑。
- NotePreview：接收笔记与资源解析函数，渲染经消毒的 Markdown。
- PaperReader：展示笔记详情，触发返回和编辑事件。
- SetupDialog：说明真实授权所需配置，关闭时触发事件。

纯转换逻辑放 services/importer 与 shared/note；浏览器持久化放 services/storage；真实仓库提交与鉴权位于 worker，界面不持有应用密钥。
