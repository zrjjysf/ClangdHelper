import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  getExtensionConfig,
  persistProjectFileSelection,
  resolveConfiguredPath,
  type ExtensionConfig,
} from '../config';

export interface ProjectContext {
  workspaceFolder: vscode.WorkspaceFolder;
  config: ExtensionConfig;
  workspaceRoot: string;
  projectFile: string;
  buildDirectory: string;
  compilationDatabaseDirectory: string;
}

export async function discoverProjectContext(uri?: vscode.Uri): Promise<ProjectContext> {
  const workspaceFolder = await resolveWorkspaceFolder(uri);
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const config = getExtensionConfig(workspaceFolder.uri);
  const projectFile = await resolveProjectFile(workspaceFolder, config);
  const buildDirectory = resolveConfiguredPath(config.buildDirectory, {
    workspaceFolder: workspaceRoot,
    projectFile,
  });
  const compilationDatabaseDirectory = resolveConfiguredPath(config.compilationDatabaseDirectory, {
    workspaceFolder: workspaceRoot,
    projectFile,
    buildDirectory,
  });

  return {
    workspaceFolder,
    config,
    workspaceRoot,
    projectFile,
    buildDirectory,
    compilationDatabaseDirectory,
  };
}

async function resolveWorkspaceFolder(uri?: vscode.Uri): Promise<vscode.WorkspaceFolder> {
  if (uri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      return workspaceFolder;
    }
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (workspaceFolder) {
      return workspaceFolder;
    }
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }

  if (workspaceFolders.length > 1) {
    const picked = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Select the workspace folder to sync with clangd',
    });
    if (picked) {
      return picked;
    }
  }

  throw new Error('No workspace folder is available for ClangdHelper.');
}

async function resolveProjectFile(
  workspaceFolder: vscode.WorkspaceFolder,
  config: ExtensionConfig,
): Promise<string> {
  if (config.projectFile) {
    const configuredPath = path.isAbsolute(config.projectFile)
      ? path.normalize(config.projectFile)
      : path.resolve(workspaceFolder.uri.fsPath, config.projectFile);

    await ensureFileExists(configuredPath, `Configured projectFile does not exist: ${configuredPath}`);
    return configuredPath;
  }

  const candidates = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/*.pro'),
    '**/{.git,node_modules,dist,out,.clangdhelper}/**',
  );

  if (candidates.length === 0) {
    throw new Error(`No .pro file was found in ${workspaceFolder.uri.fsPath}.`);
  }

  if (candidates.length === 1) {
    return candidates[0].fsPath;
  }

  const picked = await vscode.window.showQuickPick(
    candidates
      .map((candidate) => ({
        label: path.relative(workspaceFolder.uri.fsPath, candidate.fsPath),
        detail: candidate.fsPath,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    {
      placeHolder: 'Select the qmake project file to use for clangd sync',
    },
  );

  if (!picked) {
    throw new Error('Project selection was cancelled.');
  }

  await persistProjectFileSelection(workspaceFolder, picked.detail);
  return picked.detail;
}

async function ensureFileExists(filePath: string, errorMessage: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(errorMessage);
  }
}
