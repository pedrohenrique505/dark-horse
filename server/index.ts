import { createServer, type IncomingMessage } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createGameManager } from "./game-manager";
import { getBestMove } from "./services/stockfish";
import type {
  ClientToServerEvents,
  CreateGameRequest,
  ServerToClientEvents,
} from "../src/types/game";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const socketSessions = new Map<string, { gameId: string; playerId: string }>();

await app.prepare();

const httpServer = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/games") {
    const body = await readJson<CreateGameRequest>(req);
    const room = gameManager.createGame(body);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: room.id }));
    return;
  }

  await handle(req, res);
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

const gameManager = createGameManager({
  requestBotMove: getBestMove,
  emitRoomState(gameId) {
    const sockets = io.sockets.adapter.rooms.get(gameId);
    if (!sockets) return;

    for (const socketId of sockets) {
      const session = socketSessions.get(socketId);
      const socket = io.sockets.sockets.get(socketId);
      if (!session || !socket) continue;

      const state = gameManager.buildGameState(gameId, session.playerId);
      if (state) socket.emit("game-state", state);
    }
  },
  emitPlayerState(gameId, playerId) {
    const socket = findSocketByPlayer(gameId, playerId);
    const state = gameManager.buildGameState(gameId, playerId);
    if (socket && state) {
      socket.emit("game-state", state);
    }
  },
  emitMoveRejected(gameId, playerId, reason) {
    if (!playerId) return;

    const socket = findSocketByPlayer(gameId, playerId);
    socket?.emit("move-rejected", { reason });
  },
  logError(message, error) {
    console.error(message, error);
  },
});

io.on("connection", (socket) => {
  socket.on("join-game", ({ gameId, playerId }) => {
    socketSessions.set(socket.id, { gameId, playerId });
    socket.join(gameId);
    gameManager.joinGame(gameId, playerId);
  });

  socket.on("make-move", (payload) => {
    gameManager.makeMove(payload);
  });

  socket.on("resign", ({ gameId, playerId }) => {
    gameManager.resignGame(gameId, playerId);
  });

  socket.on("offer-draw", ({ gameId, playerId }) => {
    const offer = gameManager.offerDraw(gameId, playerId);
    if (!offer?.opponentPlayerId) return;

    const opponentSocket = findSocketByPlayer(gameId, offer.opponentPlayerId);
    opponentSocket?.emit("draw-offer-received", { from: offer.from });
  });

  socket.on("respond-draw-offer", ({ gameId, playerId, accept }) => {
    const requesterPlayerId = gameManager.respondToDrawOffer(gameId, playerId, accept);
    if (accept || !requesterPlayerId) return;

    const requesterSocket = findSocketByPlayer(gameId, requesterPlayerId);
    requesterSocket?.emit("draw-offer-declined");
  });

  socket.on("disconnect", () => {
    const session = socketSessions.get(socket.id);
    socketSessions.delete(socket.id);
    if (!session) return;

    gameManager.handleDisconnect(session.gameId);
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

function findSocketByPlayer(gameId: string, playerId: string) {
  const sockets = io.sockets.adapter.rooms.get(gameId);
  if (!sockets) return null;

  for (const socketId of sockets) {
    const session = socketSessions.get(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (session?.playerId === playerId && socket) return socket;
  }

  return null;
}
