"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type * as cg from "chessground/types";
import { io, type Socket } from "socket.io-client";
import { getLegalDests, getPromotion } from "@/lib/chess";
import { getOrCreatePlayerId } from "@/lib/player";
import type { ClientToServerEvents, GameResult, GameState, PlayerColor, ServerToClientEvents } from "@/types/game";

type Props = {
  gameId: string;
};

type PendingPremove = {
  from: string;
  to: string;
};

export function ChessBoard({ gameId }: Props) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<Api | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPremove, setPendingPremove] = useState<PendingPremove | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/game/${gameId}`;
  }, [gameId]);

  const canInteractWithBoard = Boolean(
    state &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      !(state.mode === "vs-bot" && state.isBotThinking),
  );

  const currentPlayerId = playerIdRef.current;
  const canOfferDraw = Boolean(
    state &&
      currentPlayerId &&
      state.mode === "pvp" &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      !state.drawOfferFrom,
  );
  const canRespondToDraw = Boolean(
    state &&
      currentPlayerId &&
      state.mode === "pvp" &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      state.drawOfferFrom &&
      state.drawOfferFrom !== state.playerColor,
  );
  const resultReason = state?.result?.reason ?? null;
  const resultWinner = state?.result?.winner ?? null;
  const isGameOver = state?.isGameOver ?? false;
  const boardOrientation = state?.playerColor === "black" ? "black" : "white";
  const topPlayer = getBoardSidePlayer(state, currentPlayerId, boardOrientation === "white" ? "black" : "white");
  const bottomPlayer = getBoardSidePlayer(state, currentPlayerId, boardOrientation);

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
      orientation: boardOrientation,
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
  }, [boardOrientation, canInteractWithBoard, gameId, state]);

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

  useEffect(() => {
    if (isGameOver && resultReason) {
      setIsResultModalOpen(true);
    }
  }, [isGameOver, resultReason, resultWinner]);

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
  }

  function goHome() {
    router.push("/");
  }

  function resignGame() {
    const socket = socketRef.current;
    const playerId = playerIdRef.current;
    if (!socket || !playerId) return;

    socket.emit("resign", { gameId, playerId });
  }

  function offerDraw() {
    const socket = socketRef.current;
    const playerId = playerIdRef.current;
    if (!socket || !playerId) return;

    socket.emit("offer-draw", { gameId, playerId });
  }

  function respondToDrawOffer(accept: boolean) {
    const socket = socketRef.current;
    const playerId = playerIdRef.current;
    if (!socket || !playerId) return;

    socket.emit("respond-draw-offer", { gameId, playerId, accept });
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
          <div className="header-actions">
            <button type="button" onClick={goHome}>
              Voltar para home
            </button>
            <button type="button" onClick={copyLink}>
              Copiar link
            </button>
          </div>
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

        <div className="game-actions">
          <button
            type="button"
            onClick={resignGame}
            disabled={!state || state.playerColor === "spectator" || state.isGameOver || state.isBotThinking}
          >
            Desistir
          </button>

          {canOfferDraw ? (
            <button type="button" onClick={offerDraw}>
              Pedir empate
            </button>
          ) : null}

          {canRespondToDraw ? (
            <>
              <button type="button" onClick={() => respondToDrawOffer(true)}>
                Aceitar empate
              </button>
              <button type="button" onClick={() => respondToDrawOffer(false)}>
                Recusar empate
              </button>
            </>
          ) : null}
        </div>

        {state?.drawOfferFrom ? (
          <p className="game-note">{getDrawOfferText(state)}</p>
        ) : null}

        <div className="board-wrap">
          <p className="board-player board-player-top">{topPlayer}</p>
          <div ref={boardRef} className="chess-board" />
          <p className="board-player board-player-bottom">{bottomPlayer}</p>
        </div>
      </section>

      {isResultModalOpen && state?.result ? (
        <div className="modal-backdrop">
          <section className="modal-card">
            <p className="eyebrow">Fim da partida</p>
            <h2>{getResultTitle(state.result, state.playerColor)}</h2>
            <p className="lead modal-text">{getResultDescription(state.result, state.playerColor)}</p>
            <div className="modal-actions">
              <button type="button" onClick={goHome}>
                Voltar para home
              </button>
              <button type="button" onClick={goHome}>
                Nova partida
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
  if (state.result) return getResultStatusText(state.result);
  if (state.mode === "vs-bot" && state.isBotThinking) return "Stockfish está pensando...";
  if (state.isCheck) return `Xeque nas ${state.turn === "white" ? "brancas" : "pretas"}.`;
  return `Vez das ${state.turn === "white" ? "brancas" : "pretas"}.`;
}

function getResultTitle(result: GameResult, playerColor: GameState["playerColor"]) {
  if (playerColor !== "spectator" && result.winner === playerColor) return "Você venceu";
  if (playerColor !== "spectator" && result.winner && result.winner !== playerColor) return "Você perdeu";
  if (result.winner === "white") return "Vitória das brancas";
  if (result.winner === "black") return "Vitória das pretas";
  return "Empate";
}

function getResultDescription(result: GameResult, playerColor: GameState["playerColor"]) {
  const perspectiveWinner =
    playerColor !== "spectator" && result.winner ? result.winner === playerColor : null;

  if (result.reason === "resign") {
    if (perspectiveWinner === true) return "O outro lado desistiu. Vitória sua.";
    if (perspectiveWinner === false) return "Você desistiu da partida.";
    return result.winner === "white"
      ? "As pretas desistiram. Vitória das brancas."
      : "As brancas desistiram. Vitória das pretas.";
  }

  if (result.reason === "agreed-draw") {
    return "Partida empatada por acordo entre os jogadores.";
  }

  if (result.reason === "checkmate") {
    if (perspectiveWinner === true) return "Xeque-mate. Vitória sua.";
    if (perspectiveWinner === false) return "Xeque-mate. Derrota sua.";
    return result.winner === "white"
      ? "Xeque-mate. Vitória das brancas."
      : "Xeque-mate. Vitória das pretas.";
  }

  return "Partida empatada.";
}

function getResultStatusText(result: GameResult) {
  if (result.reason === "resign") {
    return result.winner === "white"
      ? "Partida encerrada por desistência. Vitória das brancas."
      : "Partida encerrada por desistência. Vitória das pretas.";
  }

  if (result.reason === "agreed-draw") {
    return "Partida empatada por acordo.";
  }

  if (result.reason === "checkmate") {
    return result.winner === "white"
      ? "Xeque-mate. Vitória das brancas."
      : "Xeque-mate. Vitória das pretas.";
  }

  return "Partida empatada.";
}

function getDrawOfferText(state: GameState) {
  if (!state.drawOfferFrom) return "";

  if (state.playerColor === state.drawOfferFrom) {
    return "Você ofereceu empate. Aguardando resposta do outro jogador.";
  }

  return `As ${roleLabel(state.drawOfferFrom)} ofereceram empate.`;
}

function getBoardSidePlayer(
  state: GameState | null,
  currentPlayerId: string | null,
  color: PlayerColor,
) {
  if (!state) return "...";

  const playerId = state.playerIds?.[color] ?? null;
  if (!playerId) return `${colorLabel(color)}: aguardando`;
  if (playerId === currentPlayerId) return `${colorLabel(color)}: você`;
  if (playerId === "stockfish") return `${colorLabel(color)}: Stockfish`;
  return `${colorLabel(color)}: ${shortPlayerId(playerId)}`;
}

function colorLabel(color: PlayerColor) {
  return color === "white" ? "Brancas" : "Pretas";
}

function shortPlayerId(playerId: string) {
  return playerId.slice(0, 8);
}
