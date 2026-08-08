import { Link } from 'react-router-dom';

import { paths } from '../routes/paths';

export function NotFoundPage() {
  return (
    <section>
      <p className="placeholder__kicker">404</p>
      <h1 className="placeholder__title">No such page</h1>
      <p className="placeholder__note">
        That address doesn&rsquo;t match any Guardian screen.
      </p>
      <Link to={paths.connect()}>Back to the start</Link>
    </section>
  );
}
