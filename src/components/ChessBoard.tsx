"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type * as cg from "chessground/types";
import { io, type Socket } from "socket.io-client";
import { getLegalDests, getPromotion } from "@/lib/chess";
import { getOrCreatePlayerId } from "@/lib/player";
import type { ClientToServerEvents, GameState, PlayerColor, ServerToClientEvents } from "@/types/game";

type Props = {
  gameId: string;
};

type PendingPremove = {
  from: string;
  to: string;
};

export function ChessBoard({ gameId }: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<Api | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPremove, setPendingPremove] = useState<PendingPremove | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/game/${gameId}`;
  }, [gameId]);

  const canInteractWithBoard = Boolean(
    state && state.playerColor !== "spectator" && !(state.mode === "vs-bot" && state.isBotThinking),
  );

  useEffect(() => {
    const playerId = getOrCreatePlayerId();
    playerIdRef.current = playerId;

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-game", { gameId, playerId });
      setState((current) => (current ? { ...current, connected: true } : current));
    });

    socket.on("disconnect", () => {
      setState((current) => (current ? { ...current, connected: false } : current));
    });

    socket.on("game-state", (nextState) => {
      setState(nextState);
      setError(null);
    });

    socket.on("move-rejected", ({ reason }) => setError(reason));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [gameId]);

  useEffect(() => {
    if (!boardRef.current || !state) return;

    const onMove = (orig: cg.Key, dest: cg.Key) => {
      const socket = socketRef.current;
      const playerId = playerIdRef.current;
      if (!socket || !playerId) return;

      socket.emit("make-move", {
        gameId,
        playerId,
        from: orig,
        to: dest,
        promotion: getPromotion(orig, dest, state.fen),
      });
    };

    const onPremove = (orig: cg.Key, dest: cg.Key) => {
      setPendingPremove({ from: orig, to: dest });
    };

    const config: Config = {
      fen: state.fen,
      orientation: state.playerColor === "black" ? "black" : "white",
      turnColor: state.turn,
      check: state.isCheck,
      lastMove: state.lastMove as cg.Key[] | undefined,
      coordinates: true,
      highlight: {
        lastMove: true,
        check: true,
      },
      movable: {
        free: false,
        color: getMovableColor(state, canInteractWithBoard),
        dests: getLegalDests(state.fen),
        showDests: true,
        events: {
          after: onMove,
        },
      },
      premovable: {
        enabled: canInteractWithBoard,
        showDests: true,
        castle: true,
        events: {
          set: onPremove,
          unset: () => setPendingPremove(null),
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        eraseOnClick: true,
      },
      draggable: {
        enabled: true,
        showGhost: true,
      },
    };

    if (!chessgroundRef.current) {
      chessgroundRef.current = Chessground(boardRef.current, config);
      return;
    }

    chessgroundRef.current.set(config);
  }, [canInteractWithBoard, gameId, state]);

  useEffect(() => {
    if (!state || !pendingPremove || state.playerColor !== state.turn) return;

    const socket = socketRef.current;
    const playerId = playerIdRef.current;
    if (!socket || !playerId) return;

    socket.emit("make-move", {
      gameId,
      playerId,
      from: pendingPremove.from,
      to: pendingPremove.to,
      promotion: getPromotion(pendingPremove.from, pendingPremove.to, state.fen),
    });

    chessgroundRef.current?.cancelPremove();
    setPendingPremove(null);
  }, [gameId, pendingPremove, state]);

  useEffect(() => {
    return () => chessgroundRef.current?.destroy();
  }, []);

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
  }

  const status = state ? getStatusText(state) : "Conectando...";

  return (
    <main className="page">
      <section className="panel game-panel">
        <div className="game-header">
          <div>
            <p className="eyebrow">Partida {gameId}</p>
            <h1>Dark Horse Chess</h1>
          </div>
          <button type="button" onClick={copyLink}>
            Copiar link
          </button>
        </div>

        <div className="status-grid">
          <span>{status}</span>
          <span>Modo: {state ? modeLabel(state.mode) : "..."}</span>
          {state?.bot ? <span>Bot: {botSummary(state)}</span> : null}
          <span>Você: {state ? roleLabel(state.playerColor) : "..."}</span>
          <span>{state?.connected ? "Conectado" : "Desconectado"}</span>
          <span>{playerSlotLabel(state, "white")}</span>
          <span>{playerSlotLabel(state, "black")}</span>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {pendingPremove ? (
          <p className="hint">Pre-move salvo: {pendingPremove.from} → {pendingPremove.to}</p>
        ) : null}

        <div className="board-wrap">
          <div ref={boardRef} className="chess-board" />
        </div>

        <p className="hint">
          Dica: arraste ou clique nas peças para jogar. Use o botão direito no tabuleiro para desenhar setas.
        </p>
      </section>
    </main>
  );
}

function roleLabel(role: GameState["playerColor"]) {
  if (role === "white") return "brancas";
  if (role === "black") return "pretas";
  return "espectador";
}

function getMovableColor(state: GameState, canInteractWithBoard: boolean): PlayerColor | undefined {
  if (!canInteractWithBoard) return undefined;
  if (state.playerColor === "spectator") return undefined;
  return state.playerColor;
}

function modeLabel(mode: GameState["mode"]) {
  if (mode === "vs-bot") return "contra Stockfish";
  return "online";
}

function botSummary(state: GameState) {
  return `${state.bot?.difficulty} | humano de ${roleLabel(state.bot?.humanColor ?? "white")}`;
}

function playerSlotLabel(state: GameState | null, color: PlayerColor) {
  const colorLabel = color === "white" ? "Brancas" : "Pretas";
  if (!state) return `${colorLabel}: ...`;

  if (state.mode === "vs-bot") {
    const occupant = state.bot?.humanColor === color ? "humano" : "Stockfish";
    return `${colorLabel}: ${occupant}`;
  }

  return `${colorLabel}: ${state.players[color] ? "online/ocupado" : "aguardando"}`;
}

function getStatusText(state: GameState) {
  if (state.isCheckmate) return `Xeque-mate. Vitória das ${state.turn === "white" ? "pretas" : "brancas"}.`;
  if (state.isDraw) return "Partida empatada.";
  if (state.mode === "vs-bot" && state.isBotThinking) return "Stockfish está pensando...";
  if (state.isCheck) return `Xeque nas ${state.turn === "white" ? "brancas" : "pretas"}.`;
  return `Vez das ${state.turn === "white" ? "brancas" : "pretas"}.`;
}
