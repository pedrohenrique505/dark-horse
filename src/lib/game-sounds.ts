export type GameSoundName = "move" | "capture" | "check" | "castle" | "game-end";

export type GameSoundCache = Partial<Record<GameSoundName, HTMLAudioElement | "missing">>;

export const GAME_SOUND_FILES: Record<GameSoundName, string> = {
  move: "/sounds/move.mp3",
  capture: "/sounds/capture.mp3",
  check: "/sounds/check.mp3",
  castle: "/sounds/castle.mp3",
  "game-end": "/sounds/game-end.mp3",
};

export function playConfiguredSound(
  cache: GameSoundCache,
  sound: GameSoundName,
  onFallback: () => void,
) {
  if (typeof Audio === "undefined") {
    onFallback();
    return;
  }

  const current = cache[sound];
  if (current === "missing") {
    onFallback();
    return;
  }

  const audio = current ?? new Audio(GAME_SOUND_FILES[sound]);

  if (!current) {
    audio.preload = "auto";
    audio.addEventListener(
      "error",
      () => {
        cache[sound] = "missing";
        onFallback();
      },
      { once: true },
    );
    cache[sound] = audio;
  }

  audio.currentTime = 0;
  const playback = audio.play();
  if (playback) {
    void playback.catch(() => onFallback());
  }
}
