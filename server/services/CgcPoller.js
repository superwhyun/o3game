/**
 * Background loop for everything that talks to Metanomic asynchronously.
 * Only the holder of the "cgc-poller" lease runs a pass, one pass at a time.
 */
const { randomUUID } = require('node:crypto');
const Lease = require('../models/Lease');
const metanomic = require('./MetanomicClient');

const LEASE_NAME = 'cgc-poller';
const LEASE_TTL_MS = 15_000;
const jobs = [];
let timer = null;
let running = false;
const holder = `${process.pid}:${randomUUID()}`;

/** @param {string} name @param {(client: object, now: Date) => Promise<unknown>} run */
function addJob(name, run) { jobs.push({ name, run }); }

async function tick(now = new Date()) {
  if (running || !metanomic.isEnabled()) return { ran: false };
  running = true;
  try {
    if (!(await Lease.acquire(LEASE_NAME, holder, LEASE_TTL_MS, now))) return { ran: false };
    const client = metanomic.getClient();
    const errors = [];
    for (const job of jobs) {
      try { await job.run(client, now); }
      catch (error) { errors.push({ job: job.name, message: error.message }); }
    }
    return { ran: true, errors };
  } finally {
    running = false;
  }
}

function start({ intervalMs = 1000 } = {}) {
  if (timer || !metanomic.isEnabled()) return false;
  timer = setInterval(() => {
    tick().then((result) => {
      for (const error of result.errors || []) console.error(`CGC job ${error.job} failed: ${error.message}`);
    }).catch((error) => console.error('CGC poller failed:', error.message));
  }, intervalMs);
  timer.unref?.();
  return true;
}

async function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  await Lease.release(LEASE_NAME, holder).catch(() => {});
}

module.exports = { addJob, tick, start, stop, holder };
