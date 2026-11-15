/* Adapter only: the co-developer owns suit state, consumption, damage and repair. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EvaIntegration = api;
})(globalThis, function () {
  "use strict";
  function create(state, options = {}) {
    let provider = null, unsubscribe = null, lastCritical = false, transferring = false;
    function read() {
      if (!provider) return { connected: false, safe: null, critical: false, pending: true };
      let data;
      try { data = provider.read(); } catch { data = {}; }
      data ||= {};
      const validPercent = (value) => Number.isFinite(value) && value > 0 && value <= 100;
      const critical = ["critical", "failed"].includes(data.pressureStatus) || data.leakStatus === "serious";
      const safe = validPercent(data.oxygenPercent) && data.pressureStatus === "safe" && data.co2Status === "safe"
        && validPercent(data.integrityPercent) && validPercent(data.batteryPercent) && data.leakStatus === "none";
      return { ...data, connected: true, safe, critical };
    }
    function notifyChanged() {
      const data = read();
      if (data.critical !== lastCritical) { lastCritical = data.critical; options.onPressureEmergency?.(data.critical); }
      options.onChange?.(data);
      return data;
    }
    function register(next) {
      if (!next || typeof next.read !== "function") throw new TypeError("Suit provider needs read().");
      if (provider) throw new Error("A suit provider is already connected; do not create a second controller.");
      provider = next;
      unsubscribe = next.subscribe?.(notifyChanged);
      notifyChanged();
      return () => { unsubscribe?.(); provider = null; unsubscribe = null; notifyChanged(); };
    }
    function refill(station) {
      const before = read();
      if (transferring || state.missionComplete || !station?.atStation || !station.safe || !station.operational || state.resources.power <= 0) return { ok: false, message: "Use a working suit station inside a safe cabin." };
      const capacity = provider?.oxygenCapacityUnits;
      if (!before.connected || typeof provider.receiveOxygen !== "function" || !Number.isFinite(capacity) || capacity <= 0) return { ok: false, message: "Suit refill integration is pending." };
      if (!Number.isFinite(before.oxygenPercent) || before.oxygenPercent < 0 || before.oxygenPercent > 100) return { ok: false, message: "Check the suit oxygen sensor first." };
      const units = Math.min(state.resources.oxygenReserve, capacity * (100 - before.oxygenPercent) / 100);
      if (units <= 0) return { ok: false, message: "Tank full, or stored oxygen is empty." };
      transferring = true;
      state.resources.oxygenReserve -= units;
      try {
        // Provider must atomically accept the entire transfer, or return false
        // without mutation. It owns the tank; this adapter owns reserve debit.
        if (provider.receiveOxygen({ units, oxygenPercent: before.oxygenPercent + units / capacity * 100 }) !== true) throw new Error("Transfer refused");
      } catch {
        state.resources.oxygenReserve += units;
        return { ok: false, message: "Refill stopped. Stored oxygen was returned." };
      } finally { transferring = false; }
      notifyChanged();
      return { ok: true, message: `Transferred ${units.toFixed(1)} stored oxygen units into the suit.` };
    }
    return { register, read, notifyChanged, refill };
  }
  return { create };
});
