import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoriesPage } from './CategoriesPage';

describe('CategoriesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/categories')) {
          return new Response(
            JSON.stringify([
              {
                id: 1,
                parent_id: null,
                name: 'Housing',
                system_kind: 'expense',
                color: null,
                icon: null
              },
              {
                id: 2,
                parent_id: 1,
                name: 'Utilities',
                system_kind: 'expense',
                color: null,
                icon: null
              },
              {
                id: 3,
                parent_id: 2,
                name: 'Electric',
                system_kind: 'expense',
                color: null,
                icon: null
              }
            ])
          );
        }
        return new Response(JSON.stringify({ ok: true }));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nested category tree nodes', async () => {
    render(<CategoriesPage />);
    const treeCard = screen
      .getByRole('heading', { name: 'Category Tree' })
      .closest('section');
    expect(treeCard).not.toBeNull();
    fireEvent.click(within(treeCard!).getByTitle('Expand Category Tree'));
    await waitFor(() => {
      expect(within(treeCard!).getByText('Housing')).toBeInTheDocument();
    });
    fireEvent.click(
      within(treeCard!).getAllByRole('button', { name: 'Toggle children' })[0]
    );
    expect(within(treeCard!).getByText('Utilities')).toBeInTheDocument();
    fireEvent.click(
      within(treeCard!).getAllByRole('button', { name: 'Toggle children' })[1]
    );
    expect(within(treeCard!).getByText('Electric')).toBeInTheDocument();
  });
});
