import type { ReactNode } from 'react';

interface PagePlaceholderProps {
  /** The screen's name, as it appears in the product's page map. */
  title: string;
  /** Which later feature spec fills this screen in. */
  filledBy: string;
  /** A path parameter to echo back, proving the route matched with its id. */
  param?: { label: string; value: string | undefined };
  children?: ReactNode;
}

/**
 * The shared shape of every placeholder screen.
 *
 * Defined once so the nine pages are thin wrappers — each later feature replaces
 * exactly one page file's contents without inheriting a copy-pasted layout.
 */
export function PagePlaceholder({ title, filledBy, param, children }: PagePlaceholderProps) {
  return (
    <section>
      <p className="placeholder__kicker">Placeholder</p>
      <h1 className="placeholder__title">{title}</h1>
      <p className="placeholder__note">This screen is filled in by {filledBy}.</p>
      {param ? (
        <p className="placeholder__param">
          <span className="placeholder__param-label">{param.label}</span>
          <span className="placeholder__param-value">{param.value ?? '(none)'}</span>
        </p>
      ) : null}
      {children}
    </section>
  );
}
