/**
 * Virtualised data table: fixed row height, only visible rows are mounted, sticky header,
 * sortable columns. Handles tens of thousands of rows without layout cost.
 */
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Column<T> {
  id: string;
  header: ReactNode;
  /** CSS grid track, e.g. "120px" or "minmax(160px, 1fr)". */
  width: string;
  align?: 'left' | 'right';
  cell: (row: T, index: number) => ReactNode;
  /** Sort key; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string;
}

export interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string | number;
  rowHeight?: number;
  overscan?: number;
  selectedKey?: string | number | null;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  initialSort?: { id: string; dir: 'asc' | 'desc' };
  label?: string;
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  rowHeight,
  overscan = 8,
  selectedKey,
  onRowClick,
  empty = 'No data',
  initialSort,
  label,
}: TableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [measuredRow, setMeasuredRow] = useState(28);
  const [sort, setSort] = useState(initialSort ?? null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const css = getComputedStyle(el).getPropertyValue('--row-h');
    const parsed = parseFloat(css);
    if (Number.isFinite(parsed) && parsed > 0) setMeasuredRow(parsed);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const rh = rowHeight ?? measuredRow;
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, columns, sort]);

  const template = columns.map((c) => c.width).join(' ');
  const total = sorted.length;
  const first = Math.max(0, Math.floor(scrollTop / rh) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + height) / rh) + overscan);
  const visible = sorted.slice(first, last);

  const toggleSort = (id: string) => {
    setSort((s) => (s?.id === id ? (s.dir === 'desc' ? { id, dir: 'asc' } : null) : { id, dir: 'desc' }));
  };

  return (
    <div
      className="sf-table"
      style={{ ['--cols' as string]: template }}
      role="table"
      aria-label={label}
      aria-rowcount={total}
    >
      <div
        className="sf-table__scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="sf-table__head" role="row">
          {columns.map((c) => {
            const active = sort?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="columnheader"
                className="sf-table__th"
                data-align={c.align}
                data-sortable={c.sortValue ? 'true' : undefined}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={c.sortValue ? () => toggleSort(c.id) : undefined}
                tabIndex={c.sortValue ? 0 : -1}
              >
                {c.header}
                {active && (sort!.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
            );
          })}
        </div>
        {total === 0 ? (
          <div className="sf-table__empty">{empty}</div>
        ) : (
          <div style={{ height: total * rh, position: 'relative' }} role="rowgroup">
            {visible.map((row, i) => {
              const index = first + i;
              const key = rowKey(row, index);
              return (
                <div
                  key={key}
                  role="row"
                  aria-rowindex={index + 1}
                  className="sf-table__row"
                  data-selected={selectedKey === key || undefined}
                  data-clickable={onRowClick ? 'true' : undefined}
                  style={{ position: 'absolute', top: index * rh, left: 0, right: 0, height: rh }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <div key={c.id} role="cell" className="sf-table__td" data-align={c.align}>
                      {c.cell(row, index)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
