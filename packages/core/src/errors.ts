/** Exit codes, see design/implementation.md §2.3. */
export const ExitCode = {
  ok: 0,
  failure: 1,
  usage: 2,
  tmuxUnavailable: 3,
  notFound: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class BerthError extends Error {
  constructor(message: string, readonly code: ExitCodeValue = ExitCode.failure) {
    super(message);
    this.name = 'BerthError';
  }
}
