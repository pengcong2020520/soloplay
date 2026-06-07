import ReplayClient from "./ReplayClient";

export default function ReplayPage({ params }: { params: { id: string } }) {
  return <ReplayClient sessionId={params.id} />;
}
