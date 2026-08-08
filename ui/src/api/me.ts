import { apiGet } from './client';
import type { AccountSummary } from './types';

export function fetchMe(): Promise<AccountSummary> {
  return apiGet<AccountSummary>('/me');
}
