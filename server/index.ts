import { createServer } from "node:http";
import next from "next";
import { Chess, type Move } from "chess.js";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  GameState,
  PlayerColor,
  ServerToClientEvents,
} from "../src/types/game";

type PlayerSlots = Partial<Record<PlayerColor, string>>;

type GameRoom = {
  id: string;
  chess: Chess;
  players: PlayerSlots;
};

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const games = new Map<string, GameRoom>();
const socketSessions = new Map<string, { gameId: string; playerId: string }>();

function createGame(): GameRoom {
  const id = crypto.randomUUID().slice(0, 8);
  const room = { id, chess: new Chess(), players: {} };
  games.set(id, room);
  return room;
}

function getOrCreateGame(id: string): GameRoom {
  const existing = games.get(id);
  if (existing) return existing;

  const room = { id, chess: new Chess(), players: {} };
  games.set(id, room);
  return room;
}

function getPlayerColor(room: GameRoom, playerId: string): PlayerColor | "spectator" {
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
    fen: room.chess.fen(),
    pgn: room.chess.pgn(),
    turn: toColor(room.chess.turn()),
    playerColor: color,
    lastMove: lastMove(room.chess),
    isCheck: room.chess.isCheck(),
    isCheckmate: room.chess.isCheckmate(),
    isDraw: room.chess.isDraw(),
    isGameOver: room.chess.isGameOver(),
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
    const room = createGame();
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

    if (room.chess.turn() !== (color === "white" ? "w" : "b")) {
      socket.emit("move-rejected", { reason: "Ainda não é a sua vez." });
      return;
    }

    try {
      const move: Move = room.chess.move({ from, to, promotion });
      if (!move) throw new Error("Jogada inválida.");
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
