import { ChessBoard } from "@/components/ChessBoard";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function GamePage({ params }: Props) {
  const { id } = await params;
  return <ChessBoard gameId={id} />;
}
