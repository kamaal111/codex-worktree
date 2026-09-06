import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { expect, test } from 'vitest';

import { parseArgs } from '../src/cli.ts';

const packageRoot = path.resolve(url.fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(packageRoot, 'bin', 'run.mjs');

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return childProcess.spawnSync(command, args, { cwd, encoding: 'utf8', env });
}

async function createRepository(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worktree-'));
  expect(run('git', ['init', '-q', '--initial-branch=main'], directory).status).toBe(0);
  expect(run('git', ['config', 'user.name', 'Test User'], directory).status).toBe(0);
  expect(run('git', ['config', 'user.email', 'test@example.com'], directory).status).toBe(0);
  await fs.writeFile(path.join(directory, 'README.md'), 'initial\n');
  expect(run('git', ['add', 'README.md'], directory).status).toBe(0);
  expect(run('git', ['commit', '-qm', 'initial'], directory).status).toBe(0);
  return directory;
}

test('creates, reuses, and lists a named worktree', async () => {
  const repository = await createRepository();
  try {
    const fakeCodex = path.join(repository, 'fake-codex.mjs');
    await fs.writeFile(
      fakeCodex,
      '#!/usr/bin/env node\nconsole.log(process.cwd())\nconsole.log(process.argv.slice(2).join(" "))\n',
    );
    await fs.chmod(fakeCodex, 0o755);
    const environment = { ...process.env, CODEX_BIN: fakeCodex };
    const expectedPath = path.join(await fs.realpath(repository), '.codex-worktrees', 'test');

    const first = run(process.execPath, [cli, '--name', 'test', '--', 'hello'], repository, environment);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(`${expectedPath}\nhello\n`);
    expect(run('git', ['branch', '--show-current'], repository).stdout.trim()).toBe('main');
    expect(run('git', ['show-ref', '--verify', '--quiet', 'refs/heads/codex/test'], repository).status).toBe(0);

    const second = run(process.execPath, [cli, '--name', 'test', '--', 'again'], repository, environment);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(`${expectedPath}\nagain\n`);
    expect(run(process.execPath, [cli, '--list'], repository).stdout).toBe(`${expectedPath}\n`);
  } finally {
    await fs.rm(repository, { force: true, recursive: true });
  }
});

test('rejects unsafe worktree names as a usage error', async () => {
  const repository = await createRepository();
  try {
    const result = run(process.execPath, [cli, '--name', '../outside'], repository);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('worktree names may contain only');
  } finally {
    await fs.rm(repository, { force: true, recursive: true });
  }
});

test('prints help without requiring a Git repository', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worktree-help-'));
  try {
    const result = run(process.execPath, [cli, '--help'], directory);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: codex-worktree');
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('reports missing wrapper option values as usage errors', async () => {
  const repository = await createRepository();
  try {
    const result = run(process.execPath, [cli, '--name'], repository);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--name requires a value');
  } finally {
    await fs.rm(repository, { force: true, recursive: true });
  }
});

test('forwards arguments after the delimiter without parsing them', () => {
  expect(parseArgs(['--name', 'review', '--', '--help'])).toEqual({
    codexArgs: ['--help'],
    helpRequested: false,
    listOnly: false,
    name: 'review',
  });
});

test('forwards unrecognized flags to codexArgs', () => {
  expect(parseArgs(['--unknown-flag', '--other=value'])).toEqual({
    codexArgs: ['--unknown-flag', '--other=value'],
    helpRequested: false,
    listOnly: false,
  });
});
