import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createAgent } from '../api/agents';
import { isConnectivityError } from '../api/errors';
import type { DraftFields } from '../lib/agentDraft';
import { buildCreateAgentRequest } from '../lib/agentDraft';
import { paths } from '../routes/paths';
import { AmountField } from '../components/AmountField';
import { SchemaTextArea } from '../components/SchemaTextArea';
import { TermListField } from '../components/TermListField';

/**
 * The form that makes this a marketplace rather than a catalogue.
 *
 * There are three agents in this marketplace and we put all three there. Every
 * claim the product makes about being open rests on a thing nobody has yet done
 * from the outside: list an agent. This screen is the answer to the first
 * question from the floor, and the answer has to survive being given live.
 *
 * Four things here are load-bearing and none of them are visual.
 *
 * **Capabilities and exclusions are contract terms, and the form says so.**
 * They are quoted verbatim in verdicts and they decide disputes in both
 * directions: a vague capability loses a dispute the seller should have won, a
 * precise exclusion wins one they would otherwise have lost. Every other route
 * to better contract text costs engineering. Saying it beside the fields costs
 * a sentence, and it is the cheapest lever this product has on the quality of
 * its own evidence (FR-013, research R13). The hints are therefore always
 * visible — not tooltips, not placeholders, not a lede at the top of a
 * nine-field form that everyone scrolls past.
 *
 * **The schemas are raw JSON, deliberately.** A schema builder is a day of work
 * for a control the demo never touches, and a seller in this MVP is a person
 * authoring three fixtures. This form checks that the text parses and is an
 * object, and hands the rest to the backend — which is the party that actually
 * validates JSON Schema (API-06 scopes it), and therefore the party whose
 * opinion cannot be contradicted by a second one written here (research R12).
 *
 * **One request per intent.** `POST /agents` inserts an agent, inserts version
 * 1, and calls `registerAgent` on-chain awaiting the receipt before it answers,
 * so a client timeout says nothing about whether the listing exists. The guard
 * is a ref rather than `isPending` or the `disabled` attribute, because both of
 * those come from state and several activations dispatched inside one frame all
 * read the same stale `false`. `OrderActions` measured that; `WalletActions`
 * restated it; a duplicate here means two listings and two on-chain
 * registrations for one intent.
 *
 * **A refusal and a silence are different failures.** A 4xx means the backend
 * understood us and definitively created nothing: show why, keep every value
 * typed, let them fix it and submit again. Silence means we never got an
 * answer, so the form locks and offers *no retry* and points at `/sell` — which
 * is where the answer is, and where a success would have sent them anyway. A
 * "try again" button on that branch is how a marketplace of four agents
 * acquires two identical ones.
 *
 * **Nothing is read back.** `systemPrompt` and `model` travel outward in the
 * request and `createAgent` discards its response, so this screen never holds
 * an execution spec it could render. That is FR-037 made structural rather than
 * remembered (`ui/docs/CONTEXT.md` §2).
 */

/** The two documented seller-agent models (`docs/tech-stack.md` §2.2). Suggestions, not a restriction. */
const MODEL_SUGGESTIONS = ['claude-haiku-4-5', 'claude-sonnet-5'] as const;

/**
 * Pre-filled so the common path needs no decision, and so a first-time seller is
 * never asked to guess a model id — the wrong guess produces an agent that fails
 * at execution time, during a demo, inside someone else's module (research R15).
 */
const DEFAULT_MODEL = MODEL_SUGGESTIONS[0];

/**
 * The schema boxes start with a minimal well-formed object rather than empty.
 *
 * A blank textarea labelled "input contract" teaches nothing; this teaches the
 * shape in one line and is immediately editable. It is deliberately trivial —
 * a fuller example would be a template people ship without reading.
 */
const INPUT_SCHEMA_EXAMPLE = `{
  "type": "object",
  "properties": {
    "text": { "type": "string" }
  },
  "required": ["text"]
}`;

const OUTPUT_SCHEMA_EXAMPLE = `{
  "type": "object",
  "properties": {
    "result": { "type": "string" }
  },
  "required": ["result"]
}`;

const CAPABILITY_HINT =
  'Each line is a promise Guardian will quote back at you in a dispute. “Extracts every line item with its amount” can be checked against a result; “high quality output” cannot — and a vague capability is how a seller loses a dispute they should have won.';

const EXCLUSION_HINT =
  'Each line is a case you are not taking on. “Does not handle handwritten receipts” is what turns a fuzzy argument about what was reasonable to expect into a clause Guardian can cite in your favour. This is the half sellers skip and then regret.';

const PRICE_HINT_ID = 'agent-price-hint';

export function CreateAgentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  // One empty row each, so the field renders as something to fill in rather
  // than as an add button floating beside a heading.
  const [capabilities, setCapabilities] = useState<string[]>(() => ['']);
  const [exclusions, setExclusions] = useState<string[]>(() => ['']);
  const [inputSchemaText, setInputSchemaText] = useState(INPUT_SCHEMA_EXAMPLE);
  const [outputSchemaText, setOutputSchemaText] = useState(OUTPUT_SCHEMA_EXAMPLE);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  // Set on submit only. Validating on every keystroke would tell a seller their
  // half-typed JSON is broken while they are still typing it.
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Set only when a submission failed without an answer. Deliberately not
  // cleared by editing the form: until the seller has looked at their agents,
  // we still do not know whether that listing exists.
  const [ambiguous, setAmbiguous] = useState(false);

  // See the header. Written synchronously, so the second activation in the same
  // frame sees the first.
  const inFlight = useRef(false);

  const listing = useMutation({
    mutationFn: createAgent,
    onSuccess: () => {
      // The seller's own list is the authority on what now exists, and the
      // public catalogue has gained a row. Nudge both rather than waiting up to
      // five seconds for the next poll of one and a cold load of the other.
      void queryClient.invalidateQueries({ queryKey: ['agents', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate(paths.sell(), { replace: true });
    },
    onError: (error) => {
      if (isConnectivityError(error)) {
        setAmbiguous(true);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const disabled = listing.isPending || ambiguous;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Re-entry guard. The submit button is disabled while pending, but a
    // keyboard Enter on a form is not stopped by a disabled button in every
    // browser — and the ref is what catches two clicks inside one frame.
    if (inFlight.current || disabled) {
      return;
    }

    const fields: DraftFields = {
      name,
      description,
      price,
      capabilities,
      exclusions,
      inputSchemaText,
      outputSchemaText,
      systemPrompt,
      model,
    };

    const draft = buildCreateAgentRequest(fields);

    if (!draft.ok) {
      // Every failure at once, keyed by field name. A nine-field form that
      // surfaces one error per submission is a form people submit five times.
      setErrors(draft.errors);
      return;
    }

    setErrors({});
    inFlight.current = true;
    listing.mutate(draft.request);
  }

  const refusal = listing.error !== null && !ambiguous ? listing.error.message : undefined;

  return (
    <section className="create-agent">
      <p className="create-agent__breadcrumb">
        <Link to={paths.sell()}>← Your agents</Link>
      </p>

      <h1 className="create-agent__title">List an agent</h1>
      <p className="create-agent__lede">
        You are writing two things at once: an offer buyers read before they pay, and the
        contract Guardian judges you against if one of them complains. The wording below
        is quoted verbatim in verdicts.
      </p>

      <form className="create-agent__form" onSubmit={handleSubmit} noValidate>
        <div className="create-agent__field">
          <label className="create-agent__label" htmlFor="agent-name">
            Name
          </label>
          <input
            id="agent-name"
            className="create-agent__input"
            type="text"
            value={name}
            disabled={disabled}
            aria-invalid={errors['name'] !== undefined}
            aria-describedby={errors['name'] !== undefined ? 'agent-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {errors['name'] !== undefined ? (
            <p className="create-agent__error" id="agent-name-error" role="alert">
              {errors['name']}
            </p>
          ) : null}
        </div>

        <div className="create-agent__field">
          <label className="create-agent__label" htmlFor="agent-description">
            Description
          </label>
          <p className="create-agent__hint">
            One sentence, for the catalogue. What it does — not how well it does it.
          </p>
          <textarea
            id="agent-description"
            className="create-agent__textarea"
            rows={2}
            value={description}
            disabled={disabled}
            aria-invalid={errors['description'] !== undefined}
            aria-describedby={
              errors['description'] !== undefined ? 'agent-description-error' : undefined
            }
            onChange={(event) => setDescription(event.target.value)}
          />
          {errors['description'] !== undefined ? (
            <p className="create-agent__error" id="agent-description-error" role="alert">
              {errors['description']}
            </p>
          ) : null}
        </div>

        <div className="create-agent__field">
          {/*
            The same money control the wallet screen uses, delegating to the same
            `parseUsd`. Two forms with two ideas of what a dollar amount looks
            like would teach whoever hit one of them first a rule the other does
            not follow.
          */}
          <AmountField
            label="Price per purchase"
            id="agent-price"
            value={price}
            disabled={disabled}
            {...(errors['price'] !== undefined ? { error: errors['price'] } : {})}
            onChange={setPrice}
          />
          <p className="create-agent__hint" id={PRICE_HINT_ID}>
            Flat, charged once per order. The buyer&rsquo;s money sits in escrow until the
            work is accepted or a dispute is ruled on.
          </p>
        </div>

        {/*
          The two fields this whole screen is really for. See the header, and
          research R13: this is where the quality of Guardian's evidence is
          decided, and it costs two sentences.
        */}
        <TermListField
          id="agent-capabilities"
          label="What this agent does"
          hint={CAPABILITY_HINT}
          terms={capabilities}
          disabled={disabled}
          addLabel="Add a capability"
          onChange={setCapabilities}
        />

        <TermListField
          id="agent-exclusions"
          label="What this agent does not handle"
          hint={EXCLUSION_HINT}
          terms={exclusions}
          disabled={disabled}
          addLabel="Add an exclusion"
          onChange={setExclusions}
        />

        <SchemaTextArea
          id="agent-input-schema"
          label="What buyers send this agent"
          hint="A JSON Schema describing the input. Buyers see a form built from it, and an order is refused before any money moves if the input does not match."
          value={inputSchemaText}
          disabled={disabled}
          {...(errors['inputSchemaText'] !== undefined
            ? { error: errors['inputSchemaText'] }
            : {})}
          onChange={setInputSchemaText}
        />

        <SchemaTextArea
          id="agent-output-schema"
          label="What this agent returns"
          hint="A JSON Schema describing the output. This is the most useful field on the form: a structured result is what lets a dispute be settled by counting rather than by opinion."
          value={outputSchemaText}
          disabled={disabled}
          {...(errors['outputSchemaText'] !== undefined
            ? { error: errors['outputSchemaText'] }
            : {})}
          onChange={setOutputSchemaText}
        />

        <div className="create-agent__field">
          <label className="create-agent__label" htmlFor="agent-system-prompt">
            System prompt
          </label>
          <p className="create-agent__hint">
            Your instructions to the model, and the part of this listing buyers never see.
            It is redacted from their copy of a dispute&rsquo;s evidence, so a complaint
            cannot be used to read it.
          </p>
          <textarea
            id="agent-system-prompt"
            className="create-agent__textarea create-agent__textarea--prompt"
            rows={8}
            value={systemPrompt}
            disabled={disabled}
            aria-invalid={errors['systemPrompt'] !== undefined}
            aria-describedby={
              errors['systemPrompt'] !== undefined ? 'agent-system-prompt-error' : undefined
            }
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
          {errors['systemPrompt'] !== undefined ? (
            <p className="create-agent__error" id="agent-system-prompt-error" role="alert">
              {errors['systemPrompt']}
            </p>
          ) : null}
        </div>

        <div className="create-agent__field">
          <label className="create-agent__label" htmlFor="agent-model">
            Model
          </label>
          <p className="create-agent__hint">
            Cost against quality is your call. The default is what the demo agents run on.
          </p>
          {/*
            A datalist, not a select and not a bare text box (research R15). The
            value stays free text, so the backend remains the authority on what
            it can actually run and an unlisted model is still enterable; the two
            documented ids are one click away; and the default means the common
            path requires no decision at all. A `<select>` would hard-code a list
            free to drift from the backend's.
          */}
          <input
            id="agent-model"
            className="create-agent__input"
            type="text"
            list="agent-model-options"
            value={model}
            disabled={disabled}
            aria-invalid={errors['model'] !== undefined}
            aria-describedby={errors['model'] !== undefined ? 'agent-model-error' : undefined}
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id="agent-model-options">
            {MODEL_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          {errors['model'] !== undefined ? (
            <p className="create-agent__error" id="agent-model-error" role="alert">
              {errors['model']}
            </p>
          ) : null}
        </div>

        <button type="submit" className="create-agent__submit" disabled={disabled}>
          {listing.isPending ? 'Listing…' : 'List this agent'}
        </button>

        {refusal !== undefined ? (
          <p className="create-agent__submit-error" role="alert">
            {refusal}
          </p>
        ) : null}

        {ambiguous ? (
          <p className="create-agent__ambiguous" role="alert">
            We never heard back, so this agent may or may not have been listed. Do not submit
            again — <Link to={paths.sell()}>check your agents</Link> first.
          </p>
        ) : null}
      </form>
    </section>
  );
}
