"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameMode } from "@/types/game";

export default function HomePage() {
  const router = useRouter();
  const [gameId, setGameId] = useState("");
  const [loading, setLoading] = useState(false);

  async function createGame(mode: GameMode) {
    setLoading(true);
    const response = await fetch("/api/games", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });
    const data = (await response.json()) as { id: string };
    router.push(`/game/${data.id}`);
  }

  function joinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = gameId.trim();
    if (trimmed) router.push(`/game/${trimmed}`);
  }

  return (
    <main className="page">
      <section className="panel home-panel">
        <p className="eyebrow">MVP</p>
        <h1>Dark Horse Chess</h1>
        <p className="lead">
          Crie uma partida para jogar online com outra pessoa ou inicie uma partida simples contra o
          Stockfish.
        </p>

        <div className="home-actions">
          <button type="button" onClick={() => createGame("pvp")} disabled={loading}>
            {loading ? "Criando..." : "Criar partida online"}
          </button>

          <button type="button" onClick={() => createGame("vs-bot")} disabled={loading}>
            {loading ? "Criando..." : "Jogar contra Stockfish"}
          </button>
        </div>

        <form onSubmit={joinGame} className="join-form">
          <label htmlFor="gameId">Entrar com ID da partida</label>
          <div>
            <input
              id="gameId"
              value={gameId}
              onChange={(event) => setGameId(event.target.value)}
              placeholder="ex: a1b2c3d4"
            />
            <button type="submit">Entrar</button>
          </div>
        </form>
      </section>
    </main>
  );
}
