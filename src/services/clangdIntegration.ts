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

  await configuration.update(
    'arguments',
    nextArguments,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
}

export async function restartClangd(): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes('clangd.restart')) {
    return false;
  }

  await vscode.commands.executeCommand('clangd.restart');
  return true;
}
