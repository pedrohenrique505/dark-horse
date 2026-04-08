import initStockfish from "stockfish";

type StockfishEngine = {
  listener?: (line: string) => void;
  sendCommand(command: string): void;
};

type EngineMove = {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};

let enginePromise: Promise<StockfishEngine> | null = null;
let queue = Promise.resolve();

export async function getBestMove(fen: string): Promise<EngineMove | null> {
  return enqueue(async () => {
    const engine = await getEngine();
    return requestBestMove(engine, fen);
  });
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
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

  engine.sendCommand("setoption name Skill Level value 5");
  return engine;
}

function requestBestMove(engine: StockfishEngine, fen: string): Promise<EngineMove | null> {
  return waitForLine(
    engine,
    (line) => line.startsWith("bestmove "),
    () => {
      engine.sendCommand("ucinewgame");
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand("isready");
    },
    {
      onLine(line) {
        if (line === "readyok") {
          engine.sendCommand("go movetime 250");
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
      previousListener?.(line);
      options?.onLine?.(line);

      if (!matchLine(line)) return;

      clearTimeout(timeout);
      engine.listener = previousListener;
      resolve(line);
    };

    start();
  });
}

function parseBestMove(line: string): EngineMove | null {
  const parts = line.trim().split(/\s+/);
  const bestMove = parts[1];

  if (!bestMove || bestMove === "(none)") return null;

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
