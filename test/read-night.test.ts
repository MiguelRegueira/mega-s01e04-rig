import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'sync', status: 'ok', owner: 'rook' };
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeEvents(events: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));
}

describe('readNight', () => {
  it('reads the sample night: five jobs, one bad line, and counts of all events', () => {
    const digest = readNight('runs', night);
    expect(digest.found).toBe(true);
    if (!digest.found) throw new Error('sample night missing');
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(digest.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes a missing file from an empty night', () => {
    expect(readNight(runsDir, night)).toEqual({ night, found: false });
    writeFileSync(join(runsDir, `${night}.jsonl`), ' \n\r\n');
    expect(readNight(runsDir, night)).toEqual({
      night, found: true, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and schema violations while keeping valid events', () => {
    const invalid = [
      null, [], 1, 'event', {}, { ...event, at: 'yesterday' },
      { ...event, at: '2026-02-30T23:00:00+01:00' },
      { ...event, at: '2026-10-28T23:00:00' },
      { ...event, at: '2026-10-28T25:00:00+01:00' },
      { ...event, job: '' }, { ...event, job: 3 }, { ...event, status: 'unknown' },
      { ...event, owner: undefined }, { ...event, owner: false }, { ...event, error: null },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      ...invalid.map(value => JSON.stringify(value)), '{broken', '', '  ', JSON.stringify(event),
    ].join('\r\n'));
    const digest = readNight(runsDir, night);
    expect(digest).toMatchObject({ found: true, badLines: invalid.length + 1, counts: { ok: 1, retry: 0, fail: 0 } });
    if (!digest.found) throw new Error('fixture missing');
    expect(digest.rows).toHaveLength(1);
  });

  it('orders by actual time across offsets and keeps the most recent reported error after recovery', () => {
    writeEvents([
      { ...event, at: '2026-10-29T01:30:00+02:00', owner: null },
      { ...event, at: '2026-10-29T00:00:00+01:00', status: 'fail', error: 'new error' },
      { ...event, at: '2026-10-29T01:00:00+03:00', status: 'retry', error: 'old error' },
    ]);
    const digest = readNight(runsDir, night);
    expect(digest).toEqual({
      night, found: true, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{ job: 'sync', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
        firstAt: '2026-10-29T01:00:00+03:00', lastAt: '2026-10-29T01:30:00+02:00' }],
    });
  });

  it('uses file order for equal timestamps and retains an explicitly empty error', () => {
    writeEvents([{ ...event, status: 'fail', error: 'failed' }, { ...event, owner: null, error: '' }]);
    const digest = readNight(runsDir, night);
    expect(digest).toMatchObject({ rows: [{ owner: null, lastStatus: 'ok', lastError: '' }] });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../2026-10-28', '2026-10-28\\..', '2026-02-30', '2026-10-28\n'])('rejects invalid night %j', invalid => {
    expect(readNight(runsDir, invalid)).toEqual({ night: invalid, found: false });
  });

  it('does not hide filesystem failures as missing nights', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
