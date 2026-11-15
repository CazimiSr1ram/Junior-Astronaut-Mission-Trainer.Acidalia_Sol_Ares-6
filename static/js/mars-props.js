/*
 * Imported Mars landmark props placed ON the existing procedural terrain:
 *   - Mars_Impact_Crater.glb             (raised crater landmark, solid)
 *   - Mars_Abandoned_Equipment_Site.glb  (old rover + solar panel, solid)
 *
 * This is not a terrain system: the procedural terrain (mars-terrain.js)
 * still decides ground height and walking; these models only add solid,
 * inspectable landmarks. Sites were chosen with MarsTerrain itself: 110-230 m
 * from the landing zone, flat footprint, clear of boulders and the procedural
 * craters (see tests/mars-props.test.js).
 *
 * Both models were exported Z-up; they are rotated -90 degrees about X so the
 * rover sits above its base and the crater bowl faces up.
 *
 * Exposes MarsProps in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MarsProps = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SITES = Object.freeze({
    equipmentSite: Object.freeze({
      asset: "equipmentSite",
      x: -50, z: -116, rotationY: 0.6,
      scale: [1, 1, 1],            // modelled in metres (rover body about 3.2 m long)
      footprintRadius: 4.6,
      exclude: ["Small_Martian_Diorama_Base"], // decorative base slab: the props sit on our terrain instead
      interaction: Object.freeze({
        id: "equipment-site", label: "Inspect abandoned equipment", radius: 5, offset: [0, 0, -5.4],
        info: "An old, abandoned rover and solar panel (fictional equipment, not real NASA hardware). The rover no longer works, but the science analysis terminal and salvage crates nearby can still be used.",
      }),
    }),
    crater: Object.freeze({
      asset: "crater",
      // NOT PLACED YET. The model is a ground chunk with a deep, pointed
      // underside: with its lowest point on the ground the rim floats ~3 m up;
      // with its edge at ground level the bowl is buried by the terrain; and no
      // procedural crater is smooth enough to hold it. Needs either a
      // re-export (outer edge at y = 0, bowl above the base) or an approved
      // terrain carve. Placement values below are kept for that.
      enabled: false,
      x: 106, z: 94, rotationY: 0,
      // Model is about 2 units wide. 12x across gives a ~25 m crater; the
      // vertical scale is halved so the depth is about a sixth of the width.
      scale: [12, 6, 12],
      footprintRadius: 12.5,
      exclude: [],
      interaction: Object.freeze({
        id: "crater-landmark", label: "Look at the impact crater", radius: 5, offset: [0, 0, -15],
        info: "An impact crater (training landmark). Craters form when rocks from space hit the surface. Its rim is too steep to climb here.",
      }),
    }),
  });

  /** Lowest terrain height under a circular footprint (so nothing floats). */
  function groundUnder(terrain, x, z, radius) {
    let lowest = terrain.heightAt(x, z);
    for (let a = 0; a < 16; a += 1) {
      for (const f of [0.5, 1]) {
        const angle = (a / 16) * Math.PI * 2;
        lowest = Math.min(lowest, terrain.heightAt(x + Math.cos(angle) * radius * f, z + Math.sin(angle) * radius * f));
      }
    }
    return lowest;
  }

  /** Interaction points for the existing interaction system (available immediately). */
  function interactions(terrain) {
    const B = globalThis.BABYLON;
    return Object.values(SITES).filter((site) => site.enabled !== false).map((site) => {
      const [ox, oy, oz] = site.interaction.offset;
      const x = site.x + ox, z = site.z + oz;
      return {
        id: site.interaction.id, label: site.interaction.label, info: site.interaction.info,
        position: new B.Vector3(x, terrain.heightAt(x, z) + 1.5 + oy, z), radius: site.interaction.radius,
      };
    });
  }

  /**
   * Loads and places one site. Merges meshes by material (fewer draw calls),
   * makes them solid and casts shadows. Resolves true when placed.
   */
  async function placeSite(scene, terrain, site, options) {
    const B = globalThis.BABYLON;
    const result = await globalThis.ModelAssets.load(scene, site.asset);
    if (!result) return false;
    const rootMesh = result.meshes.find((mesh) => mesh.name === "__root__") || result.meshes[0];
    const pivot = new B.TransformNode(`mars-prop-${site.asset}`, scene);
    rootMesh.parent = pivot;
    pivot.rotation.set(-Math.PI / 2, 0, 0);
    pivot.computeWorldMatrix(true);
    result.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    result.meshes.filter((mesh) => site.exclude.includes(mesh.name)).forEach((mesh) => mesh.dispose());
    const parts = result.meshes.filter((mesh) => !mesh.isDisposed() && mesh.getTotalVertices() > 0);

    // Bottom centre of the remaining parts in model space -> placed on the ground.
    let min = new B.Vector3(Infinity, Infinity, Infinity), max = new B.Vector3(-Infinity, -Infinity, -Infinity);
    parts.forEach((mesh) => {
      const box = mesh.getBoundingInfo().boundingBox;
      min = B.Vector3.Minimize(min, box.minimumWorld);
      max = B.Vector3.Maximize(max, box.maximumWorld);
    });
    const outer = new B.TransformNode(`mars-prop-${site.asset}-placement`, scene);
    pivot.parent = outer;
    pivot.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    outer.scaling.set(...site.scale);
    outer.rotation.y = site.rotationY;
    // Sink 5 cm below the lowest ground point so no edge floats.
    outer.position.set(site.x, groundUnder(terrain, site.x, site.z, site.footprintRadius) - 0.05, site.z);
    outer.computeWorldMatrix(true);
    pivot.computeWorldMatrix(true);

    // Merge by material: one mesh per material, baked in world space.
    const byMaterial = new Map();
    parts.forEach((mesh) => {
      mesh.computeWorldMatrix(true);
      const key = mesh.material || null;
      if (!byMaterial.has(key)) byMaterial.set(key, []);
      byMaterial.get(key).push(mesh);
    });
    const finalMeshes = [];
    byMaterial.forEach((group, material) => {
      let meshes;
      if (group.length > 1) {
        let mergedMesh = null;
        try { mergedMesh = B.Mesh.MergeMeshes(group, true, true, undefined, false, false); } catch (error) { mergedMesh = null; }
        meshes = mergedMesh ? [mergedMesh] : group;
      } else {
        meshes = group;
      }
      meshes.forEach((mesh, i) => {
        if (mesh.parent) mesh.setParent(null); // keep the world transform, drop the import hierarchy
        mesh.name = `mars-prop-${site.asset}-${material ? material.name : "default"}${meshes.length > 1 ? `-${i}` : ""}`;
        if (material) mesh.material = material;
        if (mesh.material) mesh.material.maxSimultaneousLights = 3;
        mesh.checkCollisions = true;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        if (options.shadows) options.shadows.addShadowCaster(mesh);
        mesh.computeWorldMatrix(true);
        mesh.freezeWorldMatrix();
        finalMeshes.push(mesh);
      });
    });
    // Remove the now-empty import hierarchy (root, "world" node) and helpers.
    rootMesh.dispose();
    pivot.dispose();
    outer.dispose();
    return finalMeshes.length > 0;
  }

  /** Places every available site; resolves to { equipmentSite: bool, crater: bool }. */
  async function create(scene, terrain, options = {}) {
    const placed = {};
    for (const [key, site] of Object.entries(SITES)) {
      if (site.enabled === false) { placed[key] = false; continue; }
      try {
        placed[key] = await placeSite(scene, terrain, site, options);
      } catch (error) {
        placed[key] = false;
        console.warn(`Prop ${key} could not be placed.`, error && error.message);
      }
    }
    return placed;
  }

  return Object.freeze({ SITES, groundUnder, interactions, create });
});
