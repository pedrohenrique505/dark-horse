import { Chess, type Move } from "chess.js";
import type {
  BotDifficulty,
  BotSettings,
  CreateGameRequest,
  GameMode,
  GameState,
  MovePayload,
  PlayerColor,
  PlayerRole,
} from "../src/types/game";
import type { EngineMove, StockfishRequest } from "./services/stockfish";

type PlayerSlots = Partial<Record<PlayerColor, string>>;

type BotRequestContext = {
  id: number;
  fen: string;
  difficulty: BotDifficulty;
  playerId: string | null;
};

export type GameRoom = {
  id: string;
  mode: GameMode;
  bot: BotSettings | null;
  chess: Chess;
  players: PlayerSlots;
  isBotThinking: boolean;
  nextBotRequestId: number;
  activeBotRequest: BotRequestContext | null;
};

type GameManagerDeps = {
  requestBotMove(request: StockfishRequest): Promise<EngineMove | null>;
  emitRoomState(gameId: string): void;
  emitPlayerState(gameId: string, playerId: string): void;
  emitMoveRejected(gameId: string, playerId: string | null, reason: string): void;
  logError?(message: string, error: unknown): void;
  random?(): number;
};

const BOT_PLAYER_ID = "stockfish";

export function createGameManager(deps: GameManagerDeps) {
  const games = new Map<string, GameRoom>();

  function createGame(request: CreateGameRequest = {}): GameRoom {
    const mode = request.mode ?? "pvp";
    const bot = mode === "vs-bot" ? buildBotSettings(request, deps.random ?? Math.random) : null;
    const id = crypto.randomUUID().slice(0, 8);
    const room: GameRoom = {
      id,
      mode,
      bot,
      chess: new Chess(),
      players: createInitialPlayers(mode, bot),
      isBotThinking: false,
      nextBotRequestId: 0,
      activeBotRequest: null,
    };

    games.set(id, room);

    if (shouldBotPlay(room)) {
      const request = startBotRequest(room, null);
      void playBotMove(room.id, request);
    }

    return room;
  }

  function getRoom(id: string): GameRoom | undefined {
    return games.get(id);
  }

  function getOrCreateGame(id: string): GameRoom {
    const existing = games.get(id);
    if (existing) return existing;

    const room: GameRoom = {
      id,
      mode: "pvp",
      bot: null,
      chess: new Chess(),
      players: {},
      isBotThinking: false,
      nextBotRequestId: 0,
      activeBotRequest: null,
    };

    games.set(id, room);
    return room;
  }

  function joinGame(gameId: string, playerId: string) {
    const room = getOrCreateGame(gameId);
    getOrAssignPlayerColor(room, playerId);
    deps.emitRoomState(room.id);
  }

  function makeMove(payload: MovePayload) {
    const room = games.get(payload.gameId);
    if (!room) {
      deps.emitMoveRejected(payload.gameId, payload.playerId, "Partida não encontrada.");
      return;
    }

    const color = findPlayerColor(room, payload.playerId);
    if (color === "spectator") {
      deps.emitMoveRejected(payload.gameId, payload.playerId, "Espectadores não podem jogar.");
      return;
    }

    if (room.isBotThinking) {
      deps.emitMoveRejected(payload.gameId, payload.playerId, "Aguarde a resposta do Stockfish.");
      return;
    }

    if (room.chess.turn() !== toTurn(color)) {
      deps.emitMoveRejected(payload.gameId, payload.playerId, "Ainda não é a sua vez.");
      return;
    }

    try {
      const move: Move = room.chess.move({
        from: payload.from,
        to: payload.to,
        promotion: payload.promotion,
      });

      if (!move) throw new Error("Jogada inválida.");

      if (shouldBotPlay(room)) {
        const request = startBotRequest(room, payload.playerId);
        deps.emitRoomState(room.id);
        void playBotMove(room.id, request);
        return;
      }

      deps.emitRoomState(room.id);
    } catch {
      deps.emitMoveRejected(payload.gameId, payload.playerId, "Jogada ilegal rejeitada pelo servidor.");
      deps.emitPlayerState(payload.gameId, payload.playerId);
    }
  }

  function handleDisconnect(gameId: string) {
    if (games.has(gameId)) {
      deps.emitRoomState(gameId);
    }
  }

  function buildGameState(gameId: string, playerId: string): GameState | null {
    const room = games.get(gameId);
    if (!room) return null;

    return {
      id: room.id,
      mode: room.mode,
      bot: room.bot ?? undefined,
      fen: room.chess.fen(),
      pgn: room.chess.pgn(),
      turn: toColor(room.chess.turn()),
      playerColor: findPlayerColor(room, playerId),
      lastMove: lastMove(room.chess),
      isCheck: room.chess.isCheck(),
      isCheckmate: room.chess.isCheckmate(),
      isDraw: room.chess.isDraw(),
      isGameOver: room.chess.isGameOver(),
      isBotThinking: room.isBotThinking,
      connected: true,
      players: {
        white: Boolean(room.players.white),
        black: Boolean(room.players.black),
      },
    };
  }

  async function playBotMove(gameId: string, request: BotRequestContext) {
    try {
      const bestMove = await deps.requestBotMove({
        fen: request.fen,
        ...getDifficultyConfig(request.difficulty),
      });

      if (!bestMove) {
        return;
      }

      const room = getRoomReadyForBotMove(gameId, request);
      if (!room) {
        return;
      }

      applyBotMove(room, bestMove);
    } catch (error) {
      deps.logError?.("Erro ao pedir jogada do Stockfish:", error);
      deps.emitMoveRejected(gameId, request.playerId, "Não foi possível obter a resposta do Stockfish.");
    } finally {
      const room = games.get(gameId);
      if (!room) return;

      const didFinishRequest = finishBotRequest(room, request);
      if (didFinishRequest) {
        deps.emitRoomState(room.id);
      }
    }
  }

  function getRoomReadyForBotMove(gameId: string, request: BotRequestContext): GameRoom | null {
    const room = games.get(gameId);
    if (!room) return null;
    if (room.mode !== "vs-bot") return null;
    if (!room.isBotThinking) return null;
    if (!isCurrentBotRequest(room, request)) return null;
    if (room.chess.isGameOver()) return null;
    if (room.chess.turn() !== toTurn(getBotColor(room))) return null;
    if (room.chess.fen() !== request.fen) return null;
    return room;
  }

  return {
    createGame,
    getRoom,
    joinGame,
    makeMove,
    handleDisconnect,
    buildGameState,
  };
}

function findPlayerColor(room: GameRoom, playerId: string): PlayerRole {
  if (room.players.white === playerId) return "white";
  if (room.players.black === playerId) return "black";
  return "spectator";
}

function getOrAssignPlayerColor(room: GameRoom, playerId: string): PlayerRole {
  const existingColor = findPlayerColor(room, playerId);
  if (existingColor !== "spectator") return existingColor;

  if (room.mode === "vs-bot") {
    const humanColor = room.bot?.humanColor ?? "white";

    if (!room.players[humanColor]) {
      room.players[humanColor] = playerId;
      return humanColor;
    }

    return "spectator";
  }

  if (!room.players.white) {
    room.players.white = playerId;
    return "white";
  }

  if (!room.players.black) {
    room.players.black = playerId;
    return "black";
  }

  return "spectator";
}

function toColor(turn: "w" | "b"): PlayerColor {
  return turn === "w" ? "white" : "black";
}

function toTurn(color: PlayerColor): "w" | "b" {
  return color === "white" ? "w" : "b";
}

function lastMove(chess: Chess): [string, string] | undefined {
  const history = chess.history({ verbose: true });
  const move = history.at(-1);
  return move ? [move.from, move.to] : undefined;
}

function shouldBotPlay(room: GameRoom): boolean {
  return room.mode === "vs-bot" && !room.chess.isGameOver() && room.chess.turn() === toTurn(getBotColor(room));
}

function startBotRequest(room: GameRoom, playerId: string | null): BotRequestContext {
  const request: BotRequestContext = {
    id: room.nextBotRequestId + 1,
    fen: room.chess.fen(),
    difficulty: getBotDifficulty(room),
    playerId,
  };

  room.nextBotRequestId = request.id;
  room.activeBotRequest = request;
  room.isBotThinking = true;
  return request;
}

function finishBotRequest(room: GameRoom, request: BotRequestContext): boolean {
  if (!isCurrentBotRequest(room, request)) return false;

  room.activeBotRequest = null;
  room.isBotThinking = false;
  return true;
}

function isCurrentBotRequest(room: GameRoom, request: BotRequestContext): boolean {
  return room.activeBotRequest?.id === request.id;
}

function applyBotMove(room: GameRoom, move: EngineMove) {
  const appliedMove = room.chess.move(move);
  if (!appliedMove) {
    throw new Error("Stockfish retornou uma jogada inválida para o estado atual.");
  }
}

function buildBotSettings(request: CreateGameRequest, random: () => number): BotSettings {
  return {
    difficulty: request.botDifficulty ?? "medium",
    humanColor: resolveHumanColor(request.humanColor, random),
  };
}

function resolveHumanColor(humanColor: CreateGameRequest["humanColor"], random: () => number): PlayerColor {
  if (humanColor === "black" || humanColor === "white") return humanColor;
  return random() < 0.5 ? "white" : "black";
}

function createInitialPlayers(mode: GameMode, bot: BotSettings | null): PlayerSlots {
  if (mode !== "vs-bot" || !bot) return {};
  return { [getBotColorFromSettings(bot)]: BOT_PLAYER_ID };
}

function getBotColor(room: GameRoom): PlayerColor {
  return getBotColorFromSettings(room.bot);
}

function getBotColorFromSettings(bot: BotSettings | null): PlayerColor {
  return bot?.humanColor === "black" ? "white" : "black";
}

function getBotDifficulty(room: GameRoom): BotDifficulty {
  return room.bot?.difficulty ?? "medium";
}

function getDifficultyConfig(difficulty: BotDifficulty) {
  if (difficulty === "easy") {
    return { skillLevel: 1, moveTimeMs: 120 };
  }

  if (difficulty === "hard") {
    return { skillLevel: 12, moveTimeMs: 600 };
  }

  return { skillLevel: 5, moveTimeMs: 250 };
}
