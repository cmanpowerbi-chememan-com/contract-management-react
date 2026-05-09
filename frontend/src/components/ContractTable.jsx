import { useRef, useState, useCallback, useMemo } from 'react';
import { MagneticButton } from './ui/magnetic-button';
import styles from './ContractTable.module.css';

const NAME_KEYWORDS = ['name', 'contract', 'desc', 'short', 'text'];

function findNameCol(contracts) {
  if (!contracts.length) return null;
  const cols = Object.keys(contracts[0]);
  return cols.find(
    c => c !== 'purchasing_doc_no' && NAME_KEYWORDS.some(k => c.toLowerCase().includes(k))
  ) || null;
}

function fmtDate(val) {
  if (!val) return '—';
  return String(val).substring(0, 16) || '—';
}

const DEFAULT_WIDTHS = {
  0: 130, // Doc No
  1: 220, // Contract Name
  2: 130, // User Status
  3: 160, // Purchaser Status
  4: 200, // Comment
  5: 150, // เลขสัญญาใหม่
  6: 140, // Updated At
};

function exportToCsv(filteredRows, contractMap, nameCol) {
  const headers = [
    'Doc No',
    ...(nameCol ? ['Contract Name'] : []),
    'User Status',
    'Purchaser Status',
    'Comment',
    'เลขสัญญาใหม่',
    'Updated At',
  ];

  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const csvRows = filteredRows.map(row => [
    row.purchasing_doc_no,
    ...(nameCol ? [contractMap[row.purchasing_doc_no]?.[nameCol] || ''] : []),
    row.user_status || '',
    row.purchaser_status || '',
    row.comment || '',
    row.new_purchasing_doc_no || '',
    fmtDate(row.update_at),
  ].map(escape).join(','));

  const csv = '﻿' + [headers.join(','), ...csvRows].join('\n'); // BOM for Thai in Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contract_status_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ContractTable({ contracts, statuses, flashedDocNo, flashTick, onRefresh, refreshing }) {
  const nameCol = findNameCol(contracts);
  const contractMap = useMemo(
    () => Object.fromEntries(contracts.map(c => [c.purchasing_doc_no, c])),
    [contracts]
  );

  // ── column resize ────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);
  const resizing = useRef(null);

  const onResizeStart = useCallback((e, colIdx) => {
    e.preventDefault();
    resizing.current = { colIdx, startX: e.clientX, startWidth: colWidths[colIdx] };
    const onMove = (ev) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      setColWidths(prev => ({
        ...prev,
        [resizing.current.colIdx]: Math.max(60, resizing.current.startWidth + delta),
      }));
    };
    const onUp = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  // ── filters ──────────────────────────────────────────────────────
  const [filters, setFilters] = useState({
    doc_no: '', name: '', user_status: '', purchaser_status: '',
    comment: '', new_doc_no: '', update_at: '',
  });

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }));
  const activeCount = Object.values(filters).filter(v => v !== '').length;
  const clearFilters = () => setFilters({
    doc_no: '', name: '', user_status: '', purchaser_status: '',
    comment: '', new_doc_no: '', update_at: '',
  });

  // unique dropdown values from all rows
  const uniqueUserStatuses = useMemo(
    () => ['', ...new Set(statuses.map(r => r.user_status).filter(Boolean))].sort(),
    [statuses]
  );
  const uniquePurchaserStatuses = useMemo(
    () => ['', ...new Set(statuses.map(r => r.purchaser_status).filter(Boolean))].sort(),
    [statuses]
  );

  // ── filter logic ─────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const f = filters;
    return statuses.filter(row => {
      const contractName = nameCol ? (contractMap[row.purchasing_doc_no]?.[nameCol] || '') : '';
      return (
        (!f.doc_no       || row.purchasing_doc_no?.toLowerCase().includes(f.doc_no.toLowerCase())) &&
        (!f.name         || contractName.toLowerCase().includes(f.name.toLowerCase())) &&
        (!f.user_status  || row.user_status === f.user_status) &&
        (!f.purchaser_status || row.purchaser_status === f.purchaser_status) &&
        (!f.comment      || (row.comment || '').toLowerCase().includes(f.comment.toLowerCase())) &&
        (!f.new_doc_no   || (row.new_purchasing_doc_no || '').toLowerCase().includes(f.new_doc_no.toLowerCase())) &&
        (!f.update_at    || fmtDate(row.update_at).includes(f.update_at))
      );
    });
  }, [statuses, filters, contractMap, nameCol]);

  // ── columns definition ───────────────────────────────────────────
  const columns = [
    { label: 'Doc No',           idx: 0, filterKey: 'doc_no',           type: 'text' },
    ...(nameCol ? [{ label: 'Contract Name', idx: 1, filterKey: 'name', type: 'text' }] : []),
    { label: 'User Status',      idx: 2, filterKey: 'user_status',      type: 'dropdown', options: uniqueUserStatuses },
    { label: 'Purchaser Status', idx: 3, filterKey: 'purchaser_status', type: 'dropdown', options: uniquePurchaserStatuses },
    { label: 'Comment',          idx: 4, filterKey: 'comment',          type: 'text' },
    { label: 'เลขสัญญาใหม่',      idx: 5, filterKey: 'new_doc_no',       type: 'text' },
    { label: 'Updated At',       idx: 6, filterKey: 'update_at',        type: 'text' },
  ];

  return (
    <div className={styles.wrapper}>
      {/* ── header bar ── */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>รายการที่บันทึกแล้ว</span>
          <span className={styles.badge}>
            {activeCount > 0 ? `${filteredRows.length} / ${statuses.length}` : statuses.length} รายการ
          </span>
          {activeCount > 0 && (
            <button className={styles.clearBtn} onClick={clearFilters}>
              ✕ ล้างฟิลเตอร์ ({activeCount})
            </button>
          )}
        </div>

        <div className={styles.headerActions}>
          <MagneticButton
            className={styles.exportBtn}
            onClick={() => exportToCsv(filteredRows, contractMap, nameCol)}
            strength={0.35}
            radius={85}
          >
            ↓ Export CSV{activeCount > 0 ? ` (${filteredRows.length})` : ''}
          </MagneticButton>
          <button className={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? '↺ Refreshing...' : '↺ Refresh data'}
          </button>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className={styles.empty}>
          {activeCount > 0 ? 'ไม่พบข้อมูลตามฟิลเตอร์' : 'ยังไม่มีข้อมูล'}
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table} style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {columns.map(col => (
                <col key={col.idx} style={{ width: colWidths[col.idx] }} />
              ))}
            </colgroup>
            <thead>
              {/* ── column labels + resize handles ── */}
              <tr>
                {columns.map(col => (
                  <th key={col.idx} style={{ position: 'relative', width: colWidths[col.idx] }}>
                    <span className={styles.thText}>{col.label}</span>
                    <div className={styles.resizeHandle} onMouseDown={(e) => onResizeStart(e, col.idx)} />
                  </th>
                ))}
              </tr>

              {/* ── filter row ── */}
              <tr className={styles.filterRow}>
                {columns.map(col => (
                  <td key={col.idx} className={styles.filterCell}>
                    {col.type === 'dropdown' ? (
                      <select
                        className={styles.filterSelect}
                        value={filters[col.filterKey]}
                        onChange={e => setFilter(col.filterKey, e.target.value)}
                      >
                        <option value="">ทั้งหมด</option>
                        {col.options.filter(Boolean).map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.filterInput}
                        type="text"
                        placeholder="ค้นหา..."
                        value={filters[col.filterKey]}
                        onChange={e => setFilter(col.filterKey, e.target.value)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredRows.map(row => {
                const isFlashed = row.purchasing_doc_no === flashedDocNo;
                const rowKey = isFlashed
                  ? `${row.purchasing_doc_no}-${flashTick}`
                  : row.purchasing_doc_no;
                return (
                  <tr key={rowKey} className={isFlashed ? styles.flashRow : ''}>
                    <td>{row.purchasing_doc_no}</td>
                    {nameCol && <td>{contractMap[row.purchasing_doc_no]?.[nameCol] || '—'}</td>}
                    <td>{row.user_status || '—'}</td>
                    <td>{row.purchaser_status || '—'}</td>
                    <td>{row.comment || '—'}</td>
                    <td>{row.new_purchasing_doc_no || '—'}</td>
                    <td>{fmtDate(row.update_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
