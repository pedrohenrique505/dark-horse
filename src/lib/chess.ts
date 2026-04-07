import { Chess, type Square } from "chess.js";
import type * as cg from "chessground/types";

export function getLegalDests(fen: string): cg.Dests {
  const chess = new Chess(fen);
  const dests = new Map() as cg.Dests;

  for (const move of chess.moves({ verbose: true })) {
    const from = move.from as cg.Key;
    const moves = dests.get(from) ?? [];
    moves.push(move.to as cg.Key);
    dests.set(from, moves);
  }

  return dests;
}

export function getPromotion(from: string, to: string, fen: string): "q" | undefined {
  const chess = new Chess(fen);
  const piece = chess.get(from as Square);
  const reachesLastRank = to.endsWith("8") || to.endsWith("1");

  return piece?.type === "p" && reachesLastRank ? "q" : undefined;
}
