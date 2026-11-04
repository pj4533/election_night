// Geography helpers: us-atlas pre-projected (albers, 975x610) county topology -> THREE shapes.
import * as THREE from 'three';
import * as topojson from 'topojson-client';

const URL = '/vendor/us-atlas/counties-albers-10m.json';
let geoP = null;

export function loadGeo() {
  if (!geoP) {
    geoP = fetch(URL).then((r) => r.json()).then((topo) => {
      const counties = topojson.feature(topo, topo.objects.counties).features;
      const states = topojson.feature(topo, topo.objects.states).features;
      return {
        topo, counties, states,
        countyById: new Map(counties.map((f) => [String(f.id), f])),
        stateById: new Map(states.map((f) => [String(f.id), f])),
      };
    });
    geoP.catch(() => { geoP = null; });
  }
  return geoP;
}

export const POSTAL_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15',
  ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', PR: '72',
};

export function polygonsOf(f) {
  const g = f?.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

export function bboxOf(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) for (const poly of polygonsOf(f)) for (const ring of poly) for (const [x, y] of ring) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}

export function centroidOf(f) {
  let sx = 0, sy = 0, n = 0;
  for (const poly of polygonsOf(f)) for (const [x, y] of poly[0]) { sx += x; sy += y; n++; }
  return n ? [sx / n, sy / n] : [0, 0];
}

// map: (albersX, albersY) -> [worldX, worldZ]. Shapes are in (X, -Z) so after rotateX(-PI/2) z lands on world Z.
function ringPts(ring, map) {
  const pts = [];
  const n = ring.length - (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  for (let i = 0; i < n; i++) { const [X, Z] = map(ring[i][0], ring[i][1]); pts.push(new THREE.Vector2(X, -Z)); }
  return pts;
}

export function shapesOf(f, map) {
  const shapes = [];
  for (const poly of polygonsOf(f)) {
    const outer = ringPts(poly[0], map);
    if (outer.length < 3) continue;
    const s = new THREE.Shape(outer);
    for (let i = 1; i < poly.length; i++) { const h = ringPts(poly[i], map); if (h.length >= 3) s.holes.push(new THREE.Path(h)); }
    shapes.push(s);
  }
  return shapes;
}

// Unit-height extruded slab (y in [0,1]); scale.y to set height.
export function slabGeometry(f, map) {
  const shapes = shapesOf(f, map);
  if (!shapes.length) return null;
  let geo;
  try { geo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, curveSegments: 1 }); }
  catch (e) { return null; }
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingSphere();
  return geo;
}

export function flatGeometry(f, map) {
  const shapes = shapesOf(f, map);
  if (!shapes.length) return null;
  const geo = new THREE.ShapeGeometry(shapes, 1);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Outline as LineSegments positions at height y.
export function outlinePositions(features, map, y = 0) {
  const arr = [];
  for (const f of features) for (const poly of polygonsOf(f)) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, z1] = map(ring[i][0], ring[i][1]); const [x2, z2] = map(ring[i + 1][0], ring[i + 1][1]);
      arr.push(x1, y, z1, x2, y, z2);
    }
  }
  return new Float32Array(arr);
}

// mesh-based state outline (topojson.mesh) for clean borders
export function stateBorder(geo, fips2, map, y = 0) {
  const obj = geo.topo.objects.states;
  const m = topojson.mesh(geo.topo, { type: 'GeometryCollection', geometries: obj.geometries.filter((g) => String(g.id) === fips2) });
  const arr = [];
  for (const line of m.coordinates) for (let i = 0; i < line.length - 1; i++) {
    const [x1, z1] = map(line[i][0], line[i][1]); const [x2, z2] = map(line[i + 1][0], line[i + 1][1]);
    arr.push(x1, y, z1, x2, y, z2);
  }
  return new Float32Array(arr);
}
