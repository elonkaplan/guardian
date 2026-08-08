import { useParams } from 'react-router-dom';

import { PagePlaceholder } from '../components/PagePlaceholder';

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <PagePlaceholder
      title="Order Detail"
      filledBy="UI-04 — the hero page, where both demo acts play out"
      param={{ label: 'Order id', value: id }}
    />
  );
}
