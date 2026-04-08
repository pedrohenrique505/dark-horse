export type PlayerColor = "white" | "black";
export type PlayerRole = PlayerColor | "spectator";
export type GameMode = "pvp" | "vs-bot";
export type BotDifficulty = "easy" | "medium" | "hard";
export type BotColorChoice = PlayerColor | "random";

export type BotSettings = {
  difficulty: BotDifficulty;
  humanColor: PlayerColor;
};

export type GameOverReason = "checkmate" | "draw" | "resign" | "agreed-draw";

export type GameResult = {
  winner: PlayerColor | null;
  reason: GameOverReason;
};

export type GameState = {
  id: string;
  mode: GameMode;
  bot?: BotSettings;
  fen: string;
  pgn: string;
  turn: PlayerColor;
  playerColor: PlayerRole;
  lastMove?: [string, string];
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  result?: GameResult;
  drawOfferFrom?: PlayerColor;
  isBotThinking: boolean;
  connected: boolean;
  players: {
    white: boolean;
    black: boolean;
  };
};

export type CreateGameRequest = {
  mode?: GameMode;
  botDifficulty?: BotDifficulty;
  humanColor?: BotColorChoice;
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
  resign: (payload: { gameId: string; playerId: string }) => void;
  "offer-draw": (payload: { gameId: string; playerId: string }) => void;
  "respond-draw-offer": (payload: { gameId: string; playerId: string; accept: boolean }) => void;
};

export type ServerToClientEvents = {
  "game-state": (state: GameState) => void;
  "move-rejected": (payload: { reason: string }) => void;
};
