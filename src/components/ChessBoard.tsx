"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type * as cg from "chessground/types";
import { io, type Socket } from "socket.io-client";
import { Chess } from "chess.js";
import { getLegalDests, getPromotion } from "@/lib/chess";
import { getOrCreatePlayerId } from "@/lib/player";
import type {
  ClientToServerEvents,
  GameResult,
  GameState,
  MoveHistoryEntry,
  PlayerColor,
  ServerToClientEvents,
} from "@/types/game";

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
  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<Api | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPremove, setPendingPremove] = useState<PendingPremove | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [isResignConfirmOpen, setIsResignConfirmOpen] = useState(false);
  const [isDrawOfferPopupOpen, setIsDrawOfferPopupOpen] = useState(false);
  const [drawFeedback, setDrawFeedback] = useState<string | null>(null);
  const [boardSize, setBoardSize] = useState<number | null>(null);
  const [viewedPly, setViewedPly] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousStateRef = useRef<GameState | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/game/${gameId}`;
  }, [gameId]);

  const canInteractWithBoard = Boolean(
    state &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      viewedPly === state.moveHistory.length &&
      !(state.mode === "vs-bot" && state.isBotThinking),
  );

  const currentPlayerId = playerIdRef.current;
  const canOfferDraw = Boolean(
    state &&
      currentPlayerId &&
      state.mode === "pvp" &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      !state.drawOfferFrom &&
      state.drawRequests[state.playerColor] < 2,
  );
  const canRespondToDraw = Boolean(
    state &&
      state.mode === "pvp" &&
      state.playerColor !== "spectator" &&
      !state.isGameOver &&
      state.drawOfferFrom,
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
  const displayedPosition = getDisplayedPosition(state, viewedPly);
  const moveRows = groupMoveHistory(state?.moveHistory ?? []);
  const boardFiles = getBoardFiles(boardOrientation);
  const boardRanks = getBoardRanks(boardOrientation);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const livePly = state?.moveHistory.length ?? 0;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setViewedPly((current) => Math.max(0, current - 1));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setViewedPly((current) => Math.min(livePly, current + 1));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state]);

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
      const previousState = previousStateRef.current;
      setState(nextState);
      setError(null);
      const previousMoveCount = previousState?.moveHistory.length ?? 0;
      const nextMoveCount = nextState.moveHistory.length;

      if (!previousState || nextMoveCount !== previousMoveCount) {
        setViewedPly(nextMoveCount);
      }

      if (nextState.isGameOver && nextState.result) {
        setIsResultModalOpen(true);
        setIsDrawOfferPopupOpen(false);
      }
      if (!nextState.drawOfferFrom) {
        setIsDrawOfferPopupOpen(false);
      }
      playStateSound(previousState, nextState, audioContextRef);
      previousStateRef.current = nextState;
    });

    socket.on("move-rejected", ({ reason }) => setError(reason));
    socket.on("draw-offer-received", () => {
      setIsDrawOfferPopupOpen(true);
    });
    socket.on("draw-offer-declined", () => {
      setDrawFeedback("Seu pedido de empate foi recusado.");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [gameId]);

  useEffect(() => {
    const boardStage = boardStageRef.current;
    if (!boardStage) return;

    const updateBoardSize = () => {
      const nextSize = Math.max(0, Math.floor(Math.min(boardStage.clientWidth, boardStage.clientHeight)));
      setBoardSize((current) => (current === nextSize ? current : nextSize));
    };

    updateBoardSize();

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateBoardSize);
    });

    observer.observe(boardStage);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!boardSize) return;
    chessgroundRef.current?.redrawAll();
  }, [boardSize]);

  useEffect(() => {
    const historyList = historyListRef.current;
    if (!historyList) return;
    if (viewedPly !== (state?.moveHistory.length ?? 0)) return;

    historyList.scrollTop = historyList.scrollHeight;
  }, [state?.moveHistory.length, viewedPly]);

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
      fen: displayedPosition.fen,
      orientation: boardOrientation,
      turnColor: displayedPosition.turn,
      check: displayedPosition.isCheck,
      lastMove: displayedPosition.lastMove,
      coordinates: false,
      highlight: {
        lastMove: true,
        check: true,
      },
      movable: {
        free: false,
        color: getMovableColor(state, canInteractWithBoard),
        dests: getLegalDests(displayedPosition.fen),
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
  }, [boardOrientation, canInteractWithBoard, displayedPosition, gameId, state]);

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

  useEffect(() => {
    if (!drawFeedback) return;

    const timeout = window.setTimeout(() => {
      setDrawFeedback(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [drawFeedback]);

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
      <section className="game-panel">
        <button type="button" className="back-button" onClick={goHome} aria-label="Voltar para home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 6 9 12l6 6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>

        {error ? <p className="error">{error}</p> : null}

        {isWaitingDrawResponse ? (
          <p className="game-note">Você ofereceu empate. Aguardando resposta do outro jogador.</p>
        ) : null}

        {drawFeedback ? (
          <p className="game-note">{drawFeedback}</p>
        ) : null}

        <div className="board-layout">
          <div className="board-wrap" style={boardSize ? ({ "--board-size": `${boardSize}px` } as CSSProperties) : undefined}>
            <p className="board-player board-player-top">{topPlayer}</p>
            <div className="board-stage">
              <div className="board-frame">
                <div className="board-files board-files-top" aria-hidden="true">
                  {boardFiles.map((file) => (
                    <span key={`top-${file}`}>{file}</span>
                  ))}
                </div>
                <div className="board-ranks board-ranks-left" aria-hidden="true">
                  {boardRanks.map((rank) => (
                    <span key={`left-${rank}`}>{rank}</span>
                  ))}
                </div>
                <div ref={boardStageRef} className="board-core">
                  <div
                    ref={boardRef}
                    className="chess-board"
                    style={boardSize ? { width: `${boardSize}px`, height: `${boardSize}px` } : undefined}
                  />
                </div>
                <div className="board-ranks board-ranks-right" aria-hidden="true">
                  {boardRanks.map((rank) => (
                    <span key={`right-${rank}`}>{rank}</span>
                  ))}
                </div>
                <div className="board-files board-files-bottom" aria-hidden="true">
                  {boardFiles.map((file) => (
                    <span key={`bottom-${file}`}>{file}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="board-player board-player-bottom">{bottomPlayer}</p>
          </div>

          <aside className="board-side-actions">
            <section className="history-panel">
              <p className="history-title">Histórico</p>
              <div className="history-table-head" aria-hidden="true">
                <span>#</span>
                <span>White</span>
                <span>Black</span>
              </div>
              <div ref={historyListRef} className="history-list">
                {moveRows.length === 0 ? (
                  <p className="history-empty">Nenhum lance ainda.</p>
                ) : (
                  moveRows.map((row) => (
                    <HistoryRow key={row.moveNumber} row={row} viewedPly={viewedPly} onSelectPly={setViewedPly} />
                  ))
                )}
              </div>
            </section>

            <div className="history-actions">
              <button type="button" className="action-button" onClick={() => setIsResignConfirmOpen(true)} disabled={!canResign}>
                <span className="action-button-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M7 4v16M7 5h9l-2.5 3L16 11H7"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.9"
                    />
                  </svg>
                </span>
                <span>Desistir</span>
              </button>

              <div className={isResignConfirmOpen ? "action-confirm action-confirm-visible" : "action-confirm"}>
                <p className="action-confirm-text">Tem certeza que deseja desistir da partida?</p>
                <div className="action-confirm-actions">
                  <button type="button" onClick={confirmResign}>
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setIsResignConfirmOpen(false)}>
                    Cancelar
                  </button>
                </div>
              </div>

              {canOfferDraw ? (
                <button type="button" className="action-button" onClick={offerDraw}>
                  <span className="action-button-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M8 12 5.5 9.5a2.5 2.5 0 1 1 3.5-3.5L12 9l3-3a2.5 2.5 0 1 1 3.5 3.5L16 12M8 12l4 4 4-4M8 12l-1.5 1.5a2.5 2.5 0 1 0 3.5 3.5L12 15l2 2a2.5 2.5 0 1 0 3.5-3.5L16 12"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </span>
                  <span>Pedir empate</span>
                </button>
              ) : null}

              {state?.mode === "pvp" ? (
                <button type="button" onClick={copyLink}>
                  Copiar link
                </button>
              ) : null}
            </div>
          </aside>
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

      {isDrawOfferPopupOpen && canRespondToDraw && state?.drawOfferFrom ? (
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

function getBoardFiles(orientation: PlayerColor) {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  return orientation === "white" ? files : [...files].reverse();
}

function getBoardRanks(orientation: PlayerColor) {
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];
  return orientation === "white" ? ranks : [...ranks].reverse();
}

function getDisplayedPosition(state: GameState | null, viewedPly: number) {
  if (!state) {
    return {
      fen: "",
      turn: "white" as PlayerColor,
      isCheck: false,
      lastMove: undefined as cg.Key[] | undefined,
    };
  }

  const moveHistory = state.moveHistory;
  const selectedMove = viewedPly > 0 ? moveHistory[viewedPly - 1] : null;
  const fen = selectedMove ? selectedMove.afterFen : moveHistory[0]?.beforeFen ?? state.fen;
  const chess = new Chess(fen);

  return {
    fen,
    turn: fen.includes(" w ") ? "white" as PlayerColor : "black" as PlayerColor,
    isCheck: chess.isCheck(),
    lastMove: selectedMove ? [selectedMove.from, selectedMove.to] as cg.Key[] : undefined,
  };
}

function groupMoveHistory(moveHistory: MoveHistoryEntry[]) {
  const rows: Array<{
    moveNumber: number;
    white: MoveHistoryEntry;
    black?: MoveHistoryEntry;
  }> = [];

  for (let index = 0; index < moveHistory.length; index += 2) {
    const white = moveHistory[index];
    if (!white) break;

    rows.push({
      moveNumber: white.moveNumber,
      white,
      black: moveHistory[index + 1],
    });
  }

  return rows;
}

function getHistoryButtonClassName(isActive: boolean) {
  return isActive ? "history-move history-move-active" : "history-move";
}

function HistoryRow({
  row,
  viewedPly,
  onSelectPly,
}: {
  row: {
    moveNumber: number;
    white: MoveHistoryEntry;
    black?: MoveHistoryEntry;
  };
  viewedPly: number;
  onSelectPly(nextPly: number): void;
}) {
  return (
    <div className="history-row">
      <span className="history-move-number">{row.moveNumber}.</span>
      <button
        type="button"
        className={getHistoryButtonClassName(viewedPly === row.white.ply)}
        onClick={() => onSelectPly(row.white.ply)}
      >
        {row.white.san}
      </button>
      {row.black ? (
        <button
          type="button"
          className={getHistoryButtonClassName(viewedPly === row.black.ply)}
          onClick={() => onSelectPly(row.black!.ply)}
        >
          {row.black.san}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function playStateSound(
  previousState: GameState | null,
  nextState: GameState,
  audioContextRef: RefObject<AudioContext | null>,
) {
  if (!previousState) return;
  if (previousState.fen === nextState.fen) return;

  const isGameOverNow = !previousState.isGameOver && nextState.isGameOver;
  if (isGameOverNow) {
    playTone(audioContextRef, 520, 0.28, "triangle");
    return;
  }

  const previousPieces = countPieces(previousState.fen);
  const nextPieces = countPieces(nextState.fen);
  const isCapture = nextPieces < previousPieces;

  if (isCapture) {
    playTone(audioContextRef, 280, 0.12, "square");
    return;
  }

  playTone(audioContextRef, 420, 0.1, "sine");
}

function countPieces(fen: string) {
  return fen.split(" ")[0].replace(/\//g, "").replace(/[1-8]/g, "").length;
}

function playTone(
  audioContextRef: RefObject<AudioContext | null>,
  frequency: number,
  duration: number,
  type: OscillatorType,
) {
  if (typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = audioContextRef.current ?? new AudioContextClass();
  audioContextRef.current = context;

  if (context.state === "suspended") {
    void context.resume();
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const now = context.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}
