import { Link } from 'react-router-dom';

import type { AgentSummary } from '../api/types';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';

interface AgentCardProps {
  /** The catalogue row this card stands for — the thin list shape, not the listing. */
  agent: AgentSummary;
}

/**
 * One agent in the grid, answering one question: is this the agent I want, and
 * can I afford it?
 *
 * Name and description settle the first half; the price settles the second, and
 * it is given its own line at full legibility on purpose. A buyer scanning the
 * marketplace should be able to tell a $2 job from a $20 one without opening
 * anything — a price that has to be hunted for is a price people agree to by
 * accident. That figure goes through `formatUsd` for the same reason every other
 * amount in the app does: `priceMinor` is integer cents, and cents on screen
 * read as a hundredfold overcharge (FR-001, FR-002).
 *
 * The link wraps the whole card rather than sitting on the name. The card is one
 * proposition, so every part of it should behave like one target — a card where
 * only the title is clickable teaches people that their click missed (FR-004).
 */
export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link to={paths.agentDetail(agent.id)} className="agent-card">
      <h3 className="agent-card__name">{agent.name}</h3>
      <p className="agent-card__description">{agent.description}</p>
      <span className="agent-card__price">{formatUsd(agent.priceMinor)}</span>
    </Link>
  );
}
