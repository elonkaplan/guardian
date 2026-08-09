import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { fetchAgent } from '../api/agents';
import type { ApiError } from '../api/errors';
import type { AgentListing } from '../api/types';
import { BuyPanel } from '../components/BuyPanel';
import { ContractTerms } from '../components/ContractTerms';
import { LoadState } from '../components/LoadState';
import { describeSchema } from '../lib/inputSchema';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';

/**
 * One listing, and the purchase that starts from it.
 *
 * The order of this page is the requirement. Contract terms come first and the
 * buy panel comes after them, so a buyer cannot reach the purchase without
 * having passed what the seller promised and what the seller excluded. That
 * ordering lives in this file's JSX and nowhere else, which makes this the
 * place a reviewer checks it.
 *
 * The listing shown here is public and deliberately partial: it carries no
 * system prompt and no model, because the type it arrives in has nowhere to
 * put them. What a buyer sees before paying is exactly what a verdict is later
 * allowed to quote.
 */
export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, error, isPending } = useQuery<AgentListing, ApiError>({
    queryKey: ['agents', id],
    queryFn: () => fetchAgent(id as string),
    enabled: id !== undefined,
  });

  if (isPending) {
    return <LoadState status="loading" message="Loading this listing…" />;
  }

  // 404 is its own outcome, not a generic failure: the agent is gone or was
  // never here, and the only useful next move is back to the catalogue.
  if (error !== null && error.status === 404) {
    return (
      <section className="detail detail--missing">
        <h1 className="detail__name">No such agent</h1>
        <p className="detail__missing-note">
          This listing does not exist, or it is no longer offered.
        </p>
        <Link to={paths.marketplace()}>Back to the marketplace</Link>
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="detail detail--missing">
        <LoadState status="error" message={error.message} />
        <Link to={paths.marketplace()}>Back to the marketplace</Link>
      </section>
    );
  }

  const inputDescription = describeSchema(data.inputSchema);
  const outputDescription = describeSchema(data.outputSchema);

  return (
    <section className="detail">
      <p className="detail__breadcrumb">
        <Link to={paths.marketplace()}>← Marketplace</Link>
      </p>

      <h1 className="detail__name">{data.name}</h1>
      <p className="detail__description">{data.description}</p>
      <p className="detail__price">
        <span className="detail__price-label">Price</span>
        <span className="detail__price-amount">{formatUsd(data.priceMinor)}</span>
      </p>

      <ContractTerms capabilities={data.capabilities} exclusions={data.exclusions} />

      <div className="detail__contract-shape">
        <div className="detail__shape">
          <h3 className="detail__shape-heading">What you supply</h3>
          <p className="detail__shape-note">
            {inputDescription ?? 'The fields in the form below.'}
          </p>
        </div>
        <div className="detail__shape">
          <h3 className="detail__shape-heading">What comes back</h3>
          <p className="detail__shape-note">
            {outputDescription ?? 'A structured result matching this agent’s output contract.'}
          </p>
        </div>
      </div>

      {/*
        Below the terms, always. And keyed by agent id so that moving between
        two listings cannot carry one agent's half-typed input onto another's
        form — the acceptance criteria especially, which are the last thing
        that should ever be inherited by accident.
      */}
      <BuyPanel key={data.id} agent={data} />
    </section>
  );
}
