# 新项目方案：`/home/cx/development/ClangdHelper`

## Summary
在 `development` 同级新建独立 VS Code 扩展项目 `/home/cx/development/ClangdHelper`，使用 `TypeScript + pnpm` 实现，当前这份规划同时作为新项目内的落盘文档。

计划中的首个文档文件固定为：
- `/home/cx/development/ClangdHelper/docs/implementation-plan.md`

扩展定位固定为：
- 桌面版 VS Code 扩展
- 仓库名与显示名基于 `ClangdHelper`
- 面向 qmake 项目，负责生成 `compile_commands.json`、更新 clangd 配置、重启 clangd
- 兼顾团队内部使用与后续公开发布

## Implementation Changes
### 项目初始化
新项目目录结构按这个最小形态建立：
- `/home/cx/development/ClangdHelper/package.json`
- `/home/cx/development/ClangdHelper/tsconfig.json`
- `/home/cx/development/ClangdHelper/src/extension.ts`
- `/home/cx/development/ClangdHelper/src/config.ts`
- `/home/cx/development/ClangdHelper/src/commands/syncProject.ts`
- `/home/cx/development/ClangdHelper/src/services/toolRunner.ts`
- `/home/cx/development/ClangdHelper/src/services/clangdIntegration.ts`
- `/home/cx/development/ClangdHelper/src/services/projectDiscovery.ts`
- `/home/cx/development/ClangdHelper/docs/implementation-plan.md`

技术基线固定为：
- `pnpm`
- `typescript`
- `@types/vscode`
- `@vscode/test-electron`
- 构建产物输出到 `dist/`
- 命令入口统一从 `extension.ts` 注册

### 扩展标识与公开接口
`package.json` 中固定这些对外标识：
- `name`: `clangdhelper`
- `displayName`: `ClangdHelper`
- `main`: `./dist/extension.js`
- `engines.vscode`: 选择当前稳定版可接受范围
- `activationEvents`: 基于命令激活

命令固定为：
- `clangdHelper.syncProject`
- `clangdHelper.generateCompilationDatabase`
- `clangdHelper.restartClangd`

配置项固定为：
- `clangdHelper.projectFile`
- `clangdHelper.buildDirectory`
- `clangdHelper.compilationDatabaseDirectory`
- `clangdHelper.qmakePath`
- `clangdHelper.qmakeArgs`
- `clangdHelper.makePath`
- `clangdHelper.makeArgs`
- `clangdHelper.envBootstrap`
- `clangdHelper.compiledbStrategy`
- `clangdHelper.compiledbPath`
- `clangdHelper.updateClangdArguments`
- `clangdHelper.restartClangdAfterSync`

### 核心行为
`syncProject` 的执行顺序固定为：
1. 定位工作区与 `.pro` 文件
2. 解析并创建 `buildDirectory`
3. 按配置解析 `compiledb`
4. 执行 `qmake`
5. 执行 `compiledb -o <dir>/compile_commands.json make ...`
6. 更新 development 级别 `clangd.arguments`
7. 调用 `vscode.commands.executeCommand('clangd.restart')`

clangd 配置更新规则固定为：
- 只改 development 配置，不改 user settings
- 读取现有 `clangd.arguments`
- 移除所有旧的 `--compile-commands-dir=...`
- 追加新的 `--compile-commands-dir=<compilationDatabaseDirectory>`
- 保留其他已有参数顺序

`compiledb` 解析顺序固定为：
1. `clangdHelper.compiledbPath`
2. PATH 中的系统 `compiledb`
3. 内置 helper
4. 全部失败则给出明确诊断信息

环境加载规则固定为：
- 若配置了 `envBootstrap`，统一用 `bash -lc` 在同一 shell 内先加载环境再执行 `qmake` 和 `compiledb`
- 未配置时直接用进程执行
- v1 以本地桌面扩展宿主为前提，不支持 web extension

### 文档落盘
`/home/cx/development/ClangdHelper/docs/implementation-plan.md` 中写入的内容就是这份实现计划的精简版，包含：
- 目标
- 命令与配置项
- 执行流程
- 失败场景
- 测试标准

`README.md` 之后单独承担用户文档，不与实现计划混写。

## Test Plan
必须覆盖这些场景：

- 单个 `.pro` 文件时可直接生成 `compile_commands.json`
- 多个 `.pro` 文件时可交互选择，且配置后下次不再询问
- 自定义 `compilationDatabaseDirectory` 时，clangd 能正确读取
- 连续多次执行同步，不会重复写入多个 `--compile-commands-dir`
- 配置 `envBootstrap` 后，需先 `source` 环境的 qmake 项目可以成功执行
- `compiledb` 缺失时，`auto/system/bundled` 三种路径的报错清晰可区分
- clangd 扩展未安装时，生成数据库成功，但重启步骤仅提示警告
- `qmake` 或 `make` 失败时，中止后续步骤并把日志写入 Output Channel
- 多根工作区场景下，只更新当前目标工作区配置
- Linux、macOS、Windows 的路径与进程调用分支正确

## Assumptions
- 新项目目录固定为 `/home/cx/development/ClangdHelper`
- 仓库名使用你给定的 `ClangdHelper`，npm 包名与扩展内部 `name` 使用小写 `clangdhelper`
- 计划文档文件固定为 `/home/cx/development/ClangdHelper/docs/implementation-plan.md`
- 公开发布所需 `publisher` 暂不在本轮定死，创建项目时先使用占位值，发布前替换
- v1 优先做稳健的“系统依赖优先 + 内置兜底”方案，不先做复杂 UI，只提供命令、配置和日志输出
