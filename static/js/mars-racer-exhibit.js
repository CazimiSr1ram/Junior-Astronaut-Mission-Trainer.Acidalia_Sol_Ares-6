/* Stationary model exhibit; no vehicle, resource or mission controller. */
(function (root) {
  "use strict";
  const LOCATION = Object.freeze({ x: -17, z: -20 });
  function create(scene, terrain, options = {}) {
    const B = BABYLON;
    const rootNode = new B.TransformNode("marsRacerExhibit", scene);
    rootNode.position.set(LOCATION.x, terrain.heightAt(LOCATION.x, LOCATION.z), LOCATION.z);
    const interaction = { id: "mars-racer-exhibit", label: "Inspect Mars Racer exhibit", info:
      "Mars Racer Omega Ultimate: a stationary crew-rover exhibit. Driving and a breathable cabin are not available yet. Keep your EVA suit on.",
    position: new B.Vector3(LOCATION.x, rootNode.position.y + 1.5, LOCATION.z - 4.5), radius: 2, hidden: true };
    let collider = null;
    const ready = ModelAssets.load(scene, "racerExhibit").then((result) => {
      if (!result || scene.isDisposed) return false;
      const glb = result.meshes.find((mesh) => mesh.name === "__root__") || result.meshes[0];
      const upright = new B.TransformNode("marsRacerExhibitUpright", scene);
      upright.rotation.x = -Math.PI / 2;
      glb.parent = upright;
      upright.computeWorldMatrix(true);
      result.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
      const bounds = upright.getHierarchyBoundingVectors(true);
      const size = bounds.max.subtract(bounds.min);
      if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
        upright.dispose(false, true); return false;
      }
      const scale = 6 / Math.max(size.x, size.z);
      const fit = new B.TransformNode("marsRacerExhibitFit", scene);
      upright.parent = fit;
      upright.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
      fit.scaling.setAll(scale); fit.parent = rootNode;
      result.meshes.forEach((mesh) => {
        mesh.isPickable = false; mesh.checkCollisions = false; mesh.receiveShadows = true;
        if (mesh.getTotalVertices() > 0 && options.shadows) options.shadows.addShadowCaster(mesh);
      });
      collider = B.MeshBuilder.CreateBox("marsRacerExhibitCollider", { width: size.x * scale, height: size.y * scale, depth: size.z * scale }, scene);
      collider.parent = rootNode; collider.position.y = size.y * scale / 2;
      collider.isVisible = false; collider.isPickable = false; collider.checkCollisions = true;
      interaction.hidden = false;
      return true;
    }).catch((error) => { console.warn("Mars Racer exhibit could not load.", error?.message); return false; });
    return { root: rootNode, interaction, ready, get collider() { return collider; } };
  }
  root.MarsRacerExhibit = Object.freeze({ create, LOCATION });
})(globalThis);
