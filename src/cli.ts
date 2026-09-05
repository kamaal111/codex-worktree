import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CliUsageError, fail } from './errors.ts';

interface Options {
  base?: string;
  codexArgs: string[];
  helpRequested: boolean;
  listOnly: boolean;
  name?: string;
}

const namePattern = /^[A-Za-z0-9._-]+$/;

export function usage(): string {
  return `Usage: codex-worktree [wrapper options] [--] [codex arguments]

Wrapper options:
  --name NAME     Reuse or create .codex-worktrees/NAME on branch codex/NAME.
  --base REF      Base a new worktree on REF (default: origin/HEAD, then HEAD).
  --list          List worktrees managed by this wrapper.
  --help          Show this help.`;
}

export function parseArgs(args: string[]): Options {
  const options: Options = { codexArgs: [], helpRequested: false, listOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      options.codexArgs.push(...args.slice(index + 1));
      break;
    }
    if (argument === '--help' || argument === '-h') {
      options.helpRequested = true;
      break;
    }
    if (argument === '--list') {
      options.listOnly = true;
      continue;
    }
    if (argument === '--name' || argument === '--base') {
      const value = args[index + 1];
      if (value === undefined || value === '') {
        throw new CliUsageError(`${argument} requires a value`);
      }
      if (argument === '--name') options.name = value;
      else options.base = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--name=')) {
      options.name = argument.slice(7);
      continue;
    }
    if (argument.startsWith('--base=')) {
      options.base = argument.slice(7);
      continue;
    }
    options.codexArgs.push(argument);
  }
  return options;
}

function git(repoRoot: string, args: string[], allowFailure = false): string | undefined {
  const result = childProcess.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) fail(`could not run Git: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFailure) return undefined;
    fail((result.stderr || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

async function repoRoot(): Promise<string> {
  const result = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) fail('run this from inside a Git repository');
  return fs.realpath(result.stdout.trim());
}

async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.stat(filepath);
    return true;
  } catch {
    return false;
  }
}

function runCodex(worktreePath: string, args: string[]): number {
  const executable = process.env.CODEX_BIN || 'codex';
  const result = childProcess.spawnSync(executable, args, { cwd: worktreePath, stdio: 'inherit' });
  if (result.error) fail(`Codex executable not found: ${executable} (set CODEX_BIN to override)`);
  return result.status ?? 1;
}

async function execute(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.helpRequested) {
    console.log(usage());
    return;
  }

  const root = await repoRoot();
  const directory = path.join(root, '.codex-worktrees');
  const worktrees = git(root, ['worktree', 'list', '--porcelain']) || '';
  if (options.listOnly) {
    const prefix = `worktree ${directory}/`;
    for (const line of worktrees.split('\n')) {
      if (line.startsWith(prefix)) console.log(line.slice('worktree '.length));
    }
    return;
  }

  const generatedName = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const name = options.name || `codex-${generatedName}-${process.pid}`;
  if (!namePattern.test(name)) {
    throw new CliUsageError('worktree names may contain only letters, numbers, dots, underscores, and dashes');
  }
  const filepath = path.join(directory, name);
  const branch = `codex/${name}`;
  if (worktrees.split('\n').some(line => line === `worktree ${filepath}`)) {
    console.error(`Reusing worktree: ${filepath}`);
  } else if (await pathExists(filepath)) {
    fail(`${filepath} exists but is not a registered Git worktree`);
  } else {
    const remoteDefaultBranch = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true);
    const base = options.base || remoteDefaultBranch || 'HEAD';
    git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    await fs.mkdir(directory, { recursive: true });
    console.error(`Creating worktree: ${filepath} (branch ${branch} from ${base})`);
    git(root, ['worktree', 'add', '-b', branch, filepath, base]);
  }
  console.error(`Starting Codex in: ${filepath}`);
  process.exitCode = runCodex(filepath, options.codexArgs);
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await execute(argv);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  }
}
