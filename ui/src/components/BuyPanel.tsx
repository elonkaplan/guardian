import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { isConnectivityError } from '../api/errors';
import { createOrder } from '../api/orders';
import type { AgentListing } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useAccountSummary } from '../hooks/useAccountSummary';
import type { FieldValue } from '../lib/inputSchema';
import {
  RAW_FIELD,
  buildInputForm,
  buildPayload,
  initialValues,
  parseRawInput,
  validateFields,
} from '../lib/inputSchema';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';
import { AcceptanceCriteriaField } from './AcceptanceCriteriaField';
import { SchemaFields } from './SchemaFields';

/**
 * The purchase: the buyer's input, their acceptance criteria, and the money.
 *
 * Three things here are load-bearing and none of them are visual.
 *
 * **One request per intent.** `POST /orders` is not idempotent — the backend
 * commits the order row and the ledger debit in one transaction and only then
 * answers. The in-flight flag disables the action, and a success replaces this
 * screen in history so a back navigation cannot resubmit.
 *
 * **A refusal and a silence are different failures.** If the backend refuses,
 * it definitively created nothing: show why, keep every value the buyer typed,
 * let them fix it and try again. If we never got an answer, we do not know
 * whether the order exists — so the buyer is told exactly that and pointed at
 * their orders list, and no retry is offered. A "try again" button on that
 * branch is how someone pays twice.
 *
 * **An unknown balance is not a refusal.** A short balance blocks locally, with
 * the shortfall named; a balance we could not read leaves the action alone and
 * lets the backend decide. Blocking on a transient `GET /me` failure would be
 * an outage we inflicted on ourselves, with no way for an operator to override
 * it mid-demo.
 */

/** Below this, a criterion is too thin for anyone to check a result against. */
const THIN_CRITERION_CHARS = 15;
const THIN_CRITERION_WORDS = 3;

type Affordability = 'sign-in-required' | 'unknown' | 'short' | 'ok';

function asText(value: FieldValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function BuyPanel({ agent }: { agent: AgentListing }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuth();
  const { data: account, unknown: balanceUnknown } = useAccountSummary();

  const form = useMemo(() => buildInputForm(agent.inputSchema), [agent.inputSchema]);
  const [values, setValues] = useState<Record<string, FieldValue>>(() => initialValues(form));
  const [criteria, setCriteria] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [criteriaError, setCriteriaError] = useState<string | undefined>(undefined);

  // Set only when a purchase failed without an answer. It is deliberately not
  // cleared by editing the form: until the buyer has looked at their orders,
  // we still do not know whether that order exists.
  const [ambiguous, setAmbiguous] = useState(false);

  const purchase = useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      // The header's available balance has just been debited. Nudge the shared
      // ['me'] query rather than waiting up to five seconds for its next poll.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(paths.orderDetail(order.id), { replace: true });
    },
    onError: (error) => {
      if (isConnectivityError(error)) {
        setAmbiguous(true);
      }
    },
  });

  const affordability: Affordability = !isSignedIn
    ? 'sign-in-required'
    : balanceUnknown || account === undefined
      ? 'unknown'
      : account.availableBalanceMinor < agent.priceMinor
        ? 'short'
        : 'ok';

  const shortfall =
    affordability === 'short' && account !== undefined
      ? agent.priceMinor - account.availableBalanceMinor
      : 0;

  // Derived, not stored: a warning that arrives while the buyer is still
  // writing is worth more than one that appears after they have committed, and
  // deriving it means it cannot fire twice for the same text.
  const criteriaWarning = useMemo(() => {
    const trimmed = criteria.trim();
    if (trimmed === '') {
      return undefined;
    }
    const words = trimmed.split(/\s+/).length;
    if (trimmed.length >= THIN_CRITERION_CHARS && words >= THIN_CRITERION_WORDS) {
      return undefined;
    }
    return 'This gives Guardian very little to check a result against. You can buy anyway — but a criterion this short is a weak case if you ever dispute the work.';
  }, [criteria]);

  function updateValue(name: string, value: FieldValue): void {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Re-entry guard. The action is disabled while pending, but a keyboard
    // Enter on a form is not stopped by a disabled button in every browser.
    if (purchase.isPending || ambiguous) {
      return;
    }

    const fieldErrors = validateFields(form, values);
    let input: Record<string, unknown> = {};

    if (form.mode === 'raw') {
      const parsed = parseRawInput(asText(values[RAW_FIELD]));
      if (parsed.ok) {
        input = parsed.value;
      } else {
        fieldErrors[RAW_FIELD] = parsed.message;
      }
    } else {
      input = buildPayload(form, values);
    }

    const trimmedCriteria = criteria.trim();
    const nextCriteriaError =
      trimmedCriteria === ''
        ? 'Write what the finished work has to include. This is what a dispute would be judged against.'
        : undefined;

    setErrors(fieldErrors);
    setCriteriaError(nextCriteriaError);

    // Nothing leaves the browser while anything is unfilled. This is the whole
    // of "caught before submitting".
    if (Object.keys(fieldErrors).length > 0 || nextCriteriaError !== undefined) {
      return;
    }

    purchase.mutate({ agentId: agent.id, input, acceptanceCriteria: trimmedCriteria });
  }

  if (affordability === 'sign-in-required') {
    return (
      <section className="buy buy--signed-out">
        <h2 className="buy__heading">Buy this agent</h2>
        <p className="buy__signin-note">
          Connect a wallet to buy. That is the whole of signing up — one signature, no form.
        </p>
        <Link className="buy__signin" to={paths.connect()} state={{ from: location }}>
          Connect wallet
        </Link>
        <p className="buy__price-line">
          <span className="buy__figure-label">Price</span>
          <span className="buy__figure-amount">{formatUsd(agent.priceMinor)}</span>
        </p>
      </section>
    );
  }

  const refusal = purchase.error !== null && !ambiguous ? purchase.error.message : undefined;

  return (
    <section className="buy">
      <h2 className="buy__heading">Buy this agent</h2>

      <form className="buy__form" onSubmit={handleSubmit} noValidate>
        <SchemaFields
          form={form}
          values={values}
          errors={errors}
          disabled={purchase.isPending}
          onChange={updateValue}
        />

        <AcceptanceCriteriaField
          value={criteria}
          {...(criteriaError !== undefined ? { error: criteriaError } : {})}
          {...(criteriaWarning !== undefined ? { warning: criteriaWarning } : {})}
          disabled={purchase.isPending}
          onChange={setCriteria}
        />

        {/*
          Two figures, never one. Available balance and a price are different
          quantities, and a single "you have enough" would hide which of them
          moved. The app makes the same distinction in the header.
        */}
        <div className="buy__figures">
          <p className="buy__figure">
            <span className="buy__figure-label">Available balance</span>
            <span className="buy__figure-amount">
              {account === undefined ? '—' : formatUsd(account.availableBalanceMinor)}
            </span>
          </p>
          <p className="buy__figure">
            <span className="buy__figure-label">Price</span>
            <span className="buy__figure-amount">{formatUsd(agent.priceMinor)}</span>
          </p>
        </div>

        {affordability === 'short' ? (
          <p className="buy__shortfall">
            You are {formatUsd(shortfall)} short.{' '}
            <Link to={paths.wallet()}>Add funds on the wallet screen</Link> and come back.
          </p>
        ) : null}

        {affordability === 'unknown' ? (
          <p className="buy__balance-unknown">
            Your balance could not be read just now. You can still buy — the purchase will be
            refused if the funds are not there.
          </p>
        ) : null}

        <button
          type="submit"
          className="buy__submit"
          disabled={purchase.isPending || affordability === 'short' || ambiguous}
        >
          {purchase.isPending ? 'Buying…' : `Buy — ${formatUsd(agent.priceMinor)}`}
        </button>

        {refusal !== undefined ? (
          <p className="buy__error" role="alert">
            {refusal}
          </p>
        ) : null}

        {ambiguous ? (
          <p className="buy__ambiguous" role="alert">
            We never heard back, so this order may or may not have been created. Do not buy
            again — <Link to={paths.orders()}>check your orders</Link> first.
          </p>
        ) : null}
      </form>
    </section>
  );
}
