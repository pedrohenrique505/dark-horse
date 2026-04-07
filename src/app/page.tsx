"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [gameId, setGameId] = useState("");
  const [loading, setLoading] = useState(false);

  async function createGame() {
    setLoading(true);
    const response = await fetch("/api/games", { method: "POST" });
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
        <p className="lead">Crie uma partida e envie o link para outro jogador entrar em tempo real.</p>

        <button type="button" onClick={createGame} disabled={loading}>
          {loading ? "Criando..." : "Criar partida"}
        </button>

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
