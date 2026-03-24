import * as path from 'node:path';
import * as vscode from 'vscode';

export type CompiledbStrategy = 'auto' | 'system' | 'bundled';

export interface ExtensionConfig {
  projectFile?: string;
  buildDirectory: string;
  compilationDatabaseDirectory: string;
  qmakePath: string;
  qmakeArgs: string[];
  makePath: string;
  makeArgs: string[];
  envBootstrap?: string;
  compiledbStrategy: CompiledbStrategy;
  compiledbPath?: string;
  updateClangdArguments: boolean;
  restartClangdAfterSync: boolean;
}

export interface VariableContext {
  workspaceFolder: string;
  projectFile: string;
  buildDirectory?: string;
}

export function getExtensionConfig(scope: vscode.Uri): ExtensionConfig {
  const configuration = vscode.workspace.getConfiguration('clangdHelper', scope);

  return {
    projectFile: normalizeOptionalString(configuration.get<string>('projectFile', '')),
    buildDirectory: configuration.get<string>('buildDirectory', '.clangdhelper/build/${projectName}'),
    compilationDatabaseDirectory: configuration.get<string>(
      'compilationDatabaseDirectory',
      '${buildDirectory}',
    ),
    qmakePath: configuration.get<string>('qmakePath', 'qmake'),
    qmakeArgs: configuration.get<string[]>('qmakeArgs', []),
    makePath: configuration.get<string>('makePath', 'make'),
    makeArgs: configuration.get<string[]>('makeArgs', []),
    envBootstrap: normalizeOptionalString(configuration.get<string>('envBootstrap', '')),
    compiledbStrategy: configuration.get<CompiledbStrategy>('compiledbStrategy', 'auto'),
    compiledbPath: normalizeOptionalString(configuration.get<string>('compiledbPath', '')),
    updateClangdArguments: configuration.get<boolean>('updateClangdArguments', true),
    restartClangdAfterSync: configuration.get<boolean>('restartClangdAfterSync', true),
  };
}

export function resolveConfiguredPath(rawValue: string, context: VariableContext): string {
  const projectDirectory = path.dirname(context.projectFile);
  const resolvedBuildDirectory = context.buildDirectory ?? '';
  const replaced = rawValue
    .replaceAll('${workspaceFolder}', context.workspaceFolder)
    .replaceAll('${projectDir}', projectDirectory)
    .replaceAll('${projectName}', path.basename(context.projectFile))
    .replaceAll('${projectFileStem}', path.parse(context.projectFile).name)
    .replaceAll('${projectFileDirName}', path.basename(projectDirectory))
    .replaceAll('${buildDirectory}', resolvedBuildDirectory);

  if (path.isAbsolute(replaced)) {
    return path.normalize(replaced);
  }

  return path.resolve(context.workspaceFolder, replaced);
}

export async function persistProjectFileSelection(
  workspaceFolder: vscode.WorkspaceFolder,
  projectFile: string,
): Promise<void> {
  const relativeProjectFile = path.relative(workspaceFolder.uri.fsPath, projectFile);
  const configuration = vscode.workspace.getConfiguration('clangdHelper', workspaceFolder.uri);
  await configuration.update(
    'projectFile',
    relativeProjectFile,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
