'use strict';

/**
 * batch-store.js — tracks the single in-flight Run/Write batch.
 *
 * Writes are paced at 5–10 minutes apart (see classify.js), so a 25-resource
 * batch runs for around three hours. That is far too long to hold an HTTP
 * request open, so the API route spawns the runner DETACHED and returns
 * immediately; this file is how the detached process and the UI talk to each
 * other.
 *
 * State lives in data/.batch-state.json — ephemeral runtime state, gitignored,
 * same as the write-rate-limit tracker. The durable record of what actually
 * happened is data/resource-checks.json, written row by row as the batch runs.
 *
 * Only one batch at a time. Two concurrent batches would interleave writes to
 * the same slugs and race on this file for no benefit.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(process.cwd(), 'data', '.batch-state.json');
const LOG_PATH = path.resolve(process.cwd(), 'data', '.batch.log');

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

function write(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  return state;
}

/** Merge fields into the current state. Used by the runner so it never clobbers `pid`. */
function patch(fields) {
  return write({ ...(read() || {}), ...fields });
}

/** Signal 0 tests whether a pid exists without actually signalling it. */
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * State as the UI should see it.
 *
 * A batch whose process vanished without recording a terminal status — SIGKILL,
 * a machine restart, a crash — would otherwise read as "running" forever and
 * block every future batch. Checking the pid turns that into "interrupted".
 */
function getStatus() {
  const s = read();
  if (!s) return null;
  if (s.status === 'running' && !pidAlive(s.pid)) {
    return {
      ...s,
      status: 'interrupted',
      error: s.error || 'The batch process is gone — killed, crashed, or the machine restarted.',
    };
  }
  return s;
}

function isRunning() {
  const s = getStatus();
  return Boolean(s && s.status === 'running');
}

/**
 * Stop the running batch. Signals the whole process GROUP (negative pid) —
 * the runner is spawned detached, so it leads its own group, and its in-flight
 * `claude` child must die with it rather than being orphaned.
 */
function stop() {
  const s = read();
  if (!s || !pidAlive(s.pid)) return false;
  try {
    process.kill(-s.pid, 'SIGTERM');
  } catch {
    process.kill(s.pid, 'SIGTERM'); // not a group leader after all — signal it directly
  }
  return true;
}

module.exports = { read, write, patch, getStatus, isRunning, stop, pidAlive, STATE_PATH, LOG_PATH };
