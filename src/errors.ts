export class CliUsageError extends Error {
  constructor(message: string) {
    super(`codex-worktree: ${message}`);
    this.name = 'CliUsageError';
  }
}

export function fail(message: string): never {
  throw new Error(`codex-worktree: ${message}`);
}
