'use strict';

/**
 * batch-store.js — tracks the single in-flight Relations Run/Write batch.
 * Independent state file from lib/resources/batch-store.js: a Resources
 * batch and a Relations batch must be trackable at the same time (this
 * app's "one at a time" rule applies per feature, not globally — see
 * app/api/relations/run/route.ts's own 409 check). Structurally identical
 * to the resources version; see its comments for the detach/pid-liveness
 * rationale, which applies unchanged here.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(process.cwd(), 'data', '.relations-batch-state.json');
const LOG_PATH = path.resolve(process.cwd(), 'data', '.relations-batch.log');

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

function patch(fields) {
  return write({ ...(read() || {}), ...fields });
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

function stop() {
  const s = read();
  if (!s || !pidAlive(s.pid)) return false;
  try {
    process.kill(-s.pid, 'SIGTERM');
  } catch {
    process.kill(s.pid, 'SIGTERM');
  }
  return true;
}

module.exports = { read, write, patch, getStatus, isRunning, stop, pidAlive, STATE_PATH, LOG_PATH };
