export type PlayerColor = "white" | "black";
export type PlayerRole = PlayerColor | "spectator";
export type GameMode = "pvp" | "vs-bot";

export type GameState = {
  id: string;
  mode: GameMode;
  fen: string;
  pgn: string;
  turn: PlayerColor;
  playerColor: PlayerRole;
  lastMove?: [string, string];
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  isBotThinking: boolean;
  connected: boolean;
  players: {
    white: boolean;
    black: boolean;
  };
};

export type CreateGameRequest = {
  mode?: GameMode;
};

export type MovePayload = {
  gameId: string;
  playerId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};

export type ClientToServerEvents = {
  "join-game": (payload: { gameId: string; playerId: string }) => void;
  "make-move": (payload: MovePayload) => void;
};

export type ServerToClientEvents = {
  "game-state": (state: GameState) => void;
  "move-rejected": (payload: { reason: string }) => void;
};
