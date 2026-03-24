import * as vscode from 'vscode';

export async function updateCompileCommandsDir(
  workspaceFolder: vscode.WorkspaceFolder,
  compilationDatabaseDirectory: string,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('clangd', workspaceFolder.uri);
  const currentArguments = configuration.get<unknown>('arguments');
  const normalizedArguments = Array.isArray(currentArguments)
    ? currentArguments.filter((item): item is string => typeof item === 'string')
    : [];
  const nextArguments = normalizedArguments.filter(
    (argument) => !argument.startsWith('--compile-commands-dir='),
  );

  nextArguments.push(`--compile-commands-dir=${compilationDatabaseDirectory}`);

  await configuration.update('arguments', nextArguments, vscode.ConfigurationTarget.Workspace);

  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
    void vscode.window.showWarningMessage(
      'clangd.arguments is workspace-scoped. ClangdHelper updated the shared workspace setting for all folders.',
    );
  }
}

export async function restartClangd(): Promise<boolean> {
  const clangdExtension = vscode.extensions.getExtension(
    'llvm-vs-code-extensions.vscode-clangd',
  );

  if (!clangdExtension) {
    return false;
  }

  if (!clangdExtension.isActive) {
    await clangdExtension.activate();
  }

  try {
    await vscode.commands.executeCommand('clangd.restart');
    return true;
  } catch {
    return false;
  }
}
