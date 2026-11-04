// Local server entry: same app as the Vercel function, served with node:http.
import http from 'node:http';
import { PORT } from './config.mjs';
import { handler } from './app.mjs';

http.createServer(handler).listen(PORT, () => console.log(`Election Night broadcast → http://localhost:${PORT}`));
