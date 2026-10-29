import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

let runsDir = '';
let originalMarker: string | undefined;

function writeNight(contents: string, date = night) {
  writeFileSync(join(runsDir, `${date}.jsonl`), contents);
}

function app() {
  return createApp({ ...config, runsDir });
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  originalMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'TEST-MARKER';
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
  if (originalMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = originalMarker;
});

describe('digest routes', () => {
  it('renders sorted rows and keeps the HTML and JSON row order aligned', async () => {
    writeNight([
      '{"at":"2026-10-28T02:00:00+01:00","job":"z-retries","status":"retry","owner":null,"error":"busy"}',
      '{"at":"2026-10-28T03:00:00+01:00","job":"z-retries","status":"retry","owner":null}',
      '{"at":"2026-10-28T04:00:00+01:00","job":"z-retries","status":"retry","owner":null}',
      '{"at":"2026-10-28T01:00:00+02:00","job":"a-failure","status":"fail","owner":"owner-a","error":"fatal"}',
      '{"at":"2026-10-28T05:00:00-04:00","job":"m-null-owner","status":"ok","owner":null}',
    ].join('\n'));

    const [page, api] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = (await api.json()) as Extract<NightDigest, { found: true }>;

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('job');
    expect(html).toContain('owner');
    expect(html).toContain('runs');
    expect(html).toContain('retries');
    expect(html).toContain('last status');
    expect(html).toContain('last error');
    expect(html).toContain('first time');
    expect(html).toContain('last time');
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('2026-10-28T01:00:00+02:00');
    expect(html).toContain('2026-10-28T05:00:00-04:00');
    expect(html).toContain('fatal');
    expect(html).toContain('busy');
    expect((html.match(/<tr class="warn">/g) ?? [])).toHaveLength(2);

    const jobs = digest.rows.map((row) => row.job);
    expect(jobs).toEqual(['a-failure', 'm-null-owner', 'z-retries']);
    const htmlPositions = jobs.map((job) => html.indexOf(`<td>${job}</td>`));
    expect(htmlPositions).toEqual([...htmlPositions].sort((a, b) => a - b));
    expect(digest).toMatchObject({
      night,
      found: true,
      badLines: 0,
      counts: { ok: 1, retry: 3, fail: 1 },
      rows: [
        {
          job: 'a-failure', owner: 'owner-a', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'fatal',
          firstAt: '2026-10-28T01:00:00+02:00', lastAt: '2026-10-28T01:00:00+02:00',
        },
        {
          job: 'm-null-owner', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T05:00:00-04:00', lastAt: '2026-10-28T05:00:00-04:00',
        },
        {
          job: 'z-retries', owner: null, runs: 3, retries: 3,
          lastStatus: 'retry', lastError: 'busy',
          firstAt: '2026-10-28T02:00:00+01:00', lastAt: '2026-10-28T04:00:00+01:00',
        },
      ],
    });
  });

  it('returns a bannered 404 page and a not-found JSON result for a missing night', async () => {
    const [page, api] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(404);
    const html = await page.text();
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('night not found');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ night, found: false });
  });

  it('renders an existing empty night as nothing ran and returns empty JSON rows', async () => {
    writeNight('');
    const [page, api] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      night,
      found: true,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines and retains a null-owner row in both formats', async () => {
    writeNight([
      'this is not JSON',
      '{"at":"2026-10-28T12:30:00+01:00","job":"still-here","status":"ok","owner":null}',
    ].join('\n'));
    const [page, api] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = (await api.json()) as Extract<NightDigest, { found: true }>;

    expect(page.status).toBe(200);
    expect(html).toContain('1 malformed line');
    expect(html).toContain('<td>still-here</td>');
    expect(html).toContain('<td>—</td>');
    expect(api.status).toBe(200);
    expect(digest).toMatchObject({
      found: true,
      badLines: 1,
      rows: [{ job: 'still-here', owner: null }],
    });
  });
});
