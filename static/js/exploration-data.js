/*
 * Mars field exploration and science: data + rules (no Babylon.js).
 *
 * Adapted from the Mars_Exploration_Science_Handoff package into this game's
 * architecture: state lives in the shared mission state (state.exploration,
 * plain save-ready data), interactions go through the game's existing
 * interaction controller (no second E-key listener), and all positions are
 * real world positions checked against MarsTerrain (tests/exploration.test.js).
 *
 * Reconciled with the handoff:
 *   - five documented locations (the handoff's default list had six: its
 *     "west" and "east" rock formations are one Layered Rock Formation here)
 *   - one id for the equipment site: "abandoned-equipment" (the handoff used
 *     both "abandoned-site" and "abandoned-equipment")
 *   - the Impact Crater is a real crater in the procedural terrain (walkable);
 *     the supplied crater model was not used (see README)
 *
 * Economy: salvage gives metal, polymer, electronics and ceramic, tracked
 * separately here. Nothing awards Solar Cells, Helium-3, classes or upgrades,
 * and no base resources are produced.
 *
 * Content note: the abandoned equipment and all samples are fictional game
 * content, not real NASA hardware, sites or discoveries. The science facts
 * are general summaries supplied with the handoff, marked for review by the
 * project's science content owner.
 *
 * Exposes ExplorationData in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ExplorationData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const freezeDeep = (value) => {
    Object.values(value).forEach((child) => { if (child && typeof child === "object") freezeDeep(child); });
    return Object.freeze(value);
  };

  const SAVE_VERSION = 1;
  const MATERIALS = Object.freeze(["metal", "polymer", "electronics", "ceramic"]);

  // Hills placement: at the edge of the play area, centred 300 m out at 240°,
  // long axis tangential (model +x along the boundary).
  const HILLS = freezeDeep({ center: { x: -150, z: -259.8 }, rotationY: Math.PI / 6, footprint: { halfLength: 86, halfDepth: 60 } });

  const LOCATIONS = freezeDeep([
    { id: "layered-hills", name: "Layered Hills", anchor: { x: -115, z: -199.2 }, discoveryRadius: 30,
      description: "Curved, layered hills at the edge of the exploration area.",
      fact: "Rock layers can preserve a sequence of geological events. Their order and composition help scientists reconstruct a planet's history." },
    { id: "impact-crater", name: "Impact Crater", anchor: { x: 13, z: -165 }, discoveryRadius: 26,
      description: "A shallow impact crater with a walkable floor.",
      fact: "Impact craters expose material from below the surface and provide clues about the age of a landscape." },
    { id: "abandoned-equipment", name: "Abandoned Equipment Site", anchor: { x: -50, z: -116 }, discoveryRadius: 16,
      description: "A fictional, uncrewed equipment site left by an earlier expedition in this game.",
      fact: "This is a fictional mission site created for the game, not a real NASA or other agency location." },
    { id: "layered-rock", name: "Layered Rock Formation", anchor: { x: -12, z: 104 }, discoveryRadius: 16,
      description: "An outcrop with contrasting rock layers to compare.",
      fact: "Wind-driven abrasion can slowly shape exposed rocks on Mars. The rate depends on wind, dust and rock properties." },
    { id: "meteorite-field", name: "Meteorite Field", anchor: { x: 64, z: 64 }, discoveryRadius: 17,
      description: "Dark fragments scattered across the plain.",
      fact: "Meteorites found on Mars can help researchers study impact history and compare material from different parts of the Solar System." },
  ]);

  const SAMPLE_TYPES = freezeDeep({
    basalt: { label: "Basalt Rock", category: "ROCK", colour: "#55443e",
      description: "A dark volcanic rock sample. Basalt is common in volcanic regions on Earth and is also found on Mars.",
      fact: { title: "Basalt and volcanism", text: "Basalt forms when mafic lava cools. Finding basaltic rocks helps scientists understand volcanic activity and the thermal history of a planet.", review: "General planetary-geology fact; confirm the specific sample interpretation with the science team." } },
    regolith: { label: "Martian Regolith", category: "SOIL", colour: "#b96f50",
      description: "Loose surface material made of dust, sand and broken rock. Regolith is not the same as fertile Earth soil.",
      fact: { title: "What is regolith?", text: "Regolith is the loose layer of dust, soil and broken rock covering solid bedrock. On Mars it is shaped by impacts, wind and other surface processes.", review: "General planetary-science fact; sample composition is fictional." } },
    dust: { label: "Iron-rich Dust", category: "DUST", colour: "#c65e42",
      description: "Fine reddish dust. Iron-bearing minerals contribute to the characteristic colour of the Martian surface.",
      fact: { title: "Why is Mars red?", text: "Iron-bearing minerals in Martian dust and rocks are oxidised. These materials contribute to the rusty red appearance of much of the surface.", review: "General planetary-science fact; exact mineralogy varies by location." } },
    "layered-rock": { label: "Layered Rock Sample", category: "ROCK", colour: "#9b7058",
      description: "A sample with visible bands that can be compared to understand how the rock formed.",
      fact: { title: "Reading rock layers", text: "Sedimentary layers can form as particles settle and become cemented. Their structures can preserve clues about past water, wind and environmental conditions.", review: "General geology fact; do not treat this game sample as evidence of water at a real site." } },
    meteorite: { label: "Meteorite Fragment", category: "FRAGMENT", colour: "#39383a",
      description: "A fictional field sample used to teach how meteorite composition can be studied.",
      fact: { title: "Studying meteorites", text: "Meteorites can preserve material from early Solar System history. Researchers study texture, minerals and chemistry to understand their origin.", review: "General planetary-science fact; this game fragment is fictional." } },
  });

  // Real world positions (x, z), checked for reachability in tests/exploration.test.js.
  const SAMPLES = freezeDeep([
    { id: "sample-01", location: "layered-hills", type: "layered-rock", x: -108, z: -199.2 },
    { id: "sample-02", location: "layered-hills", type: "dust", x: -110.2, z: -194.1 },
    { id: "sample-03", location: "impact-crater", type: "basalt", x: 12.4, z: -156 },
    { id: "sample-04", location: "impact-crater", type: "regolith", x: 6, z: -159.3 },
    { id: "sample-05", location: "impact-crater", type: "dust", x: 4.1, z: -166.3 },
    { id: "sample-06", location: "layered-rock", type: "layered-rock", x: -17.2, z: 96.6 },
    { id: "sample-07", location: "layered-rock", type: "basalt", x: -10.1, z: 95.2 },
    { id: "sample-08", location: "layered-rock", type: "regolith", x: -4.3, z: 99.4 },
    { id: "sample-09", location: "meteorite-field", type: "meteorite", x: 74.6, z: 67 },
    { id: "sample-10", location: "meteorite-field", type: "meteorite", x: 69, z: 73.8 },
    { id: "sample-11", location: "meteorite-field", type: "dust", x: 60.2, z: 74.3 },
    { id: "sample-12", location: "abandoned-equipment", type: "regolith", x: -57.4, z: -112.9 },
  ]);

  const CACHES = freezeDeep([
    { id: "cache-tool-crate", title: "Tool Crate", location: "abandoned-equipment", x: -60.3, z: -119.8, materials: { metal: 2, polymer: 1 } },
    { id: "cache-sensor-parts", title: "Sensor Components", location: "abandoned-equipment", x: -49.8, z: -127, materials: { electronics: 2, metal: 1 } },
    { id: "cache-thermal-parts", title: "Thermal Parts", location: "layered-hills", x: -105.5, z: -202.3, materials: { ceramic: 2, polymer: 1 } },
    { id: "cache-power-unit", title: "Power Unit Parts", location: "meteorite-field", x: 72.4, z: 75.2, materials: { metal: 2, electronics: 1 } },
  ]);

  // Science analysis terminal at the abandoned equipment site.
  const TERMINAL = freezeDeep({ id: "science-terminal", location: "abandoned-equipment", x: -52.4, z: -122.6, facing: Math.atan2(-50 - -52.4, -116 - -122.6) });

  // One exploration beacon per location (near its approach side).
  const BEACONS = freezeDeep([
    { location: "abandoned-equipment", x: -45.9, z: -123.1 },
    { location: "impact-crater", x: 25.5, z: -171.4 },
    { location: "layered-rock", x: -2.9, z: 105 },
    { location: "meteorite-field", x: 73, z: 71.3 },
    { location: "layered-hills", x: -113.8, z: -195.4 },
  ]);

  const byId = (list) => new Map(list.map((item) => [item.id, item]));
  const LOCATION_BY_ID = byId(LOCATIONS), SAMPLE_BY_ID = byId(SAMPLES), CACHE_BY_ID = byId(CACHES);

  function emptyState() {
    return { version: SAVE_VERSION, discovered: [], collected: [], analysed: [], salvaged: [],
      materials: Object.fromEntries(MATERIALS.map((m) => [m, 0])) };
  }

  /** Materials are always derived from the recovered caches (no free resources). */
  function materialsFrom(salvaged) {
    const totals = Object.fromEntries(MATERIALS.map((m) => [m, 0]));
    salvaged.forEach((id) => {
      const cache = CACHE_BY_ID.get(id);
      if (cache) Object.entries(cache.materials).forEach(([m, n]) => { totals[m] += n; });
    });
    return totals;
  }

  function create(state) {
    if (!state.exploration || state.exploration.version !== SAVE_VERSION) state.exploration = emptyState();
    const ex = () => state.exploration;
    const result = (ok, message, extra = {}) => ({ ok, message, ...extra });

    function discover(locationId) {
      const loc = LOCATION_BY_ID.get(locationId);
      if (!loc) return result(false, "Unknown location.");
      if (ex().discovered.includes(locationId)) return result(false, `${loc.name} is already in the science log.`, { duplicate: true });
      ex().discovered.push(locationId);
      return result(true, `Location discovered: ${loc.name}. ${loc.description}`, { location: loc });
    }

    /** Discovers every location whose discovery radius contains (x, z). */
    function discoverNear(x, z) {
      return LOCATIONS
        .filter((loc) => !ex().discovered.includes(loc.id) && Math.hypot(x - loc.anchor.x, z - loc.anchor.z) <= loc.discoveryRadius)
        .map((loc) => discover(loc.id));
    }

    function collectSample(sampleId) {
      const sample = SAMPLE_BY_ID.get(sampleId);
      if (!sample) return result(false, "Unknown sample.");
      if (ex().collected.includes(sampleId)) return result(false, "This sample has already been collected.", { duplicate: true });
      ex().collected.push(sampleId);
      const type = SAMPLE_TYPES[sample.type];
      return result(true, `Sample collected: ${type.label}. Take it to the science terminal at the Abandoned Equipment Site to analyse it.`);
    }

    function analyseSample(sampleId) {
      const sample = SAMPLE_BY_ID.get(sampleId);
      if (!sample) return result(false, "Unknown sample.");
      if (!ex().collected.includes(sampleId)) return result(false, "Collect this sample in the field before analysing it.");
      if (ex().analysed.includes(sampleId)) return result(false, "This sample has already been analysed.", { duplicate: true });
      ex().analysed.push(sampleId);
      const type = SAMPLE_TYPES[sample.type];
      return result(true, `Analysis complete: ${type.label}. ${type.fact.title}: ${type.fact.text}`, { fact: type.fact });
    }

    function recoverCache(cacheId) {
      const cache = CACHE_BY_ID.get(cacheId);
      if (!cache) return result(false, "Unknown salvage cache.");
      if (ex().salvaged.includes(cacheId)) return result(false, "This cache has already been recovered.", { duplicate: true });
      ex().salvaged.push(cacheId);
      ex().materials = materialsFrom(ex().salvaged);
      const contents = Object.entries(cache.materials).map(([m, n]) => `${m} +${n}`).join(", ");
      return result(true, `Salvage recovered from the ${cache.title} (fictional equipment): ${contents}.`, { materials: { ...cache.materials } });
    }

    function objectives() {
      const e = ex();
      return [
        { id: "discover", label: "Discover exploration sites", done: e.discovered.length, total: LOCATIONS.length },
        { id: "collect", label: "Collect field samples", done: e.collected.length, total: SAMPLES.length },
        { id: "analyse", label: "Analyse samples at the science terminal", done: e.analysed.length, total: SAMPLES.length },
        { id: "salvage", label: "Recover salvage caches", done: e.salvaged.length, total: CACHES.length },
      ];
    }

    /** Science log entries: discoveries and analysed samples, in the order they happened. */
    function scienceLog() {
      const e = ex();
      return [
        ...e.discovered.map((id) => ({ kind: "location", title: LOCATION_BY_ID.get(id).name, text: LOCATION_BY_ID.get(id).fact })),
        ...e.analysed.map((id) => {
          const type = SAMPLE_TYPES[SAMPLE_BY_ID.get(id).type];
          return { kind: "sample", title: `${type.label} (${id})`, text: `${type.fact.title}: ${type.fact.text}`, review: type.fact.review };
        }),
      ];
    }

    function exportSave() {
      const e = ex();
      return JSON.parse(JSON.stringify({ version: SAVE_VERSION, discovered: e.discovered, collected: e.collected, analysed: e.analysed, salvaged: e.salvaged }));
    }

    /**
     * Restores saved progress. Unknown ids are dropped, duplicates removed,
     * analysed samples must also be collected, and materials are recomputed
     * from the recovered caches (a save cannot add free materials).
     */
    function importSave(data) {
      if (!data || data.version !== SAVE_VERSION) return result(false, "Unsupported exploration save data.");
      const clean = (list, valid) => [...new Set(Array.isArray(list) ? list : [])].filter((id) => valid.has(id));
      const collected = clean(data.collected, SAMPLE_BY_ID);
      const next = {
        version: SAVE_VERSION,
        discovered: clean(data.discovered, LOCATION_BY_ID),
        collected,
        analysed: clean(data.analysed, SAMPLE_BY_ID).filter((id) => collected.includes(id)),
        salvaged: clean(data.salvaged, CACHE_BY_ID),
      };
      next.materials = materialsFrom(next.salvaged);
      state.exploration = next;
      return result(true, "Exploration progress restored.");
    }

    return {
      discover, discoverNear, collectSample, analyseSample, recoverCache, objectives, scienceLog, exportSave, importSave,
      isCollected: (id) => ex().collected.includes(id),
      isAnalysed: (id) => ex().analysed.includes(id),
      isRecovered: (id) => ex().salvaged.includes(id),
      get materials() { return { ...ex().materials }; },
      get state() { return ex(); },
    };
  }

  return Object.freeze({ SAVE_VERSION, MATERIALS, HILLS, LOCATIONS, SAMPLE_TYPES, SAMPLES, CACHES, TERMINAL, BEACONS, create, materialsFrom });
});
