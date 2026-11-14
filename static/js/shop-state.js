(function (root) {
  'use strict';
  const KEY = 'jamt.shops.v1';
  const CLASSES = Object.freeze({
    Commander: { solar: 150, helium: 2, specialty: 'Crew coordination' },
    Engineer: { solar: 100, helium: 0, specialty: 'Systems repair' },
    Medic: { solar: 100, helium: 0, specialty: 'Crew treatment' },
    Botanist: { solar: 100, helium: 0, specialty: 'Greenhouse care' },
    Scientist: { solar: 125, helium: 1, specialty: 'Scientific experiments' },
  });
  function create(storage) {
    let state = { solar: 0, helium: 0, owned: [], rewardClaimed: false };
    let notice = '';
    try {
      const saved = JSON.parse(storage.getItem(KEY));
      if (saved) {
        if (!Number.isSafeInteger(saved.solar) || saved.solar < 0 ||
            !Number.isSafeInteger(saved.helium) || saved.helium < 0 ||
            !Array.isArray(saved.owned) || typeof saved.rewardClaimed !== 'boolean') throw Error('Invalid save');
        state = { solar: saved.solar, helium: saved.helium,
          owned: [...new Set(saved.owned.filter(name => Object.hasOwnProperty.call(CLASSES, name)))],
          rewardClaimed: saved.rewardClaimed };
      }
    } catch (_) { notice = 'Local save could not be read. Purchases require working browser storage.'; }
    function commit(next, message) {
      try { storage.setItem(KEY, JSON.stringify(next)); }
      catch (_) { return { ok: false, message: 'Unable to save locally. No currency or ownership was changed.' }; }
      state = next;
      return { ok: true, message };
    }
    return {
      get state() { return { ...state, owned: [...state.owned] }; },
      notice,
      reward() {
        if (state.rewardClaimed) return { ok: false, message: 'Testing reward already claimed on this browser.' };
        return commit({ ...state, solar: state.solar + 150, helium: state.helium + 2, rewardClaimed: true }, 'Testing reward saved: +150 Solar Cells and +2 Helium-3.');
      },
      buy(name) {
        if (!Object.hasOwnProperty.call(CLASSES, name)) return { ok: false, message: 'Unknown class.' };
        if (state.owned.includes(name)) return { ok: false, message: 'Already owned. Equip it for free.' };
        const price = CLASSES[name];
        if (state.solar < price.solar || state.helium < price.helium) return { ok: false, message: 'Insufficient Solar Cells or Helium-3.' };
        return commit({ ...state, solar: state.solar - price.solar, helium: state.helium - price.helium,
          owned: [...state.owned, name] }, `${name} purchased and saved. You can now equip it.`);
      },
      canEquip(name) { return name === 'Intern' || state.owned.includes(name); },
    };
  }
  const api = { KEY, CLASSES, create };
  root.ShopModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
