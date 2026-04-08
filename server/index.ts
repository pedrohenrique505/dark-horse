import { createServer, type IncomingMessage } from "node:http";
import next from "next";
import { Chess, type Move } from "chess.js";
import { Server } from "socket.io";
import { getBestMove, type EngineMove } from "./services/stockfish";
import type {
  BotDifficulty,
  BotSettings,
  ClientToServerEvents,
  CreateGameRequest,
  GameMode,
  GameState,
  PlayerColor,
  ServerToClientEvents,
} from "../src/types/game";

type PlayerSlots = Partial<Record<PlayerColor, string>>;

type GameRoom = {
  id: string;
  mode: GameMode;
  bot: BotSettings | null;
  chess: Chess;
  players: PlayerSlots;
  isBotThinking: boolean;
  nextBotRequestId: number;
  activeBotRequest: BotRequestContext | null;
};

const BOT_PLAYER_ID = "stockfish";

type BotRequestContext = {
  id: number;
  fen: string;
  difficulty: BotDifficulty;
  playerId: string | null;
};

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const games = new Map<string, GameRoom>();
const socketSessions = new Map<string, { gameId: string; playerId: string }>();

function createGame(request: CreateGameRequest = {}): GameRoom {
  const mode = request.mode ?? "pvp";
  const bot = mode === "vs-bot" ? buildBotSettings(request) : null;
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
  return room;
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

function getPlayerColor(room: GameRoom, playerId: string): PlayerColor | "spectator" {
  if (room.mode === "vs-bot") {
    const humanColor = room.bot?.humanColor ?? "white";

    if (room.players[humanColor] === playerId) return humanColor;
    if (!room.players[humanColor]) {
      room.players[humanColor] = playerId;
      return humanColor;
    }

    return "spectator";
  }

  if (room.players.white === playerId) return "white";
  if (room.players.black === playerId) return "black";

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

function lastMove(chess: Chess): [string, string] | undefined {
  const history = chess.history({ verbose: true });
  const move = history.at(-1);
  return move ? [move.from, move.to] : undefined;
}

function buildGameState(room: GameRoom, playerId: string): GameState {
  const color = getPlayerColor(room, playerId);

  return {
    id: room.id,
    mode: room.mode,
    bot: room.bot ?? undefined,
    fen: room.chess.fen(),
    pgn: room.chess.pgn(),
    turn: toColor(room.chess.turn()),
    playerColor: color,
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

function emitRoomState(io: Server<ClientToServerEvents, ServerToClientEvents>, room: GameRoom) {
  const sockets = io.sockets.adapter.rooms.get(room.id);
  if (!sockets) return;

  for (const socketId of sockets) {
    const session = socketSessions.get(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (session && socket) socket.emit("game-state", buildGameState(room, session.playerId));
  }
}

await app.prepare();

const httpServer = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/games") {
    const body = await readJson<CreateGameRequest>(req);
    const room = createGame(body);

    if (shouldBotPlay(room)) {
      const request = startBotRequest(room, null);
      void playBotMove(io, room.id, request);
    }

    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: room.id }));
    return;
  }

  await handle(req, res);
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

io.on("connection", (socket) => {
  socket.on("join-game", ({ gameId, playerId }) => {
    const room = getOrCreateGame(gameId);
    getPlayerColor(room, playerId);
    socketSessions.set(socket.id, { gameId, playerId });
    socket.join(gameId);
    emitRoomState(io, room);
  });

  socket.on("make-move", ({ gameId, playerId, from, to, promotion }) => {
    const room = games.get(gameId);
    if (!room) {
      socket.emit("move-rejected", { reason: "Partida não encontrada." });
      return;
    }

    const color = getPlayerColor(room, playerId);
    if (color === "spectator") {
      socket.emit("move-rejected", { reason: "Espectadores não podem jogar." });
      return;
    }

    if (room.isBotThinking) {
      socket.emit("move-rejected", { reason: "Aguarde a resposta do Stockfish." });
      return;
    }

    if (room.chess.turn() !== (color === "white" ? "w" : "b")) {
      socket.emit("move-rejected", { reason: "Ainda não é a sua vez." });
      return;
    }

    try {
      const move: Move = room.chess.move({ from, to, promotion });
      if (!move) throw new Error("Jogada inválida.");

      if (shouldBotPlay(room)) {
        const request = startBotRequest(room, playerId);
        emitRoomState(io, room);
        void playBotMove(io, room.id, request);
        return;
      }

      emitRoomState(io, room);
    } catch {
      socket.emit("move-rejected", { reason: "Jogada ilegal rejeitada pelo servidor." });
      socket.emit("game-state", buildGameState(room, playerId));
    }
  });

  socket.on("disconnect", () => {
    const session = socketSessions.get(socket.id);
    socketSessions.delete(socket.id);
    if (!session) return;

    const room = games.get(session.gameId);
    if (room) emitRoomState(io, room);
  });
});

httpServer.listen(port, hostname, () => {
  console.log(`Servidor pronto em http://localhost:${port}`);
});

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) return {} as T;

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body) as T;
}

function shouldBotPlay(room: GameRoom): boolean {
  return room.mode === "vs-bot" && !room.chess.isGameOver() && room.chess.turn() === toTurn(getBotColor(room));
}

async function playBotMove(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  gameId: string,
  request: BotRequestContext,
) {
  try {
    const bestMove = await getBestMove({
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
    console.error("Erro ao pedir jogada do Stockfish:", error);
    const socket = request.playerId ? findSocketByPlayer(io, gameId, request.playerId) : null;
    socket?.emit("move-rejected", { reason: "Não foi possível obter a resposta do Stockfish." });
  } finally {
    const room = games.get(gameId);
    if (!room) return;

    const didFinishRequest = finishBotRequest(room, request);
    if (didFinishRequest) {
      emitRoomState(io, room);
    }
  }
}

function findSocketByPlayer(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  gameId: string,
  playerId: string,
) {
  const sockets = io.sockets.adapter.rooms.get(gameId);
  if (!sockets) return null;

  for (const socketId of sockets) {
    const session = socketSessions.get(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (session?.playerId === playerId && socket) return socket;
  }

  return null;
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

function applyBotMove(room: GameRoom, move: EngineMove) {
  const appliedMove = room.chess.move(move);
  if (!appliedMove) {
    throw new Error("Stockfish retornou uma jogada inválida para o estado atual.");
  }
}

function buildBotSettings(request: CreateGameRequest): BotSettings {
  return {
    difficulty: request.botDifficulty ?? "medium",
    humanColor: resolveHumanColor(request.humanColor),
  };
}

function resolveHumanColor(humanColor: CreateGameRequest["humanColor"]): PlayerColor {
  if (humanColor === "black" || humanColor === "white") return humanColor;
  return Math.random() < 0.5 ? "white" : "black";
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

function toTurn(color: PlayerColor): "w" | "b" {
  return color === "white" ? "w" : "b";
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
