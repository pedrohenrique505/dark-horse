const playerIdKey = "dark-horse-player-id";

export function getOrCreatePlayerId(): string {
  const existing = window.localStorage.getItem(playerIdKey);
  if (existing) return existing;

  const playerId = crypto.randomUUID();
  window.localStorage.setItem(playerIdKey, playerId);
  return playerId;
}
