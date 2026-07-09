export function remainingHp(maxHp: number, currentDamage: number, pendingDamage = 0) {
  const max = finiteNonNegative(maxHp);
  if (max === 0) {
    return 0;
  }
  return Math.max(0, Math.min(max, max - finiteNonNegative(currentDamage) - finiteDamageDelta(pendingDamage)));
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteDamageDelta(value: number) {
  return Number.isFinite(value) ? value : 0;
}
