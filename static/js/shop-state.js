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
  // Mission rewards are defined here (not by callers) and can be claimed once per save.
  const MISSION_REWARDS = Object.freeze({
    'establish-base': Object.freeze({ solar: 50, helium: 0, title: 'Mission 1: Establish the Mars Base' }),
    'mission-success': Object.freeze({ solar: 100, helium: 1, title: '90-sol mission success' }),
  });
  function create(storage) {
    let state = { solar: 0, helium: 0, owned: [], rewardClaimed: false, missionRewards: [] };
    let notice = '';
    try {
      const saved = JSON.parse(storage.getItem(KEY));
      if (saved) {
        if (!Number.isSafeInteger(saved.solar) || saved.solar < 0 ||
            !Number.isSafeInteger(saved.helium) || saved.helium < 0 ||
            !Array.isArray(saved.owned) || typeof saved.rewardClaimed !== 'boolean') throw Error('Invalid save');
        state = { solar: saved.solar, helium: saved.helium,
          owned: [...new Set(saved.owned.filter(name => Object.hasOwnProperty.call(CLASSES, name)))],
          rewardClaimed: saved.rewardClaimed,
          // Older saves have no missionRewards; keep only known mission IDs.
          missionRewards: Array.isArray(saved.missionRewards)
            ? [...new Set(saved.missionRewards.filter(id => Object.hasOwnProperty.call(MISSION_REWARDS, id)))]
            : [] };
      }
    } catch (_) { notice = 'Local save could not be read. Purchases require working browser storage.'; }
    function commit(next, message) {
      try { storage.setItem(KEY, JSON.stringify(next)); }
      catch (_) { return { ok: false, message: 'Unable to save locally. No currency or ownership was changed.' }; }
      state = next;
      return { ok: true, message };
    }
    return {
      get state() { return { ...state, owned: [...state.owned], missionRewards: [...state.missionRewards] }; },
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
      claimMissionReward(missionId) {
        const reward = Object.hasOwnProperty.call(MISSION_REWARDS, missionId) ? MISSION_REWARDS[missionId] : null;
        if (!reward) return { ok: false, message: 'Unknown mission reward.' };
        if (state.missionRewards.includes(missionId)) {
          return { ok: false, alreadyClaimed: true, message: `${reward.title} reward was already received on this browser.` };
        }
        const result = commit({ ...state, solar: state.solar + reward.solar, helium: state.helium + reward.helium,
          missionRewards: [...state.missionRewards, missionId] }, `${reward.title} reward: +${reward.solar} Solar Cells${reward.helium ? ` and +${reward.helium} Helium-3` : ''}.`);
        return { ...result, solar: result.ok ? reward.solar : 0 };
      },
      canEquip(name) { return name === 'Intern' || state.owned.includes(name); },
    };
  }
  const api = { KEY, CLASSES, MISSION_REWARDS, create };
  root.ShopModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
