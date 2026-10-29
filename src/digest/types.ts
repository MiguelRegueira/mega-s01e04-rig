export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  /** Number of valid log events for this job, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent error reported by the job, or null if none was reported. */
  lastError: string | null;
  /** Earliest and latest event times, preserving their original offsets. */
  firstAt: string;
  lastAt: string;
};

/** Counts of valid log events, rather than counts of jobs' final statuses. */
export type RunCounts = Record<RunStatus, number>;

export type NightDigest =
  | { night: string; found: false }
  | {
      night: string;
      found: true;
      /** One row per job, sorted by job name. Empty for an empty night. */
      rows: DigestRow[];
      /** Nonempty lines that could not be parsed as valid run events. */
      badLines: number;
      counts: RunCounts;
    };

/**
 * Contract for readNight, implemented in ./read-night.ts.
 * A missing file returns found: false; an empty file is a found night with no rows.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest;
