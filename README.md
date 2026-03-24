# ClangdHelper

ClangdHelper is a desktop VS Code extension for qmake projects. It generates `compile_commands.json`, updates workspace-level `clangd.arguments`, and can restart clangd after sync.

## Commands
- `ClangdHelper: Sync Project`
- `ClangdHelper: Generate Compilation Database`
- `ClangdHelper: Restart Clangd`

## How To Use
1. Open a qmake workspace in VS Code.
2. Install the extension from the generated `.vsix` package.
3. Set `clangdHelper.projectFile` if the workspace has multiple `.pro` files, or let the extension ask the first time.
4. If qmake depends on a shell environment, set `clangdHelper.envBootstrap`, for example `source ~/.bashrc && source /opt/qt/env.sh`.
5. Run `ClangdHelper: Sync Project` from the command palette.

The sync command does this:
- Finds the target `.pro` file.
- Creates the build directory.
- Runs `qmake`.
- Resolves `compiledb` in this order: explicit path, system tool, auto-install attempt, bundled helper.
- Generates `compile_commands.json`.
- Updates workspace-level `clangd.arguments`.
- Restarts clangd if enabled and available.

## Common Settings
```json
{
  "clangdHelper.projectFile": "app/app.pro",
  "clangdHelper.buildDirectory": ".clangdhelper/build/${projectFileStem}",
  "clangdHelper.compilationDatabaseDirectory": "${buildDirectory}",
  "clangdHelper.qmakePath": "qmake",
  "clangdHelper.makePath": "make",
  "clangdHelper.envBootstrap": "",
  "clangdHelper.compiledbStrategy": "auto",
  "clangdHelper.updateClangdArguments": true,
  "clangdHelper.restartClangdAfterSync": true
}
```

## Output And Diagnostics
- All command output is written to the `ClangdHelper` output channel.
- If `qmake`, `make`, or `compiledb` fails, later steps stop immediately.
- If clangd is not installed, database generation still succeeds and the extension only shows a warning for restart.

## Packaging
```bash
pnpm install
pnpm run package:vsix
```

The package output is `clangdhelper.vsix`.
