/**
 * logBuffer.js
 * ------------
 * In-memory ring buffer that captures everything written to the console so the
 * dashboard can display server logs without needing file access or a log shipper.
 *
 * - Patches console.log/info/warn/error once (idempotent).
 * - Keeps the last MAX_LOGS entries (FIFO ring buffer).
 * - Still forwards every call to the original console, so the terminal / PM2
 *   logs are unaffected.
 * - Each entry has a monotonic id so the frontend can poll incrementally
 *   ("give me everything after id N").
 */

import util from 'util';

const MAX_LOGS = parseInt(process.env.LOG_BUFFER_SIZE || '2000', 10);

/** @type {{ id:number, ts:string, level:string, msg:string }[]} */
const buffer = [];
let nextId = 1;
let patched = false;

// Strip ANSI colour codes so the UI shows clean text.
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

function push(level, args) {
  const msg = util.format(...args).replace(ANSI, '');
  const entry = { id: nextId++, ts: new Date().toISOString(), level, msg };
  buffer.push(entry);
  if (buffer.length > MAX_LOGS) buffer.shift();
}

/**
 * Patch the global console so all output is mirrored into the ring buffer.
 * Safe to call multiple times — only the first call patches.
 */
export function initLogCapture() {
  if (patched) return;
  patched = true;

  const levels = { log: 'info', info: 'info', warn: 'warn', error: 'error', debug: 'debug' };
  for (const [method, level] of Object.entries(levels)) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      try { push(level, args); } catch { /* never let logging break the app */ }
      original(...args);
    };
  }
}

/**
 * Return buffered log entries.
 * @param {{ limit?:number, level?:string, sinceId?:number, search?:string }} [opts]
 * @returns {{ logs:object[], lastId:number, total:number }}
 */
export function getLogs({ limit = 500, level, sinceId, search } = {}) {
  let logs = buffer;

  if (sinceId != null) logs = logs.filter((e) => e.id > sinceId);
  if (level && level !== 'all') logs = logs.filter((e) => e.level === level);
  if (search) {
    const q = String(search).toLowerCase();
    logs = logs.filter((e) => e.msg.toLowerCase().includes(q));
  }

  // Newest entries are most relevant — cap to the most recent `limit`.
  if (limit > 0 && logs.length > limit) logs = logs.slice(logs.length - limit);

  return {
    logs,
    lastId: buffer.length ? buffer[buffer.length - 1].id : 0,
    total:  buffer.length,
  };
}

/** Clear the buffer (does not affect the terminal output). */
export function clearLogs() {
  buffer.length = 0;
}
