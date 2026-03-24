# ClangdHelper 实现计划

## 目标
- 面向 qmake 项目生成 `compile_commands.json`
- 更新工作区级 `clangd.arguments`
- 在同步后按需重启 clangd

## 命令与配置项
- 命令：`clangdHelper.syncProject`、`clangdHelper.generateCompilationDatabase`、`clangdHelper.restartClangd`
- 配置项：`projectFile`、`buildDirectory`、`compilationDatabaseDirectory`、`qmakePath`、`qmakeArgs`、`makePath`、`makeArgs`、`envBootstrap`、`compiledbStrategy`、`compiledbPath`、`updateClangdArguments`、`restartClangdAfterSync`

## 执行流程
1. 定位工作区和 `.pro` 文件
2. 解析并创建 `buildDirectory`
3. 解析 `compiledb`，优先显式路径；`auto` 模式先尝试系统命令，再尝试自动安装，最后回退内置 helper
4. 执行 `qmake`
5. 生成 `compile_commands.json`
6. 更新当前工作区的 `clangd.arguments`
7. 按配置重启 clangd

## 失败场景
- 未找到工作区或 `.pro` 文件
- `projectFile` 配置指向不存在的文件
- `qmake`、`make` 或 `compiledb` 执行失败
- `compiledb` 解析策略不满足当前环境，或自动安装后仍不可用
- clangd 扩展不存在或不支持 `clangd.restart`

## 测试标准
- 单个 `.pro` 文件可直接生成数据库
- 多个 `.pro` 文件可选择，并在保存后复用配置
- 自定义 `compilationDatabaseDirectory` 后能正确更新 clangd
- 重复同步不会写入多个 `--compile-commands-dir`
- `envBootstrap` 参与后可正确加载环境
- `auto/system/bundled` 失败诊断可区分，且 `auto` 会先尝试安装
- clangd 缺失时生成流程成功，重启步骤只提示警告
- 多根工作区只更新目标工作区配置
