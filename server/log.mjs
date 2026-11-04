// JSON-lines logging. Files under logs/ are meant to be tailed by a monitoring agent.
//  logs/poll.log    every upstream fetch (source, status, ms, bytes, changed, lag)
//  logs/events.log  data events (new results, lead changes, calls, BOE publishes)
//  logs/client.log  errors/heartbeats reported by the browser
//  logs/error.log   anything that went wrong
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.LOG_DIR || (process.env.SIM === '1' ? 'logs-sim' : 'logs'));
fs.mkdirSync(DIR, { recursive: true });
const streams = {};
function stream(name) {
  return (streams[name] ||= fs.createWriteStream(path.join(DIR, `${name}.log`), { flags: 'a' }));
}

export function log(name, obj) {
  const line = JSON.stringify({ ...obj, ts: new Date().toISOString() });
  stream(name).write(line + '\n');
  if (name === 'events' || name === 'error') console.log(`[${name}] ${line}`);
}

export const poll = (o) => log('poll', o);
export const event = (o) => log('events', o);
export const error = (o) => log('error', o);
export const client = (o) => log('client', o);
