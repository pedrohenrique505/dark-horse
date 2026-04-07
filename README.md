# Dark Horse Chess

MVP de um site de xadrez online para 2 jogadores.

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

## Como testar o MVP

1. Abra a página inicial em um navegador.
2. Clique em `Criar partida`.
3. Copie o link da partida.
4. Abra o link em outro navegador ou aba anônima.
5. Faça uma jogada com as brancas e confirme que ela aparece para as pretas.
6. Tente uma jogada ilegal e veja que o servidor rejeita.
7. Quando não for sua vez, selecione uma peça sua e faça um pre-move básico.
8. Use o botão direito no tabuleiro para desenhar setas.
9. Recarregue a página da partida e confirme que ela reconecta na mesma sala.

## Estrutura de pastas

- `server/index.ts`: servidor Node customizado com Next.js, Socket.IO e estado em memória.
- `src/app/page.tsx`: tela inicial para criar ou entrar em uma partida.
- `src/app/game/[id]/page.tsx`: rota da partida.
- `src/components/ChessBoard.tsx`: integração do cliente com Chessground e Socket.IO.
- `src/lib/chess.ts`: helpers simples para destinos legais e promoção.
- `src/lib/player.ts`: persistência local do ID do jogador para reconexão básica.
- `src/types/game.ts`: tipos compartilhados entre cliente e servidor.

## Próximos passos

- Melhorar presença para distinguir jogador ocupado de jogador realmente conectado.
- Adicionar escolha de promoção em vez de promover automaticamente para dama.
- Persistir partidas em banco depois que o fluxo em memória estiver estável.
- Adicionar relógio, resign, draw offer e histórico visual de lances.
