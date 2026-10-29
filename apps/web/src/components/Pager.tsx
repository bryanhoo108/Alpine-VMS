import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BigButton } from './BigButton';

/** Items per page on guard pickers: big buttons, no scrolling. */
export const PAGE = 6;

export function Pager({
  page,
  pages,
  setPage,
}: {
  page: number;
  pages: number;
  setPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-3">
      <BigButton
        size="sm"
        tone="plain"
        icon={ChevronLeft}
        label="Back"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      />
      <div className="text-xl font-bold">
        {page + 1} / {pages}
      </div>
      <BigButton
        size="sm"
        tone="plain"
        icon={ChevronRight}
        label="More"
        disabled={page >= pages - 1}
        onClick={() => setPage(page + 1)}
      />
    </div>
  );
}
