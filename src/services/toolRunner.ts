import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type { CompiledbStrategy } from '../config';

export interface RunCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  envBootstrap?: string;
  label: string;
}

export interface ResolvedCompiledbTool {
  kind: 'external' | 'bundled';
  source: 'configured' | 'system' | 'installed' | 'bundled';
  executable?: string;
}

export interface GenerateCompilationDatabaseOptions {
  strategy: CompiledbStrategy;
  compiledbPath?: string;
  outputFile: string;
  makePath: string;
  makeArgs: string[];
  cwd: string;
  envBootstrap?: string;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('ClangdHelper');
  return outputChannel;
}

export async function ensureDirectoryExists(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export async function runCommand(options: RunCommandOptions): Promise<void> {
  const result = await spawnAndCollect(options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${options.label} failed with exit code ${result.exitCode}. See the ClangdHelper output channel for details.`,
    );
  }
}

export async function generateCompilationDatabase(
  options: GenerateCompilationDatabaseOptions,
): Promise<ResolvedCompiledbTool> {
  const resolvedTool = await resolveCompiledbTool(options.strategy, options.compiledbPath);

  if (resolvedTool.kind === 'external' && resolvedTool.executable) {
    await runCommand({
      command: resolvedTool.executable,
      args: ['-o', options.outputFile, '--no-build', options.makePath, ...options.makeArgs],
      cwd: options.cwd,
      envBootstrap: options.envBootstrap,
      label: `Generate compilation database (${resolvedTool.source})`,
    });
    return resolvedTool;
  }

  await runBundledCompiledb(options);
  return resolvedTool;
}

export async function resolveCompiledbTool(
  strategy: CompiledbStrategy,
  configuredPath?: string,
): Promise<ResolvedCompiledbTool> {
  if (configuredPath) {
    const explicitExecutable = await resolveExplicitExecutable(configuredPath);
    return {
      kind: 'external',
      source: 'configured',
      executable: explicitExecutable,
    };
  }

  if (strategy === 'auto' || strategy === 'system') {
    const systemExecutable = await resolveExecutableInPath('compiledb');
    if (systemExecutable) {
      return {
        kind: 'external',
        source: 'system',
        executable: systemExecutable,
      };
    }

    if (strategy === 'auto') {
      const installedExecutable = await attemptInstallCompiledb();
      if (installedExecutable) {
        return {
          kind: 'external',
          source: 'installed',
          executable: installedExecutable,
        };
      }
    }

    if (strategy === 'system') {
      throw new Error(
        'compiledbStrategy=system requires a compiledb executable in PATH or clangdHelper.compiledbPath.',
      );
    }
  }

  if (strategy === 'bundled' || strategy === 'auto') {
    return {
      kind: 'bundled',
      source: 'bundled',
    };
  }

  throw new Error(`Unsupported compiledb strategy: ${strategy}`);
}

async function resolveExplicitExecutable(executablePath: string): Promise<string> {
  const normalizedPath = path.normalize(executablePath);

  try {
    await fs.access(normalizedPath);
  } catch {
    throw new Error(`Configured compiledbPath does not exist: ${normalizedPath}`);
  }

  return normalizedPath;
}

async function resolveExecutableInPath(command: string): Promise<string | undefined> {
  return resolveExecutable(command, []);
}

async function resolveExecutable(command: string, additionalDirectories: string[]): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const searchDirectories = [...new Set([...pathEntries, ...additionalDirectories.filter(Boolean)])];
  const candidateNames = process.platform === 'win32'
    ? expandWindowsExecutableNames(command)
    : [command];

  for (const entry of searchDirectories) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(entry, candidateName);
      try {
        await fs.access(candidatePath);
        return candidatePath;
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

async function attemptInstallCompiledb(): Promise<string | undefined> {
  const channel = getOutputChannel();
  channel.appendLine('compiledb was not found in PATH. Trying automatic installation.');

  const installPlans = getCompiledbInstallPlans();
  for (const plan of installPlans) {
    channel.appendLine(`Trying compiledb install via ${plan.label}`);
    try {
      const result = await spawnAndCollect({
        command: plan.command,
        args: plan.args,
        cwd: process.cwd(),
        label: `Install compiledb (${plan.label})`,
      });

      if (result.exitCode !== 0) {
        channel.appendLine(
          `Install attempt via ${plan.label} failed with exit code ${result.exitCode}.`,
        );
        continue;
      }

      const executable = await resolveCompiledbAfterInstall(plan.pythonCommand);
      if (executable) {
        channel.appendLine(`compiledb became available after ${plan.label}: ${executable}`);
        return executable;
      }

      channel.appendLine(`Install via ${plan.label} completed, but compiledb is still not runnable.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      channel.appendLine(`Install attempt via ${plan.label} could not be started: ${message}`);
    }
  }

  channel.appendLine('Automatic compiledb installation was not successful. Falling back to bundled helper.');
  return undefined;
}

interface CompiledbInstallPlan {
  label: string;
  command: string;
  args: string[];
  pythonCommand?: string;
}

function getCompiledbInstallPlans(): CompiledbInstallPlan[] {
  const plans: CompiledbInstallPlan[] = [
    {
      label: 'uv tool install',
      command: 'uv',
      args: ['tool', 'install', 'compiledb'],
    },
    {
      label: 'pipx install',
      command: 'pipx',
      args: ['install', 'compiledb'],
    },
  ];

  if (process.platform === 'win32') {
    plans.push(
      {
        label: 'py -m pip --user',
        command: 'py',
        args: ['-m', 'pip', 'install', '--user', 'compiledb'],
        pythonCommand: 'py',
      },
      {
        label: 'python -m pip --user',
        command: 'python',
        args: ['-m', 'pip', 'install', '--user', 'compiledb'],
        pythonCommand: 'python',
      },
    );
    return plans;
  }

  plans.push(
    {
      label: 'python3 -m pip --user',
      command: 'python3',
      args: ['-m', 'pip', 'install', '--user', 'compiledb'],
      pythonCommand: 'python3',
    },
    {
      label: 'python -m pip --user',
      command: 'python',
      args: ['-m', 'pip', 'install', '--user', 'compiledb'],
      pythonCommand: 'python',
    },
  );

  return plans;
}

async function resolveCompiledbAfterInstall(pythonCommand?: string): Promise<string | undefined> {
  const candidateDirectories = await getPostInstallExecutableDirectories(pythonCommand);
  return resolveExecutable('compiledb', candidateDirectories);
}

async function getPostInstallExecutableDirectories(pythonCommand?: string): Promise<string[]> {
  const directories = new Set<string>();
  const homeDirectory = process.env.HOME ?? process.env.USERPROFILE;

  if (homeDirectory) {
    directories.add(path.join(homeDirectory, '.local', 'bin'));
  }

  if (pythonCommand) {
    const pythonUserScripts = await resolvePythonUserScriptsDirectory(pythonCommand);
    if (pythonUserScripts) {
      directories.add(pythonUserScripts);
    }
  }

  return [...directories];
}

async function resolvePythonUserScriptsDirectory(pythonCommand: string): Promise<string | undefined> {
  try {
    const result = await spawnAndCollect({
      command: pythonCommand,
      args: ['-c', 'import os, sysconfig; print(sysconfig.get_path("scripts", f"{os.name}_user"))'],
      cwd: process.cwd(),
      label: `Resolve user scripts directory (${pythonCommand})`,
    });

    if (result.exitCode !== 0) {
      return undefined;
    }

    const resolvedPath = result.stdout.trim().split(/\r?\n/).at(-1)?.trim();
    return resolvedPath || undefined;
  } catch {
    return undefined;
  }
}

function expandWindowsExecutableNames(command: string): string[] {
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  const lowerCaseCommand = command.toLowerCase();

  if (pathext.some((extension) => lowerCaseCommand.endsWith(extension.toLowerCase()))) {
    return [command];
  }

  return [command, ...pathext.map((extension) => `${command}${extension.toLowerCase()}`)];
}

async function runBundledCompiledb(options: GenerateCompilationDatabaseOptions): Promise<void> {
  const dryRunArgs = buildDryRunArgs(options.makePath, options.makeArgs);
  const result = await spawnAndCollect({
    command: options.makePath,
    args: dryRunArgs,
    cwd: options.cwd,
    envBootstrap: options.envBootstrap,
    label: 'Generate compilation database (bundled helper)',
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Bundled compilation database helper failed with exit code ${result.exitCode}. See the ClangdHelper output channel for details.`,
    );
  }

  const compileCommands = parseCompileCommands(result.stdout, options.cwd);
  if (compileCommands.length === 0) {
    throw new Error(
      'Bundled compilation database helper did not find any compiler invocations in the make dry-run output.',
    );
  }

  await fs.writeFile(options.outputFile, `${JSON.stringify(compileCommands, null, 2)}\n`, 'utf8');
  getOutputChannel().appendLine(
    `Bundled helper wrote ${compileCommands.length} entries to ${options.outputFile}`,
  );
}

function buildDryRunArgs(makePath: string, makeArgs: string[]): string[] {
  const makeName = path.basename(makePath).toLowerCase();

  if (makeName === 'nmake' || makeName === 'nmake.exe' || makeName === 'jom' || makeName === 'jom.exe') {
    return ['/nologo', '/n', ...makeArgs];
  }

  return ['-n', ...makeArgs];
}

function parseCompileCommands(output: string, defaultDirectory: string): CompilationCommand[] {
  const commands = new Map<string, CompilationCommand>();
  const directoryStack: string[] = [defaultDirectory];
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const enterDirectory = line.match(/Entering directory ['`](.+)['`]/);
    if (enterDirectory) {
      directoryStack.push(path.resolve(directoryStack[directoryStack.length - 1], enterDirectory[1]));
      continue;
    }

    if (/Leaving directory ['`]/.test(line)) {
      if (directoryStack.length > 1) {
        directoryStack.pop();
      }
      continue;
    }

    const compilationCommand = tryParseCompilationCommand(line, directoryStack[directoryStack.length - 1]);
    if (!compilationCommand) {
      continue;
    }

    commands.set(compilationCommand.file, compilationCommand);
  }

  return [...commands.values()];
}

interface CompilationCommand {
  directory: string;
  command: string;
  file: string;
}

function tryParseCompilationCommand(line: string, inheritedDirectory: string): CompilationCommand | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  let workingDirectory = inheritedDirectory;
  let commandLine = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
  const cdPrefix = commandLine.match(/^cd\s+(.+?)\s*&&\s*(.+)$/);
  if (cdPrefix) {
    workingDirectory = path.resolve(inheritedDirectory, stripWrappingQuotes(cdPrefix[1]));
    commandLine = cdPrefix[2].trim();
  }

  const tokens = splitCommandLine(commandLine);
  if (tokens.length < 2) {
    return undefined;
  }

  if (!looksLikeCompiler(tokens[0])) {
    return undefined;
  }

  const sourceFile = resolveSourceFile(tokens, workingDirectory);
  if (!sourceFile) {
    return undefined;
  }

  return {
    directory: workingDirectory,
    command: commandLine,
    file: sourceFile,
  };
}

function looksLikeCompiler(command: string): boolean {
  const compilerName = path.basename(stripWrappingQuotes(command)).toLowerCase();
  return (
    compilerName === 'cl' ||
    compilerName === 'cl.exe' ||
    compilerName === 'clang' ||
    compilerName === 'clang++' ||
    compilerName === 'gcc' ||
    compilerName === 'g++' ||
    compilerName === 'cc' ||
    compilerName === 'c++' ||
    compilerName.endsWith('-clang') ||
    compilerName.endsWith('-clang++') ||
    compilerName.endsWith('-gcc') ||
    compilerName.endsWith('-g++')
  );
}

function resolveSourceFile(tokens: string[], workingDirectory: string): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = stripWrappingQuotes(tokens[index]);
    if (token === '-c' || token === '/c') {
      const candidate = tokens[index + 1];
      if (candidate) {
        return path.resolve(workingDirectory, stripWrappingQuotes(candidate));
      }
    }
  }

  for (const token of tokens.slice(1)) {
    const normalized = stripWrappingQuotes(token);
    if (!/\.(c|cc|cpp|cxx|c\+\+|m|mm)$/i.test(normalized)) {
      continue;
    }

    return path.resolve(workingDirectory, normalized);
  }

  return undefined;
}

function splitCommandLine(commandLine: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | '\'' | undefined;
  let escaping = false;

  for (const character of commandLine) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\' && quote !== '\'') {
      escaping = true;
      continue;
    }

    if ((character === '"' || character === '\'') && (!quote || quote === character)) {
      if (quote === character) {
        quote = undefined;
      } else {
        quote = character;
      }
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

async function spawnAndCollect(options: RunCommandOptions): Promise<SpawnResult> {
  const channel = getOutputChannel();
  channel.appendLine(`> ${options.label}`);
  channel.appendLine(`  cwd: ${options.cwd}`);
  channel.appendLine(`  command: ${formatCommand(options.command, options.args, options.envBootstrap)}`);

  return await new Promise<SpawnResult>((resolve, reject) => {
    const { command, args } = toSpawnCommand(options.command, options.args, options.envBootstrap);
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      channel.append(text);
    });

    childProcess.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      channel.append(text);
    });

    childProcess.on('error', (error) => {
      reject(error);
    });

    childProcess.on('close', (exitCode) => {
      channel.appendLine(`  exit code: ${exitCode ?? -1}`);
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function toSpawnCommand(
  command: string,
  args: string[],
  envBootstrap?: string,
): { command: string; args: string[] } {
  if (!envBootstrap) {
    return {
      command,
      args,
    };
  }

  const shellCommand = `${envBootstrap}\n${quoteForShell(command)} ${args.map(quoteForShell).join(' ')}`.trim();
  return {
    command: 'bash',
    args: ['-lc', shellCommand],
  };
}

function formatCommand(command: string, args: string[], envBootstrap?: string): string {
  if (!envBootstrap) {
    return [command, ...args].join(' ');
  }

  return `bash -lc ${JSON.stringify(`${envBootstrap}\n${quoteForShell(command)} ${args.map(quoteForShell).join(' ')}`.trim())}`;
}

function quoteForShell(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll('\'', `'\\''`)}'`;
}
