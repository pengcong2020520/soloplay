import GameClient from "./GameClient";

export default function GamePage({ params }: { params: { id: string } }) {
  return <GameClient sessionId={params.id} />;
}
