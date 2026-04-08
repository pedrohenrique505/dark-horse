import test from "node:test";
import assert from "node:assert/strict";
import { createGameManager } from "./game-manager";
import type { StockfishRequest, EngineMove } from "./services/stockfish";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createHarness(options?: {
  requestBotMove?(request: StockfishRequest): Promise<EngineMove | null>;
  random?(): number;
}) {
  const rejectedMoves: Array<{ gameId: string; playerId: string | null; reason: string }> = [];
  const roomUpdates: string[] = [];
  const playerUpdates: Array<{ gameId: string; playerId: string }> = [];
  const botRequests: StockfishRequest[] = [];

  const manager = createGameManager({
    async requestBotMove(request) {
      botRequests.push(request);
      if (options?.requestBotMove) {
        return options.requestBotMove(request);
      }

      return { from: "e7", to: "e5" };
    },
    emitRoomState(gameId) {
      roomUpdates.push(gameId);
    },
    emitPlayerState(gameId, playerId) {
      playerUpdates.push({ gameId, playerId });
    },
    emitMoveRejected(gameId, playerId, reason) {
      rejectedMoves.push({ gameId, playerId, reason });
    },
    random: options?.random,
  });

  return { manager, rejectedMoves, roomUpdates, playerUpdates, botRequests };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function lastPgnLine(value: string) {
  return value.trim().split("\n").at(-1) ?? "";
}

test("cria partida vs-bot, marca thinking e aplica resposta do bot", async () => {
  const botReply = createDeferred<EngineMove | null>();
  const { manager } = createHarness({
    requestBotMove: () => botReply.promise,
  });

  const room = manager.createGame({ mode: "vs-bot", botDifficulty: "medium", humanColor: "white" });
  manager.joinGame(room.id, "human-1");

  const initialState = manager.buildGameState(room.id, "human-1");
  assert.ok(initialState);
  assert.equal(initialState.mode, "vs-bot");
  assert.deepEqual(initialState.bot, { difficulty: "medium", humanColor: "white" });
  assert.equal(initialState.turn, "white");
  assert.equal(initialState.playerColor, "white");

  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "e2", to: "e4" });

  const thinkingState = manager.buildGameState(room.id, "human-1");
  assert.ok(thinkingState);
  assert.equal(thinkingState.isBotThinking, true);
  assert.equal(thinkingState.turn, "black");
  assert.equal(lastPgnLine(thinkingState.pgn), "1. e4 *");

  botReply.resolve({ from: "e7", to: "e5" });
  await flushAsyncWork();

  const finalState = manager.buildGameState(room.id, "human-1");
  assert.ok(finalState);
  assert.equal(finalState.isBotThinking, false);
  assert.equal(finalState.turn, "white");
  assert.equal(lastPgnLine(finalState.pgn), "1. e4 e5 *");
});

test("usa a dificuldade escolhida ao pedir jogada para o bot", async () => {
  const botReply = createDeferred<EngineMove | null>();
  const { manager, botRequests } = createHarness({
    requestBotMove: () => botReply.promise,
  });

  const room = manager.createGame({ mode: "vs-bot", botDifficulty: "hard", humanColor: "white" });
  manager.joinGame(room.id, "human-1");
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "d2", to: "d4" });

  assert.deepEqual(botRequests.at(-1), {
    fen: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1",
    skillLevel: 12,
    moveTimeMs: 600,
  });

  botReply.resolve({ from: "d7", to: "d5" });
  await flushAsyncWork();
});

test("quando humano escolhe black, o bot joga primeiro no servidor", async () => {
  const botReply = createDeferred<EngineMove | null>();
  const { manager } = createHarness({
    requestBotMove: () => botReply.promise,
  });

  const room = manager.createGame({ mode: "vs-bot", botDifficulty: "easy", humanColor: "black" });

  const stateBeforeBotMove = manager.buildGameState(room.id, "spectator");
  assert.ok(stateBeforeBotMove);
  assert.equal(stateBeforeBotMove.isBotThinking, true);
  assert.equal(stateBeforeBotMove.turn, "white");

  manager.joinGame(room.id, "human-1");
  const joinedState = manager.buildGameState(room.id, "human-1");
  assert.ok(joinedState);
  assert.equal(joinedState.playerColor, "black");

  botReply.resolve({ from: "e2", to: "e4" });
  await flushAsyncWork();

  const finalState = manager.buildGameState(room.id, "human-1");
  assert.ok(finalState);
  assert.equal(finalState.isBotThinking, false);
  assert.equal(finalState.turn, "black");
  assert.equal(lastPgnLine(finalState.pgn), "1. e4 *");
});

test("reseta isBotThinking quando a engine falha", async () => {
  const { manager, rejectedMoves } = createHarness({
    requestBotMove: async () => {
      throw new Error("engine failed");
    },
  });

  const room = manager.createGame({ mode: "vs-bot", humanColor: "white" });
  manager.joinGame(room.id, "human-1");
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "e2", to: "e4" });
  await flushAsyncWork();

  const state = manager.buildGameState(room.id, "human-1");
  assert.ok(state);
  assert.equal(state.isBotThinking, false);
  assert.equal(lastPgnLine(state.pgn), "1. e4 *");
  assert.equal(rejectedMoves.at(-1)?.reason, "Não foi possível obter a resposta do Stockfish.");
});

test("reseta isBotThinking quando a engine retorna jogada inválida", async () => {
  const { manager, rejectedMoves } = createHarness({
    requestBotMove: async () => ({ from: "a2", to: "a3" }),
  });

  const room = manager.createGame({ mode: "vs-bot", humanColor: "white" });
  manager.joinGame(room.id, "human-1");
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "e2", to: "e4" });
  await flushAsyncWork();

  const state = manager.buildGameState(room.id, "human-1");
  assert.ok(state);
  assert.equal(state.isBotThinking, false);
  assert.equal(lastPgnLine(state.pgn), "1. e4 *");
  assert.equal(rejectedMoves.at(-1)?.reason, "Não foi possível obter a resposta do Stockfish.");
});

test("ignora resposta atrasada do bot quando o estado da partida mudou", async () => {
  const botReply = createDeferred<EngineMove | null>();
  const { manager, roomUpdates } = createHarness({
    requestBotMove: () => botReply.promise,
  });

  const room = manager.createGame({ mode: "vs-bot", humanColor: "white" });
  manager.joinGame(room.id, "human-1");
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "e2", to: "e4" });

  const internalRoom = manager.getRoom(room.id);
  assert.ok(internalRoom);
  internalRoom.chess.move({ from: "c7", to: "c5" });

  botReply.resolve({ from: "e7", to: "e5" });
  await flushAsyncWork();

  const state = manager.buildGameState(room.id, "human-1");
  assert.ok(state);
  assert.equal(state.isBotThinking, false);
  assert.equal(lastPgnLine(state.pgn), "1. e4 c5 *");
  assert.ok(roomUpdates.length >= 2);
});

test("rejeita spam de jogadas humanas enquanto o bot está pensando", () => {
  const botReply = createDeferred<EngineMove | null>();
  const { manager, rejectedMoves } = createHarness({
    requestBotMove: () => botReply.promise,
  });

  const room = manager.createGame({ mode: "vs-bot", humanColor: "white" });
  manager.joinGame(room.id, "human-1");
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "e2", to: "e4" });
  manager.makeMove({ gameId: room.id, playerId: "human-1", from: "d2", to: "d4" });

  assert.equal(rejectedMoves.at(-1)?.reason, "Aguarde a resposta do Stockfish.");
});
