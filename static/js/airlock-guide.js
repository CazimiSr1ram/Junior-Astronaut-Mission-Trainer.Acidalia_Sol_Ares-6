/* Child-friendly instructions derived from the existing airlock state. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AirlockGuide = api;
})(globalThis, function () {
  "use strict";
  function next(a, direction, suit) {
    const entering = direction === "enter";
    const item = (step, icon, instruction, label, action, why) => ({ step, icon, instruction, label, action, why, direction });
    if (a.remaining > 0) return { step: entering ? 3 : 3, direction, waiting: true,
      instruction: a.target === "safe" ? "Filling the airlock with air…" : "Removing air from the airlock…",
      why: "Both doors stay shut while the airlock changes pressure." };
    if (entering) {
      if (a.side === "outside") {
        if (!suit.ready) return { ...item(1, "🧑‍🚀", "Check your space suit first.", "Suit check needed", null, "Your suit protects you from the thin Martian atmosphere."), reason: "Put on your suit, seal your helmet and pass the suit check in the lander." };
        if (a.innerOpen) return item(1, "🚪", "Close the inside door first.", "Close inner door", "closeInner", "The two doors must never be open together.");
        if (a.pressure !== "low") return item(1, "🌬️", "Let air out before opening the outside door.", "Remove air", "vent", "The airlock must match Mars before its outer door opens.");
        return a.outerOpen ? item(1, "👣", "Step into the airlock.", "Enter airlock", "enter", "Your suit keeps you safe in the airlock.")
          : item(1, "🚪", "Open the outer door.", "Open outer door", "openOuter", "Your checked suit keeps you safe outside.");
      }
      if (a.outerOpen) return item(2, "🔒", "Close the outer door.", "Seal outer door", "closeOuter", "Mars has very little air. The closed door keeps the habitat's air inside.");
      if (a.pressure !== "safe") return item(3, "🌬️", "Fill the airlock with air.", "Fill with air", "fill", "The airlock needs safe pressure before the inner door opens.");
      if (!a.verified) return item(4, "✅", "Check the air before going in.", "Check the air", "verify", "We check the habitat and airlock before opening the inside door.");
      if (!a.innerOpen) return item(4, "🚪", "The air is ready. Open the inner door.", "Open inner door", "openInner", "Both sides must be safe before the inner door opens.");
      return item(4, "🏠", "Welcome home! Step inside.", "Enter habitat", "toHabitat", "The inner door closes behind you.");
    }
    if (a.side === "habitat") {
      if (!suit.on) return item(1, "🧑‍🚀", "Put on your space suit.", "Put on suit", "suitOn", "Your suit supplies pressure and air outside.");
      if (!suit.helmet) return item(1, "🪖", "Seal your helmet.", "Seal helmet", "sealHelmet", "A sealed helmet keeps your suit pressurised.");
      if (!suit.checked || !suit.safe) return item(1, "✅", "Check your space suit.", "Check suit", "suitCheck", "Oxygen, pressure, carbon dioxide, battery, integrity and leaks all matter.");
      if (a.outerOpen) return item(2, "🔒", "Close the outside door first.", "Seal outer door", "closeOuter", "Both doors must never be open together.");
      if (a.pressure !== "safe") return item(2, "🌬️", "Fill the airlock before opening the inner door.", "Fill with air", "fill", "The pressure must match the habitat before the inner door opens.");
      if (!a.verified) return item(2, "✅", "Check the airlock air.", "Check the air", "verify", "We check pressure and habitat life support first.");
      if (!a.innerOpen) return item(2, "🚪", "Open the inside door.", "Open inner door", "openInner", "The outside door stays shut.");
      return item(2, "👣", "Step into the airlock.", "Enter airlock", "enter", "The inner door will close before we remove air.");
    }
    if (!suit.ready) {
      if (a.outerOpen) return item(3, "⚠️", "Your suit needs help. Close the outer door.", "Seal outer door", "closeOuter", "We must seal the airlock before making it safe again.");
      if (a.pressure !== "safe") return item(3, "⚠️", "Your suit needs help. Fill the airlock.", "Fill with air", "fill", "We need safe pressure before returning inside.");
      if (!a.verified) return item(3, "✅", "Check the air so you can return inside.", "Check the air", "verify", "We check the pressure and habitat life support first.");
      if (!a.innerOpen) return item(3, "🚪", "Your suit needs help. Open the inner door.", "Open inner door", "openInner", "The outside door stays shut.");
      return item(3, "🏠", "Go back inside and check your suit.", "Return to habitat", "toHabitat", "A safe habitat is the best place to check your suit.");
    }
    if (a.innerOpen) return item(2, "🔒", "Close the inside door.", "Seal inner door", "closeInner", "This keeps the habitat's air inside.");
    if (a.pressure !== "low") return item(3, "🌬️", "Remove air from the airlock.", "Remove air", "vent", "Mars has very little air. Your suit keeps you safe as pressure falls.");
    if (!a.outerOpen) return item(4, "🚪", "Open the outer door.", "Open outer door", "openOuter", "The inner door is sealed, so the habitat keeps its air.");
    return item(4, "🔴", "Ready to explore Mars?", "Step onto Mars", "toMars", "The outer door closes behind you.");
  }
  return Object.freeze({ next });
});
