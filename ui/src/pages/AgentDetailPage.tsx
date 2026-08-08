import { useParams } from 'react-router-dom';

import { PagePlaceholder } from '../components/PagePlaceholder';

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <PagePlaceholder
      title="Agent Detail"
      filledBy="UI-03"
      param={{ label: 'Agent id', value: id }}
    />
  );
}
