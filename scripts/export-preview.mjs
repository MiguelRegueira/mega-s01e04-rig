import { access, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

async function outsideRepository(path) {
  // Resolve parent symlinks before checking every ancestor for a Git checkout.
  let directory = await realpath(dirname(resolve(path)));
  const destination = join(directory, basename(path));
  for (;;) {
    try {
      await access(join(directory, '.git'));
      throw new Error('Preview output must be outside every Git checkout.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return destination;
}

async function main() {
  const [output, source = 'http://localhost:8787/digest/2026-10-28', ...extra] = process.argv.slice(2);
  if (!output || extra.length) {
    throw new Error('Usage: node scripts/export-preview.mjs <outside-repo.html> [local-digest-url]');
  }
  if (!output.endsWith('.html')) throw new Error('Output must end in .html.');
  const destination = await outsideRepository(output);
  const url = new URL(source);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Source must be an HTTP URL on localhost.');
  }
  if (!/^\/digest\/\d{4}-\d{2}-\d{2}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error('Source must be a plain /digest/YYYY-MM-DD URL.');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Digest request failed: HTTP ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Digest response is not HTML.');
  }
  const html = await response.text();
  if (!/<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('Digest response is not a complete HTML document.');
  }
  // rig's copy is plain server-rendered HTML with inline CSS, never resource tags.
  if (/<(?:script|link|img|iframe|object|embed|audio|video|source|base)\b/i.test(html)
    || /\b(?:src|srcset|poster|on\w+)\s*=/i.test(html)
    || /@import\b|url\s*\(/i.test(html)) {
    throw new Error('Digest must be self-contained HTML with no scripts or external resources.');
  }
  if (!/<header\b/i.test(html) || !/class=["']marker["']/i.test(html)) {
    throw new Error('Digest is missing its lane banner.');
  }

  // Validate fully before touching the destination, then replace it atomically.
  const temporary = join(dirname(destination), `.rig-preview-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  console.log(`Saved ${Buffer.byteLength(html)} bytes to ${destination}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
