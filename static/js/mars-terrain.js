/*
 * Procedural Mars-like terrain model (no Babylon.js dependency).
 *
 * This is NOT real NASA elevation data and does not represent a real Martian
 * location. Heights are generated from seeded gradient noise, ridged noise, a
 * dry channel and simple-crater profiles, then sampled on a fixed grid so the
 * rendered mesh, astronaut ground-following and object placement all agree.
 *
 * Exposes MarsTerrain in the browser and module.exports in Node for tests.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.MarsTerrain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    seed: 4207,
    size: 720, // metres, square, centred on the landing zone
    resolution: 240, // grid cells per side (3 m spacing)
    playRadius: 300, // walkable radius before the boundary clamp
    padRadius: 45, // perfectly flat landing zone radius (height 0)
    padBlend: 45, // distance over which the pad blends into rough terrain
    maxWalkSlope: 1.0, // rise/run (45 degrees)
    textureTile: 6, // metres per soil texture repeat
  });

  // Base equipment stays on the flat pad. Footprints keep rocks clear.
  const BASE_LAYOUT = Object.freeze({
    habitat: Object.freeze({ x: 0, z: 12, radius: 5.5 }),
    greenhouse: Object.freeze({ x: -17, z: 14, radius: 8 }),
    solarArray: Object.freeze({ x: 19, z: 17, radius: 11 }),
    researchStation: Object.freeze({ x: -15, z: -6, radius: 5 }),
    commsDish: Object.freeze({ x: 15, z: -5, radius: 3.5 }),
    // Temporary lander / home base (mars-lander.js); radius covers legs, ramp and storage bay.
    lander: Object.freeze({ x: 0, z: -28, radius: 10 }),
  });
  // Player spawn inside the lander cabin (the lander supplies the exact floor height).
  const SPAWN = Object.freeze({ x: 0, z: -29.4 });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GRADIENT_X = [1, -1, 1, -1, 1, -1, 0, 0];
  const GRADIENT_Y = [1, 1, -1, -1, 0, 0, 1, -1];

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function wrap(value, period) {
    return ((value % period) + period) % period;
  }

  /** Seeded 2D gradient noise in roughly [-1, 1]. Optional integer period tiles it. */
  function createNoise2D(seed) {
    const random = mulberry32(seed);
    const table = Array.from({ length: 256 }, (_, index) => index);
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [table[i], table[j]] = [table[j], table[i]];
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) perm[i] = table[i & 255];

    function corner(ix, iy, dx, dy) {
      const g = perm[perm[ix] + iy] & 7;
      return GRADIENT_X[g] * dx + GRADIENT_Y[g] * dy;
    }

    return function noise(x, y, period) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      let x0 = xi;
      let y0 = yi;
      let x1 = xi + 1;
      let y1 = yi + 1;
      if (period) {
        x0 = wrap(x0, period);
        y0 = wrap(y0, period);
        x1 = wrap(x1, period);
        y1 = wrap(y1, period);
      }
      x0 &= 255; y0 &= 255; x1 &= 255; y1 &= 255;
      const u = fade(xf);
      const v = fade(yf);
      const a = lerp(corner(x0, y0, xf, yf), corner(x1, y0, xf - 1, yf), u);
      const b = lerp(corner(x0, y1, xf, yf - 1), corner(x1, y1, xf - 1, yf - 1), u);
      return lerp(a, b, v);
    };
  }

  function fbm(noise, x, y, octaves, period) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      total += amplitude * noise(x * frequency, y * frequency, period ? period * frequency : 0);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / norm;
  }

  /** Ridged multifractal in [0, 1]: sharp crests, useful for ridgelines. */
  function ridged(noise, x, y, octaves) {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let weight = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      let signal = 1 - Math.abs(noise(x * frequency, y * frequency));
      signal *= signal * weight;
      weight = clamp(signal * 2, 0, 1);
      total += signal * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / norm;
  }

  function insideBaseFootprint(x, z, margin = 0) {
    return Object.values(BASE_LAYOUT).some((site) =>
      Math.hypot(x - site.x, z - site.z) < site.radius + margin);
  }

  function generateCraters(config) {
    const random = mulberry32(config.seed ^ 0x9e3779b9);
    const craters = [
      // Large "hero" crater west of the base for exploration missions.
      { x: -165, z: 95, radius: 58 },
      // Medium crater north-east.
      { x: 120, z: 170, radius: 30 },
    ];
    const minDistance = config.padRadius + config.padBlend;
    let attempts = 0;
    while (craters.length < 30 && attempts < 2000) {
      attempts += 1;
      const radius = 4 + 24 * random() ** 3;
      const angle = random() * Math.PI * 2;
      const distance = minDistance + radius + random() * (config.playRadius + 40 - minDistance - radius);
      const crater = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, radius };
      if (Math.hypot(crater.x, crater.z) - radius * 1.8 < minDistance) continue;
      craters.push(crater);
    }
    return craters.map((crater) => Object.freeze({
      ...crater,
      depth: crater.radius * (crater.radius > 25 ? 0.18 : 0.25),
      rim: crater.radius * 0.06,
    }));
  }

  /** Simple-crater profile: parabolic bowl, raised rim, exponential ejecta. */
  function craterHeight(crater, x, z) {
    const dx = x - crater.x;
    const dz = z - crater.z;
    const reach = crater.radius * 3;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) return 0;
    const d = Math.sqrt(dx * dx + dz * dz) / crater.radius;
    if (d > 3) return 0;
    if (d < 1) {
      const bowl = -crater.depth + (crater.depth + crater.rim) * d * d;
      // Larger craters get a flatter, partly infilled floor.
      return crater.radius > 25 ? Math.max(bowl, -crater.depth * 0.78) : bowl;
    }
    return crater.rim * Math.exp(-(d - 1) * 3.2);
  }

  function channelCentre(x) {
    return -150 + 38 * Math.sin(x / 85) + 14 * Math.sin(x / 31 + 1.3);
  }

  /** Builds the terrain heightfield and returns query helpers. */
  function createTerrain(options = {}) {
    const config = Object.freeze({ ...DEFAULTS, ...options });
    const hills = createNoise2D(config.seed);
    const ridges = createNoise2D(config.seed + 101);
    const detail = createNoise2D(config.seed + 202);
    const tint = createNoise2D(config.seed + 303);
    const craters = generateCraters(config);
    const half = config.size / 2;
    const cell = config.size / config.resolution;
    const vertsPerSide = config.resolution + 1;

    // The blend starts 1.5 grid cells outside padRadius so that interpolated
    // heights are exactly flat everywhere inside padRadius.
    const padFlatEdge = config.padRadius + 1.5 * (config.size / config.resolution);

    function padBlendFactor(x, z) {
      return smoothstep(padFlatEdge, config.padRadius + config.padBlend, Math.hypot(x, z));
    }

    function rawHeight(x, z) {
      const r = Math.hypot(x, z);
      let h = fbm(hills, x / 190, z / 190, 5) * 11;
      h += ridged(ridges, x / 150, z / 150, 4) * 17 * smoothstep(80, 210, r);
      h += smoothstep(230, 340, r) * 34 * (0.7 + 0.6 * ridged(ridges, x / 70 + 9, z / 70 - 4, 3));
      const channelDistance = Math.abs(z - channelCentre(x));
      h -= 6.5 * Math.exp(-((channelDistance / 16) ** 2)) * smoothstep(-300, -200, x) * (1 - smoothstep(220, 320, x));
      for (const crater of craters) h += craterHeight(crater, x, z);
      h += fbm(detail, x / 9, z / 9, 3) * 0.35;
      return h;
    }

    /** Analytic height with the flat landing pad applied (used to build the grid). */
    function analyticHeight(x, z) {
      const blend = padBlendFactor(x, z);
      return blend === 0 ? 0 : rawHeight(x, z) * blend;
    }

    const heights = new Float32Array(vertsPerSide * vertsPerSide);
    for (let row = 0; row < vertsPerSide; row += 1) {
      const z = -half + row * cell;
      for (let col = 0; col < vertsPerSide; col += 1) {
        heights[row * vertsPerSide + col] = analyticHeight(-half + col * cell, z);
      }
    }

    function gridHeight(col, row) {
      return heights[clamp(row, 0, config.resolution) * vertsPerSide + clamp(col, 0, config.resolution)];
    }

    /**
     * Height of the rendered surface. Uses the same two-triangle split as the
     * mesh indices in buildMeshData(), so the astronaut sits exactly on it.
     */
    function heightAt(x, z) {
      const gx = clamp((x + half) / cell, 0, config.resolution - 1e-6);
      const gz = clamp((z + half) / cell, 0, config.resolution - 1e-6);
      const col = Math.floor(gx);
      const row = Math.floor(gz);
      const u = gx - col;
      const v = gz - row;
      const a = gridHeight(col, row);
      const b = gridHeight(col + 1, row);
      const c = gridHeight(col, row + 1);
      const d = gridHeight(col + 1, row + 1);
      if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
      return d + (c - d) * (1 - u) + (b - d) * (1 - v);
    }

    function slopeAt(x, z, step = 1) {
      const dx = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step);
      const dz = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step);
      return Math.hypot(dx, dz);
    }

    /** 0..1 closeness to any crater rim, used for ejecta rocks and colour. */
    function rimProximity(x, z) {
      let best = 0;
      for (const crater of craters) {
        const dx = x - crater.x;
        const dz = z - crater.z;
        const reach = crater.radius * 2.5;
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
        const d = Math.sqrt(dx * dx + dz * dz) / crater.radius;
        if (d < 2.5) best = Math.max(best, Math.exp(-(((d - 1) / 0.35) ** 2)));
      }
      return best;
    }

    function clampToPlayArea(x, z) {
      const r = Math.hypot(x, z);
      if (r <= config.playRadius) return { x, z };
      return { x: (x / r) * config.playRadius, z: (z / r) * config.playRadius };
    }

    function tooSteep(fromX, fromZ, toX, toZ) {
      const run = Math.hypot(toX - fromX, toZ - fromZ);
      if (run < 1e-6) return false;
      return (heightAt(toX, toZ) - heightAt(fromX, fromZ)) / run > config.maxWalkSlope;
    }

    /**
     * Restricts a horizontal move: keeps it inside the play radius and refuses
     * uphill steps steeper than maxWalkSlope, sliding along an axis if possible.
     */
    function constrainMove(fromX, fromZ, toX, toZ) {
      const target = clampToPlayArea(toX, toZ);
      const candidates = [target, clampToPlayArea(target.x, fromZ), clampToPlayArea(fromX, target.z)];
      for (const candidate of candidates) {
        if (!tooSteep(fromX, fromZ, candidate.x, candidate.z)) return candidate;
      }
      return { x: fromX, z: fromZ };
    }

    /** Positions, indices, UVs and vertex colours for one grid mesh. */
    function buildMeshData() {
      const count = vertsPerSide * vertsPerSide;
      const positions = new Float32Array(count * 3);
      const uvs = new Float32Array(count * 2);
      const colors = new Float32Array(count * 4);
      const indices = new Uint32Array(config.resolution * config.resolution * 6);
      for (let row = 0; row < vertsPerSide; row += 1) {
        const z = -half + row * cell;
        for (let col = 0; col < vertsPerSide; col += 1) {
          const x = -half + col * cell;
          const i = row * vertsPerSide + col;
          const h = heights[i];
          positions.set([x, h, z], i * 3);
          uvs.set([x / config.textureTile, z / config.textureTile], i * 2);
          const slope = Math.hypot(
            gridHeight(col + 1, row) - gridHeight(col - 1, row),
            gridHeight(col, row + 1) - gridHeight(col, row - 1),
          ) / (2 * cell);
          colors.set(soilColor(x, z, h, slope), i * 4);
        }
      }
      let k = 0;
      for (let row = 0; row < config.resolution; row += 1) {
        for (let col = 0; col < config.resolution; col += 1) {
          const a = row * vertsPerSide + col;
          const b = a + 1;
          const c = a + vertsPerSide;
          const d = c + 1;
          indices[k++] = a; indices[k++] = b; indices[k++] = c;
          indices[k++] = b; indices[k++] = d; indices[k++] = c;
        }
      }
      return { positions, indices, uvs, colors };
    }

    function soilColor(x, z, h, slope) {
      const large = fbm(tint, x / 60, z / 60, 3);
      const small = fbm(tint, x / 7 + 40, z / 7 - 40, 2);
      const dust = clamp(0.55 + large * 0.9 - slope * 1.4, 0, 1);
      const rock = smoothstep(0.35, 0.85, slope);
      const lowland = smoothstep(0, -6, h); // channels and crater floors
      const pad = 1 - padBlendFactor(x, z);
      const rim = rimProximity(x, z);
      let r = lerp(0.56, 0.74, dust);
      let g = lerp(0.27, 0.43, dust);
      let b = lerp(0.15, 0.26, dust);
      r = lerp(r, 0.34, rock); g = lerp(g, 0.21, rock); b = lerp(b, 0.15, rock);
      r = lerp(r, 0.47, lowland * 0.6); g = lerp(g, 0.25, lowland * 0.6); b = lerp(b, 0.16, lowland * 0.6);
      r = lerp(r, 0.46, rim * 0.35); g = lerp(g, 0.25, rim * 0.35); b = lerp(b, 0.17, rim * 0.35);
      r = lerp(r, 0.68, pad * 0.55); g = lerp(g, 0.42, pad * 0.55); b = lerp(b, 0.28, pad * 0.55);
      const grain = 1 + small * 0.08;
      return [clamp(r * grain, 0, 1), clamp(g * grain, 0, 1), clamp(b * grain, 0, 1), 1];
    }

    return Object.freeze({
      config,
      craters,
      heights,
      half,
      cell,
      vertsPerSide,
      rawHeight,
      analyticHeight,
      heightAt,
      slopeAt,
      rimProximity,
      constrainMove,
      clampToPlayArea,
      buildMeshData,
    });
  }

  /**
   * Seeded scatter of small rocks (visual only) and larger boulders/formations
   * (collidable). Nothing is placed on the landing pad or base footprints.
   */
  function scatterRocks(terrain, options = {}) {
    const { config } = terrain;
    const random = mulberry32((options.seed ?? config.seed) ^ 0x51ed270b);
    const smallCount = options.smallCount ?? 2400;
    const boulderCount = options.boulderCount ?? 36;
    const formationCount = options.formationCount ?? 9;
    const keepClear = config.padRadius + 3;
    const small = [];
    const boulders = [];

    function placeable(x, z, extra = 0) {
      const r = Math.hypot(x, z);
      return r > keepClear + extra && r < config.playRadius + 30 && !insideBaseFootprint(x, z, 4 + extra);
    }

    function rock(x, z, scale, stretchY, sink) {
      return {
        x,
        z,
        y: terrain.heightAt(x, z) - scale * stretchY * sink,
        scale,
        stretchY,
        rotationY: random() * Math.PI * 2,
        tiltX: (random() - 0.5) * 0.5,
        tiltZ: (random() - 0.5) * 0.5,
        variant: Math.floor(random() * 3),
      };
    }

    let attempts = 0;
    while (small.length < smallCount && attempts < smallCount * 30) {
      attempts += 1;
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * (config.playRadius + 30);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (!placeable(x, z)) continue;
      const rim = terrain.rimProximity(x, z);
      const density = 0.3 + rim * 0.7 + clamp(terrain.slopeAt(x, z) * 0.6, 0, 0.3);
      if (random() > density) continue;
      const scale = 0.12 + random() ** 3 * (0.6 + rim * 0.5);
      small.push(rock(x, z, scale, 0.55 + random() * 0.4, 0.35));
    }

    for (let f = 0; f < formationCount; f += 1) {
      let cx = 0;
      let cz = 0;
      for (let tries = 0; tries < 50; tries += 1) {
        const angle = random() * Math.PI * 2;
        const distance = 95 + random() * 180;
        cx = Math.cos(angle) * distance;
        cz = Math.sin(angle) * distance;
        if (placeable(cx, cz, 25) && terrain.slopeAt(cx, cz) < 0.6) break;
      }
      const pieces = 4 + Math.floor(random() * 4);
      for (let p = 0; p < pieces; p += 1) {
        const x = cx + (random() - 0.5) * 12;
        const z = cz + (random() - 0.5) * 12;
        if (!placeable(x, z, 10)) continue;
        const tall = p === 0 || random() < 0.25;
        boulders.push(rock(x, z, 1.6 + random() * 2.4, tall ? 1.6 + random() * 0.8 : 0.7 + random() * 0.4, 0.25));
      }
    }

    attempts = 0;
    const scatteredTarget = boulders.length + boulderCount;
    while (boulders.length < scatteredTarget && attempts < boulderCount * 50) {
      attempts += 1;
      const angle = random() * Math.PI * 2;
      const distance = 60 + random() * (config.playRadius - 40);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (!placeable(x, z, 8)) continue;
      boulders.push(rock(x, z, 0.9 + random() ** 2 * 2.2, 0.6 + random() * 0.5, 0.3));
    }

    return { small, boulders };
  }

  /** Deterministic per-vertex rock deformation (keeps shared positions consistent). */
  function rockDisplacement(x, y, z, variant) {
    const s = variant * 17.31;
    const n = Math.sin(x * 3.1 + s) * Math.cos(z * 2.7 - s) + Math.sin(y * 4.3 + x * 1.7 + s);
    const angular = variant === 1 ? Math.round(n * 2) / 2 : n;
    return 1 + angular * 0.13;
  }

  /** Tileable soil albedo + normal map data (RGBA bytes) for RawTexture. */
  function generateSoilTextures(size = 256, seed = DEFAULTS.seed) {
    const noise = createNoise2D(seed + 404);
    const pebbles = createNoise2D(seed + 505);
    const heightMap = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = (x / size) * 8;
        const v = (y / size) * 8;
        const base = fbm(noise, u, v, 4, 8);
        const grit = Math.max(0, pebbles(u * 4, v * 4, 32)) ** 3 * 2.2;
        heightMap[y * size + x] = base * 0.6 + grit;
      }
    }
    const albedo = new Uint8Array(size * size * 4);
    const normal = new Uint8Array(size * size * 4);
    const sample = (x, y) => heightMap[wrap(y, size) * size + wrap(x, size)];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const h = sample(x, y);
        const shade = clamp(0.86 + h * 0.18, 0.6, 1);
        albedo[i] = Math.round(255 * shade);
        albedo[i + 1] = Math.round(255 * clamp(shade - 0.02 + h * 0.02, 0, 1));
        albedo[i + 2] = Math.round(255 * clamp(shade - 0.05, 0, 1));
        albedo[i + 3] = 255;
        const dx = (sample(x + 1, y) - sample(x - 1, y)) * 2.5;
        const dy = (sample(x, y + 1) - sample(x, y - 1)) * 2.5;
        const length = Math.hypot(dx, dy, 1);
        normal[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
        normal[i + 3] = 255;
      }
    }
    return { size, albedo, normal };
  }

  function mixColor(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  const PALETTE = Object.freeze({
    noonSky: [0.66, 0.48, 0.35], noonHorizon: [0.86, 0.66, 0.5],
    // Low sun: warm, darker sky with a cool blue-grey horizon glow (Martian sunsets are bluish).
    duskSky: [0.3, 0.22, 0.19], duskHorizon: [0.56, 0.52, 0.56],
    nightSky: [0.008, 0.008, 0.016], nightHorizon: [0.03, 0.028, 0.045],
    stormSky: [0.6, 0.4, 0.25],
    sunNoon: [1, 0.93, 0.84], sunLow: [1, 0.76, 0.58],
  });

  /**
   * Lighting/atmosphere for a point in the sol. Day is the first daySeconds;
   * dusk and dawn occupy the edges of the night so the full day is usable.
   */
  function computeEnvironment({ elapsedSeconds = 0, daySeconds = 60, nightSeconds = 30, dust = 0 } = {}) {
    const total = daySeconds + nightSeconds;
    const t = wrap(elapsedSeconds, total);
    const minElevation = 12;
    let elevation;
    let azimuthProgress;
    let phase;
    if (t < daySeconds) {
      phase = "day";
      const p = t / daySeconds;
      elevation = minElevation + 50 * Math.sin(Math.PI * p);
      azimuthProgress = p;
    } else {
      phase = "night";
      const q = (t - daySeconds) / nightSeconds;
      const edge = 0.18;
      if (q < edge) elevation = lerp(minElevation, -12, q / edge);
      else if (q > 1 - edge) elevation = lerp(-12, minElevation, (q - (1 - edge)) / edge);
      else elevation = -12;
      azimuthProgress = q < 0.5 ? 1 + q * 0.2 : q * 0.2 - 0.2;
    }
    dust = clamp(dust, 0, 1);
    const elevationRad = (elevation * Math.PI) / 180;
    // Sun rises in the east (+x), crosses the southern sky (-z) and sets in the
    // west (-x). sunDirection is the direction light travels (towards the ground).
    const azimuth = lerp(Math.PI * 0.45, -Math.PI * 0.45, azimuthProgress);
    const sunDirection = [
      -Math.sin(azimuth) * Math.cos(elevationRad),
      -Math.sin(elevationRad),
      (Math.cos(azimuth) * 0.6 + 0.3) * Math.cos(elevationRad),
    ];
    const len = Math.hypot(...sunDirection);
    sunDirection.forEach((value, index) => { sunDirection[index] = value / len; });

    const daylight = smoothstep(-8, 10, elevation); // 0 night .. 1 full day
    const highSun = smoothstep(4, 32, elevation);
    const dusk = daylight * (1 - highSun);

    let skyZenith = mixColor(PALETTE.nightSky, mixColor(PALETTE.duskSky, PALETTE.noonSky, highSun), daylight);
    let skyHorizon = mixColor(PALETTE.nightHorizon, mixColor(PALETTE.duskHorizon, PALETTE.noonHorizon, highSun), daylight);
    const stormShade = lerp(0.04, 1, daylight);
    const stormColor = PALETTE.stormSky.map((value) => value * stormShade);
    skyZenith = mixColor(skyZenith, stormColor, dust * 0.9);
    skyHorizon = mixColor(skyHorizon, stormColor, dust * 0.95);

    const sunIntensity = (0.7 + 1.5 * highSun) * daylight * (1 - 0.8 * dust);
    const ambientIntensity = lerp(0.09, 0.55, daylight) + 0.18 * dust * daylight;
    const fogDensity = lerp(0.0028, 0.0045, 1 - daylight) * (1 + 9 * dust);

    return {
      phase,
      elevation,
      daylight,
      dusk,
      dust,
      sunDirection,
      sunIntensity,
      sunColor: mixColor(PALETTE.sunLow, PALETTE.sunNoon, highSun),
      ambientIntensity,
      ambientSkyColor: mixColor([0.35, 0.38, 0.55], mixColor([0.85, 0.66, 0.52], [0.8, 0.52, 0.32], dust), daylight),
      ambientGroundColor: mixColor([0.04, 0.04, 0.06], [0.36, 0.2, 0.12], daylight),
      skyZenith,
      skyHorizon,
      fogColor: skyHorizon,
      fogDensity,
      starVisibility: clamp(1 - daylight * 1.6 - dust * 1.2, 0, 1),
      helmetLamp: clamp(1 - daylight * 1.3 + dust * 0.5, 0, 1),
    };
  }

  return Object.freeze({
    DEFAULTS,
    BASE_LAYOUT,
    SPAWN,
    createNoise2D,
    createTerrain,
    scatterRocks,
    rockDisplacement,
    generateSoilTextures,
    computeEnvironment,
    insideBaseFootprint,
    mulberry32,
    smoothstep,
  });
});
