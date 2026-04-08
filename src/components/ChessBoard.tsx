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
  const [isResignConfirmOpen, setIsResignConfirmOpen] = useState(false);

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
  const isWaitingDrawResponse = Boolean(
    state &&
      state.mode === "pvp" &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      state.drawOfferFrom === state.playerColor,
  );
  const canResign = Boolean(state && state.playerColor !== "spectator" && !state.isGameOver);
  const isGameOver = state?.isGameOver ?? false;
  const boardOrientation = state?.playerColor === "black" ? "black" : "white";
  const topPlayer = getBoardSideLabel(state, boardOrientation === "white" ? "black" : "white");
  const bottomPlayer = getBoardSideLabel(state, boardOrientation);

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
      if (nextState.isGameOver && nextState.result) {
        setIsResultModalOpen(true);
      }
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
    if (isGameOver) {
      setIsResignConfirmOpen(false);
    }
  }, [isGameOver]);

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
  }

  function goHome() {
    router.push("/");
  }

  function confirmResign() {
    const socket = socketRef.current;
    const playerId = playerIdRef.current;
    if (!socket || !playerId) return;

    socket.emit("resign", { gameId, playerId });
    setIsResignConfirmOpen(false);
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

  return (
    <main className="page">
      <section className="panel game-panel">
        <div className="game-header">
          <div className="header-actions">
            <button type="button" onClick={goHome}>
              Voltar para home
            </button>
            {state?.mode === "pvp" ? (
              <button type="button" onClick={copyLink}>
                Copiar link
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="game-actions">
          <button type="button" onClick={() => setIsResignConfirmOpen(true)} disabled={!canResign}>
            Desistir
          </button>

          {canOfferDraw ? (
            <button type="button" onClick={offerDraw}>
              Pedir empate
            </button>
          ) : null}

        </div>

        {isResignConfirmOpen ? (
          <aside className="side-confirm">
            <p className="side-confirm-text">Tem certeza que deseja desistir da partida?</p>
            <div className="side-confirm-actions">
              <button type="button" onClick={confirmResign}>
                Confirmar desistência
              </button>
              <button type="button" onClick={() => setIsResignConfirmOpen(false)}>
                Cancelar
              </button>
            </div>
          </aside>
        ) : null}

        {isWaitingDrawResponse ? (
          <p className="game-note">Você ofereceu empate. Aguardando resposta do outro jogador.</p>
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
                Nova partida
              </button>
              <button type="button" onClick={goHome}>
                Voltar para a home
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {canRespondToDraw && state?.drawOfferFrom ? (
        <aside className="draw-offer-popup">
          <p className="draw-offer-text">O adversário ofereceu empate.</p>
          <div className="draw-offer-actions">
            <button type="button" onClick={() => respondToDrawOffer(true)}>
              Aceitar
            </button>
            <button type="button" onClick={() => respondToDrawOffer(false)}>
              Negar
            </button>
          </div>
        </aside>
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

function getResultTitle(result: GameResult, playerColor: GameState["playerColor"]) {
  if (result.reason === "agreed-draw") return "Empate por acordo";
  if (result.reason === "draw") return "Empate";
  if (result.reason === "checkmate") {
    return result.winner === "white"
      ? "Vitória das brancas por xeque-mate"
      : "Vitória das pretas por xeque-mate";
  }
  if (result.reason === "resign") {
    return result.winner === "white"
      ? "Vitória das brancas por desistência"
      : "Vitória das pretas por desistência";
  }
  return "Empate";
}

function getResultDescription(result: GameResult, playerColor: GameState["playerColor"]) {
  const perspectiveWinner =
    playerColor !== "spectator" && result.winner ? result.winner === playerColor : null;

  if (result.reason === "resign") {
    if (perspectiveWinner === true) return "O outro lado desistiu da partida.";
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

function getBoardSideLabel(state: GameState | null, color: PlayerColor) {
  if (!state) return "...";

  if (state.mode === "vs-bot") {
    return state.bot?.humanColor === color ? "Player 1" : "Stockfish";
  }

  return color === "white" ? "Player 1" : "Player 2";
}
