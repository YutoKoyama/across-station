// ---------- seeded random numbers ----------
// Both devices build the SAME puzzle from the same seed (online co-op).
let rngState = 1;
export const seedRng = sd => { rngState = (sd >>> 0) || 1; };
const rnd01 = () => { rngState = (rngState + 0x6D2B79F5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const rand = n => Math.floor(rnd01() * n);
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const pick = a => a[rand(a.length)];
