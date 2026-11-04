// Vercel function: runs the whole election-night app (pollers + SSE + API) inside a Fluid Compute instance.
// Filesystem is read-only except /tmp.
process.env.DATA_DIR ||= '/tmp/data';
process.env.LOG_DIR ||= '/tmp/logs';
const { handler } = await import('../server/app.mjs');
export default handler;
