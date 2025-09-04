function normalizeAlias(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function nextChainTimer(current, step = 3, min = 3) {
  const c = Number(current) || 0;
  return Math.max(min, c - step);
}

function generateId() {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function selectNextHost(players, currentHostId) {
  const alive = players.filter(p => !p.isEliminated);
  const sorted = alive.sort((a, b) => a.joinedAt - b.joinedAt);
  for (const p of sorted) {
    if (p.id !== currentHostId) return p?.id || null;
  }
  return null;
}

module.exports = { normalizeAlias, nextChainTimer, generateId, selectNextHost };