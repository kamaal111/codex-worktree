import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  realpath: vi.fn(),
  spawnSync: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:child_process', () => ({ default: { spawnSync: mocks.spawnSync } }));
vi.mock('node:fs/promises', () => ({
  default: { mkdir: mocks.mkdir, realpath: mocks.realpath, stat: mocks.stat },
}));

const { CliUsageError, fail } = await import('../src/errors.ts');
const { parseArgs, run, usage } = await import('../src/cli.ts');

const root = '/repository';
const directory = `${root}/.codex-worktrees`;

function successfulGit(stdout = '') {
  return { status: 0, stdout, stderr: '' };
}

function setupRepository(worktrees = '') {
  mocks.spawnSync.mockReturnValueOnce(successfulGit(root));
  mocks.realpath.mockResolvedValue(root);
  mocks.spawnSync.mockReturnValueOnce(successfulGit(worktrees));
}

beforeEach(() => {
  mocks.mkdir.mockReset();
  mocks.realpath.mockReset();
  mocks.spawnSync.mockReset();
  mocks.stat.mockReset();
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('argument parsing', () => {
  test('formats usage text', () => {
    expect(usage()).toContain('Wrapper options:');
  });

  test('parses every wrapper option form', () => {
    expect(parseArgs(['--list', '--name', 'review', '--base', 'main', 'exec'])).toEqual({
      base: 'main',
      codexArgs: ['exec'],
      helpRequested: false,
      listOnly: true,
      name: 'review',
    });
    expect(parseArgs(['--name=review', '--base=main'])).toEqual({
      base: 'main',
      codexArgs: [],
      helpRequested: false,
      listOnly: false,
      name: 'review',
    });
    expect(parseArgs(['-h'])).toMatchObject({ helpRequested: true });
  });

  test('rejects absent and empty option values', () => {
    expect(() => parseArgs(['--name'])).toThrow('--name requires a value');
    expect(() => parseArgs(['--base', ''])).toThrow('--base requires a value');
  });
});

describe('errors', () => {
  test('formats usage errors and failures', () => {
    expect(new CliUsageError('invalid').message).toBe('codex-worktree: invalid');
    expect(() => fail('broken')).toThrow('codex-worktree: broken');
  });
});

describe('run', () => {
  test('prints help without accessing Git', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await run(['--help']);

    expect(output).toHaveBeenCalledWith(usage());
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  test('lists managed worktrees', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setupRepository(`worktree ${directory}/one\nHEAD abc\nworktree /another\n`);

    await run(['--list']);

    expect(output).toHaveBeenCalledWith(`${directory}/one`);
    expect(process.exitCode).toBeUndefined();
  });

  test('reuses an existing worktree', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const filepath = `${directory}/reuse`;
    setupRepository(`worktree ${filepath}\n`);
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));

    await run(['--name', 'reuse', '--', 'exec']);

    expect(errors).toHaveBeenCalledWith(`Reusing worktree: ${filepath}`);
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('codex', ['exec'], {
      cwd: filepath,
      stdio: 'inherit',
    });
    expect(process.exitCode).toBe(0);
  });

  test('creates a worktree from an explicit base', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const filepath = `${directory}/new`;
    setupRepository();
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    mocks.spawnSync.mockReturnValueOnce(successfulGit('origin/main'));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce({ status: null, stdout: '', stderr: '' });
    vi.stubEnv('CODEX_BIN', 'custom-codex');

    await run(['--name=new', '--base=topic']);

    expect(mocks.mkdir).toHaveBeenCalledWith(directory, { recursive: true });
    expect(errors).toHaveBeenCalledWith(`Creating worktree: ${filepath} (branch codex/new from topic)`);
    expect(mocks.spawnSync).toHaveBeenLastCalledWith('custom-codex', [], {
      cwd: filepath,
      stdio: 'inherit',
    });
    expect(process.exitCode).toBe(1);
  });

  test('uses HEAD when origin has no default branch', async () => {
    setupRepository();
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '' });
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));

    await run(['--name', 'fallback']);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '-b', 'codex/fallback', `${directory}/fallback`, 'HEAD'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  });

  test('uses the origin default branch when no base is supplied', async () => {
    setupRepository();
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    mocks.spawnSync.mockReturnValueOnce(successfulGit('origin/main'));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));

    await run(['--name', 'remote']);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '-b', 'codex/remote', `${directory}/remote`, 'origin/main'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  });

  test('generates a worktree name when none is supplied', async () => {
    setupRepository();
    mocks.stat.mockRejectedValueOnce(new Error('missing'));
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '' });
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));
    mocks.spawnSync.mockReturnValueOnce(successfulGit(''));

    await run([]);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'add', '-b', expect.stringMatching(/^codex\/codex-/)]),
      expect.anything(),
    );
  });

  test('reports invalid names and existing unregistered paths', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setupRepository();

    await run(['--name', 'bad/name']);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('worktree names may contain only'));
    expect(process.exitCode).toBe(2);

    setupRepository();
    mocks.stat.mockResolvedValueOnce({});

    await run(['--name', 'occupied']);

    expect(stderr).toHaveBeenCalledWith(
      `codex-worktree: ${directory}/occupied exists but is not a registered Git worktree\n`,
    );
    expect(process.exitCode).toBe(1);
  });

  test('reports Git and Codex execution failures', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '' });

    await run([]);

    expect(stderr).toHaveBeenCalledWith('codex-worktree: run this from inside a Git repository\n');

    setupRepository(`worktree ${directory}/broken\n`);
    mocks.spawnSync.mockReturnValueOnce({
      error: new Error('missing executable'),
      status: null,
      stdout: '',
      stderr: '',
    });

    await run(['--name', 'broken']);

    expect(stderr).toHaveBeenCalledWith(
      'codex-worktree: Codex executable not found: codex (set CODEX_BIN to override)\n',
    );
  });

  test('reports Git command errors and non-Error failures', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.spawnSync.mockReturnValueOnce(successfulGit(root));
    mocks.realpath.mockResolvedValue(root);
    mocks.spawnSync.mockReturnValueOnce({ error: new Error('not installed'), status: null, stdout: '', stderr: '' });

    await run(['--list']);

    expect(stderr).toHaveBeenCalledWith('codex-worktree: could not run Git: not installed\n');

    mocks.spawnSync.mockReturnValueOnce(successfulGit(root));
    mocks.realpath.mockRejectedValueOnce('not an error');

    await run([]);

    expect(stderr).toHaveBeenCalledWith('not an error\n');
  });

  test('reports failed Git commands with Git output or a generated message', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.spawnSync.mockReturnValueOnce(successfulGit(root));
    mocks.realpath.mockResolvedValue(root);
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'bad Git state' });

    await run(['--list']);

    expect(stderr).toHaveBeenCalledWith('codex-worktree: bad Git state\n');

    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockReturnValueOnce(successfulGit(root));
    mocks.realpath.mockResolvedValue(root);
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: '' });

    await run(['--list']);

    expect(stderr).toHaveBeenCalledWith('codex-worktree: git worktree list --porcelain failed\n');
  });
});
