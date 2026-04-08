# Dark Horse Chess

MVP de um site de xadrez online com dois modos:

- `pvp`: jogar contra outra pessoa em tempo real.
- `vs-bot`: jogar contra o Stockfish rodando no servidor.

## Stack

- Next.js + React + TypeScript no frontend
- Chessground para o tabuleiro interativo
- chess.js para regras e validação das jogadas
- Socket.IO para sincronização em tempo real
- Node.js com estado em memória no servidor

## Como instalar

```bash
npm install
```

## Como rodar

```bash
npm run dev
```

Depois abra `http://localhost:3000`.

## Como rodar os testes do servidor

```bash
npm run test:server
```

## Como testar o MVP

1. Abra a página inicial em um navegador.
2. Clique em `Criar partida online`.
3. Copie o link da partida.
4. Abra o link em outro navegador ou aba anônima.
5. Faça uma jogada com as brancas e confirme que ela aparece para as pretas.
5. Tente uma jogada ilegal e veja que o servidor rejeita.
6. Quando não for sua vez, selecione uma peça sua e faça um pre-move básico.
7. Use o botão direito no tabuleiro para desenhar setas.
8. Recarregue a página da partida e confirme que ela reconecta na mesma sala.
9. Teste `Pedir empate`, `Aceitar empate`, `Recusar empate` e `Desistir`.

## Como testar o modo vs-bot

1. Abra a página inicial em um navegador.
2. Clique em `Jogar contra Stockfish`.
3. Escolha a dificuldade (`easy`, `medium` ou `hard`).
4. Escolha a sua cor (`white`, `black` ou `random`).
5. Se você jogar de `white`, faça uma jogada e confirme que o status mostra `Stockfish está pensando...`.
6. Se você jogar de `black`, confirme que o bot faz a primeira jogada no servidor antes da sua vez.
7. Aguarde a resposta e confirme que o tabuleiro recebe a jogada automática do Stockfish.
8. Teste o botão `Desistir` e confirme que o modal mostra a vitória do Stockfish.

## Estrutura de pastas

- `server/index.ts`: servidor Node customizado com Next.js, Socket.IO e estado em memória.
- `server/game-manager.ts`: regras da partida e fluxo do modo `pvp`/`vs-bot` no servidor.
- `server/game-manager.test.ts`: testes automáticos do fluxo do servidor com bot mockado.
- `server/services/stockfish.ts`: serviço simples para pedir uma jogada ao Stockfish.
- `src/app/page.tsx`: tela inicial para criar ou entrar em uma partida.
- `src/app/game/[id]/page.tsx`: rota da partida.
- `src/components/ChessBoard.tsx`: integração do cliente com Chessground, Socket.IO e ações simples da partida.
- `src/lib/chess.ts`: helpers simples para destinos legais e promoção.
- `src/lib/player.ts`: persistência local do ID do jogador para reconexão básica.
- `src/types/game.ts`: tipos compartilhados entre cliente e servidor.

## Próximos passos

- Melhorar presença para distinguir jogador ocupado de jogador realmente conectado.
- Adicionar escolha de promoção em vez de promover automaticamente para dama.
- Persistir partidas em banco depois que o fluxo em memória estiver estável.
- Adicionar relógio, resign, draw offer e histórico visual de lances.
