/**
 * The product's navigation map, defined once.
 *
 * Every link target in the app comes from here. No feature writes a route
 * string inline — a typo in a template literal is otherwise invisible until
 * someone clicks it.
 *
 * Route patterns (the `:id` forms) are separate from the builders because
 * <Route path> wants the pattern and <Link to> wants the built path.
 */

export const routePatterns = {
  connect: '/',
  marketplace: '/agents',
  agentDetail: '/agents/:id',
  orders: '/orders',
  orderDetail: '/orders/:id',
  wallet: '/wallet',
  sell: '/sell',
  createAgent: '/sell/new',
} as const;

export const paths = {
  connect: () => '/',
  marketplace: () => '/agents',
  agentDetail: (id: string) => `/agents/${id}`,
  orders: () => '/orders',
  orderDetail: (id: string) => `/orders/${id}`,
  wallet: () => '/wallet',
  sell: () => '/sell',
  createAgent: () => '/sell/new',
} as const;
