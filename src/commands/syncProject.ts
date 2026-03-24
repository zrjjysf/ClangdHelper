import * as path from 'node:path';
import * as vscode from 'vscode';
import { discoverProjectContext } from '../services/projectDiscovery';
import {
  ensureDirectoryExists,
  generateCompilationDatabase,
  getOutputChannel,
  runCommand,
} from '../services/toolRunner';
import { restartClangd, updateCompileCommandsDir } from '../services/clangdIntegration';

type SyncMode = 'sync' | 'generateOnly';

export async function runSyncProject(mode: SyncMode, uri?: vscode.Uri): Promise<void> {
  const outputChannel = getOutputChannel();
  outputChannel.show(true);

  try {
    const context = await discoverProjectContext(uri);
    const compileCommandsFile = path.join(
      context.compilationDatabaseDirectory,
      'compile_commands.json',
    );

    await ensureDirectoryExists(context.buildDirectory);
    await ensureDirectoryExists(context.compilationDatabaseDirectory);

    outputChannel.appendLine(
      `Using project ${context.projectFile} in workspace ${context.workspaceFolder.uri.fsPath}`,
    );

    await runCommand({
      command: context.config.qmakePath,
      args: [...context.config.qmakeArgs, context.projectFile],
      cwd: context.buildDirectory,
      envBootstrap: context.config.envBootstrap,
      label: 'Run qmake',
    });

    const compiledbTool = await generateCompilationDatabase({
      strategy: context.config.compiledbStrategy,
      compiledbPath: context.config.compiledbPath,
      outputFile: compileCommandsFile,
      makePath: context.config.makePath,
      makeArgs: context.config.makeArgs,
      cwd: context.buildDirectory,
      envBootstrap: context.config.envBootstrap,
    });

    outputChannel.appendLine(`Compilation database source: ${compiledbTool.source}`);

    if (mode === 'sync' && context.config.updateClangdArguments) {
      await updateCompileCommandsDir(context.workspaceFolder, context.compilationDatabaseDirectory);
    }

    if (mode === 'sync' && context.config.restartClangdAfterSync) {
      const restarted = await restartClangd();
      if (!restarted) {
        vscode.window.showWarningMessage(
          'compile_commands.json was generated, but clangd.restart is unavailable. Check that the clangd extension is installed.',
        );
      }
    }

    const successMessage = mode === 'sync'
      ? 'ClangdHelper sync completed successfully.'
      : 'compile_commands.json was generated successfully.';
    vscode.window.showInformationMessage(successMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Error: ${message}`);
    vscode.window.showErrorMessage(message);
    throw error;
  }
}
