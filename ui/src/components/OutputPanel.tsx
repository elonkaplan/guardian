import type { JSX } from 'react';

interface OutputPanelProps {
  /**
   * Whatever the seller's `outputSchema` produced. Typed as `unknown` on purpose:
   * the schema is the seller's, not ours, it is not on the order payload, and it
   * is only known at runtime. Every decision below is made by looking at the
   * value, never by trusting a declared shape.
   */
  output: unknown;
}

/**
 * What the agent delivered, rendered by shape (research R9, FR-024).
 *
 * Three renderings, chosen by inspection: an array of flat objects becomes a
 * table, a string becomes pre-wrapped prose, everything else becomes indented
 * JSON.
 *
 * The table branch is worth its thirty lines, and it is worth being explicit
 * about why, because on a code review it reads like polish. Act 2 of the demo
 * (`docs/product-workflow.md` §5.3) is LedgerBot returning three line items out
 * of five, and the argument the act is making is that the audience reaches the
 * 50% verdict *before* Guardian announces it. That only works if the count is
 * free. Counting rows in a JSON blob is possible — you can do it, squinting at
 * braces, in a few seconds — and counting rows in a table is instant. The whole
 * centrepiece rests on that difference: a verdict the room has already reached
 * for itself feels earned, and a verdict announced over an unreadable blob feels
 * like magic, which is the one thing an arbiter must never feel like. So the
 * table exists, the columns are the union of every row's keys so a row that
 * dropped a field still shows up as a row, and the row count is printed in words
 * beside the heading because counting is literally the task the audience is
 * performing.
 *
 * The prose branch serves TLDR Agent, whose output is a summary and which must
 * read as a paragraph rather than as a JSON string with `\n` spelled out.
 *
 * The JSON branch is the honest fallback rather than a failure mode. It
 * guarantees that no seller's output shape — an object, an array of numbers, an
 * array of mixed shapes, a bare boolean — can produce a blank panel on the one
 * screen where the buyer is deciding whether to accept or complain. For the same
 * reason nothing here throws: `JSON.stringify` is not total (cycles, BigInt), and
 * a delivered output that crashes the page would take the countdown and both
 * actions down with it.
 *
 * The heading and the row count sit outside `output-panel__body` so the CSS task
 * can bound the body's height and scroll it internally (FR-024, quickstart C5)
 * while the label and the count stay in view.
 */
export function OutputPanel({ output }: OutputPanelProps): JSX.Element {
  const rows = asObjectRows(output);

  return (
    <section className="output-panel" aria-label="Agent output">
      <h2 className="output-panel__heading">What the agent delivered</h2>
      {rows !== null && (
        <p className="output-panel__count">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </p>
      )}
      <div className="output-panel__body">{renderBody(output, rows)}</div>
    </section>
  );
}

function renderBody(output: unknown, rows: Record<string, unknown>[] | null): JSX.Element {
  // Not an empty box. The page will normally not render this component at all
  // when there is no output — the failed face says so in its own words — but
  // this component cannot assume that, and a bordered blank rectangle is the
  // worst possible answer to "what did I get for my money?".
  if (output === null || output === undefined) {
    return (
      <p className="output-panel__empty">The agent did not return any output.</p>
    );
  }

  // An empty list is a real result and a damning one: the agent ran, produced a
  // list, and found nothing to put in it. That is a fact a buyer might well
  // complain about, so it gets a sentence rather than being flattened into `[]`.
  if (Array.isArray(output) && output.length === 0) {
    return (
      <p className="output-panel__empty">The agent returned an empty list.</p>
    );
  }

  if (rows !== null) {
    return <OutputTable rows={rows} />;
  }

  if (typeof output === 'string') {
    if (output.trim() === '') {
      return (
        <p className="output-panel__empty">
          The agent returned text with nothing in it.
        </p>
      );
    }
    // `<pre>` with CSS wrapping, not `<p>`: the summary's own paragraph breaks
    // are part of what the buyer is judging, and re-flowing them would edit the
    // delivery before the buyer has read it.
    return <pre className="output-panel__prose">{output}</pre>;
  }

  return <pre className="output-panel__json">{toJson(output)}</pre>;
}

/**
 * The table branch's admission test, kept separate because the panel needs the
 * row count above the scrolling body and so has to ask the question before it
 * renders the answer.
 *
 * A table is only honest when every element is an object — an array of strings
 * or an array of mixed shapes has no columns, and inventing some would misdraw
 * the delivery. Those fall through to JSON, which is right rather than a
 * consolation prize. Returns `null` when the value is not tabular.
 */
function asObjectRows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  if (!value.every(isPlainObject)) {
    return null;
  }
  const rows = value as Record<string, unknown>[];
  // Rows with no keys at all would draw a table with no columns, which is a
  // blank panel wearing a border. JSON says more.
  if (!rows.some((row) => Object.keys(row).length > 0)) {
    return null;
  }
  return rows;
}

interface OutputTableProps {
  rows: Record<string, unknown>[];
}

/**
 * Private: the count and the heading are what make the rows mean anything, and a
 * caller able to render the bare table could put an agent's delivery on screen
 * without saying whose it is or how much of it there is.
 */
function OutputTable({ rows }: OutputTableProps): JSX.Element {
  const columns = unionOfKeys(rows);

  return (
    <table className="output-panel__table">
      <thead>
        <tr>
          {columns.map((column) => (
            // The raw key is kept in `title` — the label is for reading at demo
            // distance, the key is what the seller's schema actually called it.
            <th key={column} scope="col" title={column}>
              {humanise(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          // Rows carry no identity we can rely on — an extracted line item has
          // no id — and the list is rebuilt wholesale on every poll, so the
          // index is the honest key.
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>{renderCell(row, column)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Every key any row carries, in the order it was first seen. Union rather than
 * "the first row's keys" because a row that dropped a field is exactly the kind
 * of defect this screen exists to expose, and taking the first row as the
 * schema would silently hide the later rows' extra columns.
 */
function unionOfKeys(rows: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        known.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}

function renderCell(row: Record<string, unknown>, column: string): JSX.Element | string {
  // A key this row does not carry. Marked, never left as an empty cell: a blank
  // `<td>` reads as a rendering bug, and "this row is missing a field the others
  // have" is information the buyer is entitled to notice.
  if (!Object.prototype.hasOwnProperty.call(row, column)) {
    return <span className="output-panel__blank">—</span>;
  }

  const value = row[column];

  if (value === null || value === undefined) {
    return <span className="output-panel__blank">—</span>;
  }

  if (typeof value === 'string') {
    return value === '' ? (
      <span className="output-panel__blank">(empty)</span>
    ) : (
      value
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    // Printed as it was sent — `true`, not "Yes". This is a transcript of a
    // delivery that an arbiter may later be asked to read.
    return String(value);
  }

  // A nested object or array inside a cell: compact JSON on one line, so the
  // row heights stay even and the rows stay countable, which is the whole point
  // of being in a table.
  return <code className="output-panel__cell-json">{toCompactJson(value)}</code>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `JSON.stringify` is not total: it throws on a cycle or a BigInt and returns
 * `undefined` for a function or an `undefined`. None of those should survive a
 * JSON response, but "should" is doing the work there and the cost of being
 * wrong is a blank output panel on the screen where the buyer decides whether to
 * complain, so every one of them has an answer.
 */
function toJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** The same guarantee, without the indentation, for a value living in a cell. */
function toCompactJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** `unitPrice` / `unit_price` → `Unit price`. */
function humanise(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced === '') {
    return name;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
