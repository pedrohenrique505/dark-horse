import initStockfish from "stockfish";

type StockfishEngine = {
  listener?: (line: string) => void;
  sendCommand(command: string): void;
  terminate?(): void;
};

export type EngineMove = {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};

export type StockfishRequest = {
  fen: string;
  moveTimeMs: number;
  skillLevel: number;
};

let enginePromise: Promise<StockfishEngine> | null = null;
let queue = Promise.resolve();

export async function getBestMove(request: StockfishRequest): Promise<EngineMove | null> {
  return enqueue(async () => {
    const engine = await getEngine();

    try {
      return await requestBestMove(engine, request);
    } catch (error) {
      resetEngine(engine);
      throw error;
    }
  });
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  // A engine é compartilhada por todas as partidas. A fila evita misturar respostas.
  const nextTask = queue.then(task, task);
  queue = nextTask.then(
    () => undefined,
    () => undefined,
  );

  return nextTask;
}

async function getEngine(): Promise<StockfishEngine> {
  if (!enginePromise) {
    enginePromise = createEngine();
  }

  return enginePromise;
}

async function createEngine(): Promise<StockfishEngine> {
  const engine = await initStockfish("lite-single");

  await waitForLine(engine, (line) => line === "uciok", () => {
    engine.sendCommand("uci");
  });

  return engine;
}

function requestBestMove(engine: StockfishEngine, request: StockfishRequest): Promise<EngineMove | null> {
  return waitForLine(
    engine,
    (line) => line.startsWith("bestmove "),
    () => {
      engine.sendCommand("ucinewgame");
      engine.sendCommand(`setoption name Skill Level value ${request.skillLevel}`);
      engine.sendCommand(`position fen ${request.fen}`);
      engine.sendCommand("isready");
    },
    {
      onLine(line) {
        if (line === "readyok") {
          engine.sendCommand(`go movetime ${request.moveTimeMs}`);
        }
      },
      timeoutMs: 10_000,
    },
  ).then(parseBestMove);
}

function waitForLine(
  engine: StockfishEngine,
  matchLine: (line: string) => boolean,
  start: () => void,
  options?: {
    onLine?: (line: string) => void;
    timeoutMs?: number;
  },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 5_000;

  return new Promise((resolve, reject) => {
    const previousListener = engine.listener;
    const timeout = setTimeout(() => {
      engine.listener = previousListener;
      reject(new Error("Stockfish demorou para responder."));
    }, timeoutMs);

    engine.listener = (line) => {
      const trimmedLine = line.trim();

      previousListener?.(line);
      options?.onLine?.(trimmedLine);

      if (!matchLine(trimmedLine)) return;

      clearTimeout(timeout);
      engine.listener = previousListener;
      resolve(trimmedLine);
    };

    start();
  });
}

function parseBestMove(line: string): EngineMove | null {
  const parts = line.trim().split(/\s+/);
  const bestMove = parts[1];

  if (!bestMove || bestMove === "(none)") return null;
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestMove)) {
    throw new Error(`Stockfish retornou um bestmove inválido: ${bestMove}`);
  }

  return {
    from: bestMove.slice(0, 2),
    to: bestMove.slice(2, 4),
    promotion: parsePromotion(bestMove.slice(4, 5)),
  };
}

function parsePromotion(value: string): EngineMove["promotion"] {
  if (value === "q" || value === "r" || value === "b" || value === "n") {
    return value;
  }

  return undefined;
}

function resetEngine(engine: StockfishEngine) {
  engine.listener = undefined;
  engine.terminate?.();
  enginePromise = null;
}
