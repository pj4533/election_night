// Builds dist/: the static frontend + vendored libs (served by Vercel's CDN; the API/SSE runs in api/index.mjs).
import fs from 'node:fs';
fs.rmSync('dist', { recursive: true, force: true });
fs.cpSync('public', 'dist', { recursive: true });
const copy = (from, to) => fs.cpSync(from, `dist/vendor/${to}`, { recursive: true });
copy('node_modules/three/build', 'three/build');
copy('node_modules/three/examples/jsm', 'three/examples/jsm');
copy('node_modules/topojson-client/src', 'topojson-client/src');
fs.mkdirSync('dist/vendor/us-atlas', { recursive: true });
fs.copyFileSync('node_modules/us-atlas/counties-albers-10m.json', 'dist/vendor/us-atlas/counties-albers-10m.json');
fs.copyFileSync('node_modules/us-atlas/states-albers-10m.json', 'dist/vendor/us-atlas/states-albers-10m.json');
console.log('dist built');
