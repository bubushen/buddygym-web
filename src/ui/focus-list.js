// ScrollFocusList: mentre si scorre, la card più vicina al 42% dell'altezza visibile è al
// 100%; le altre scendono fino a scala 0.94 e opacità 0.65 a mezzo schermo di distanza.
// Legato alla posizione (niente durate), solo transform e opacity; spento con «Riduci movimento».
// Si usa su liste con la classe .bg-focuslist (Schede, Sequenze, Storico), mai nel Social.
const FOCUS_AT = 0.42;
const MIN_SCALE = 0.94;
const MIN_OPACITY = 0.65;

const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

// Scala e opacità per una distanza normalizzata (0 = a fuoco, 1 = mezzo schermo o più).
export function focusStyle(distance) {
  const d = Math.min(Math.max(distance, 0), 1);
  return { scale: 1 - (1 - MIN_SCALE) * d, opacity: 1 - (1 - MIN_OPACITY) * d };
}

export function attachFocusList(scroller) {
  let frame = 0;
  const update = () => {
    frame = 0;
    const cards = [...scroller.querySelectorAll('.screen:not([hidden]) .bg-focuslist > .bg-card, .screen:not([hidden]) .bg-focuslist > .bg-dcard')];
    if (reduce?.matches) {
      for (const card of cards) { card.style.transform = ''; card.style.opacity = ''; }
      return;
    }
    const box = scroller.getBoundingClientRect();
    const focus = box.top + box.height * FOCUS_AT;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const { scale, opacity } = focusStyle(Math.abs(rect.top + rect.height / 2 - focus) / (box.height / 2));
      card.style.transform = `scale(${scale.toFixed(3)})`;
      card.style.opacity = opacity.toFixed(2);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  globalThis.addEventListener('resize', schedule);
  reduce?.addEventListener?.('change', schedule);
  return schedule;
}
