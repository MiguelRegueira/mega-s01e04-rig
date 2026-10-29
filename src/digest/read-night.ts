import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunCounts, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isTimestamp(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-]([01]\d|2[0-3]):([0-5]\d))$/.exec(value);
  return match !== null && match[0] === value && isDate(match[1]) && Number.isFinite(Date.parse(value));
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string' || !isTimestamp(value.at)) return null;
  if (!('job' in value) || typeof value.job !== 'string' || !value.job.trim()) return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  if ('error' in value && typeof value.error !== 'string') return null;

  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...('error' in value ? { error: value.error as string } : {}),
  };
}

/**
 * Aggregate in event-time order, preserving the timestamps exactly as logged.
 * Owner/status come from the latest event; lastError is the latest reported error,
 * even if a later successful event omits it. Ties follow their order in the file.
 * Invalid night names are treated as missing, without reading outside runsDir.
 */
export const readNight: ReadNight = (runsDir, night) => {
  if (!isDate(night)) return { night, found: false };

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { night, found: false };
    }
    throw error;
  }

  const jobs = new Map<string, RunEvent[]>();
  const counts: RunCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      badLines++;
      continue;
    }
    counts[event.status]++;
    const events = jobs.get(event.job) ?? [];
    events.push(event);
    jobs.set(event.job, events);
  }

  const rows: DigestRow[] = [];
  for (const [job, events] of jobs) {
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = events[events.length - 1];
    rows.push({
      job,
      owner: last.owner,
      runs: events.length,
      retries: events.filter(event => event.status === 'retry').length,
      lastStatus: last.status,
      lastError: events.findLast(event => event.error !== undefined)?.error ?? null,
      firstAt: events[0].at,
      lastAt: last.at,
    });
  }
  rows.sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, found: true, rows, badLines, counts };
};
