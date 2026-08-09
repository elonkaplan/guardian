import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Agent } from './agent.entity';
import { bigintTransformer } from './transformers';

/**
 * One row per definition edit. Rows are IMMUTABLE once written.
 *
 * This is the definition a dispute is judged against: an order pins a
 * specific `agent_version`, so "judged against the definition that
 * actually ran" is true by construction.
 */
@Entity('agent_versions')
@Unique('agent_versions_agent_id_version_key', ['agentId', 'version'])
@Check('agent_versions_price_minor_check', '"price_minor" > 0')
export class AgentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => Agent)
  @JoinColumn({
    name: 'agent_id',
    foreignKeyConstraintName: 'agent_versions_agent_id_fkey',
  })
  agent!: Agent;

  @Column({ type: 'int', name: 'version' })
  version!: number;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'description' })
  description!: string;

  /** Half of Guardian's yardstick. May be EMPTY but never absent. */
  @Column({ type: 'text', array: true, name: 'capabilities' })
  capabilities!: string[];

  /** The other, defensive half. */
  @Column({ type: 'text', array: true, name: 'exclusions' })
  exclusions!: string[];

  /** Whole USD cents; CHECK (price_minor > 0) in the migration. */
  @Column({
    type: 'bigint',
    name: 'price_minor',
    transformer: bigintTransformer,
  })
  priceMinor!: number;

  @Column({ type: 'jsonb', name: 'input_schema' })
  inputSchema!: Record<string, unknown>;

  /** The load-bearing one — it is what the run's output is validated against. */
  @Column({ type: 'jsonb', name: 'output_schema' })
  outputSchema!: Record<string, unknown>;

  /**
   * ⚠️ RESTRICTED — seller IP. MUST NEVER be serialised to a buyer.
   *
   * Guardian reads this during an audit, but the buyer's copy of the case
   * file must have it stripped. The boundary is wider than this one
   * column: execution steps can paraphrase the prompt, so reasoning text
   * must be summarised rather than passed through.
   *
   * Enforcement lives in `src/catalog/agent-serialiser.ts`, and it is
   * structural rather than remembered — three independent layers have to fail
   * before this column reaches a buyer:
   *
   *  1. **It is never read.** The buyer-facing repository queries name their
   *     columns explicitly and this is not among them, so on a public read the
   *     prompt does not enter the process at all — which also protects a log
   *     line and a stack trace, not just a response body.
   *  2. **The serialiser cannot see it.** Its parameter type is a `Pick<>` of
   *     the listing fields, so no expression inside it can read this property.
   *     Emitting it requires editing that type.
   *  3. **The response types are closed.** Exact interfaces, no index
   *     signature, so spreading an entity into a response is a compile error
   *     rather than a leak.
   *
   * The one place this column is legitimately mapped is
   * `src/catalog/agent-versions.service.ts`, serving the owner-only
   * `GET /agents/:id/versions`. It is deliberately NOT in the serialiser
   * module: a mapper that must see this field does not belong behind a
   * boundary defined by not having it.
   *
   * (`specs/006-agent-catalogue/research.md` R9)
   */
  @Column({ type: 'text', name: 'system_prompt' })
  systemPrompt!: string;

  /** e.g. 'claude-haiku-4-5'. */
  @Column({ type: 'text', name: 'model' })
  model!: string;

  /** Beyond this the run counts as non-delivery. */
  @Column({ type: 'int', name: 'timeout_seconds', default: 120 })
  timeoutSeconds!: number;

  /**
   * keccak256 of the canonical definition — raw bytes, not a hex string;
   * hex conversion belongs in the chain adapter.
   */
  @Column({ type: 'bytea', name: 'definition_hash' })
  definitionHash!: Buffer;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
