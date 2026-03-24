import * as vscode from 'vscode';
import { runSyncProject } from './commands/syncProject';
import { getOutputChannel } from './services/toolRunner';
import { restartClangd } from './services/clangdIntegration';

export function activate(context: vscode.ExtensionContext): void {
  getOutputChannel();

  context.subscriptions.push(
    vscode.commands.registerCommand('clangdHelper.syncProject', async (uri?: vscode.Uri) => {
      await runSyncProject('sync', uri);
    }),
    vscode.commands.registerCommand(
      'clangdHelper.generateCompilationDatabase',
      async (uri?: vscode.Uri) => {
        await runSyncProject('generateOnly', uri);
      },
    ),
    vscode.commands.registerCommand('clangdHelper.restartClangd', async () => {
      const restarted = await restartClangd();
      if (!restarted) {
        vscode.window.showWarningMessage(
          'clangd.restart is unavailable. Check that the clangd extension is installed.',
        );
        return;
      }

      vscode.window.showInformationMessage('clangd restart command was triggered.');
    }),
  );
}

export function deactivate(): void {}
