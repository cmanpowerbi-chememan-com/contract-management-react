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

/** Raw formatter — used for CSV export and filter matching (UNCHANGED) */
function fmtDate(val) {
  if (!val) return '—';
  return String(val).substring(0, 16) || '—';
}

/**
 * DISPLAY-ONLY formatter: date on top, 12-hour AM/PM time below.
 * Used ONLY when rendering a table cell — never for CSV export or filter logic.
 * Null-safe: blank → dash.
 */
function fmtDateDisplay(val) {
  if (!val) return null; // caller renders a dash
  const raw = String(val).substring(0, 16); // "YYYY-MM-DD HH:MM"
  if (!raw || raw === '—') return null;
  const [datePart, timePart] = raw.split(' ');
  if (!datePart) return null;
  if (!timePart) return { date: datePart, time: null };
  const [hStr, mStr] = timePart.split(':');
  const h24 = parseInt(hStr, 10);
  if (isNaN(h24)) return { date: datePart, time: timePart };
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const timeFormatted = `${h12}:${mStr} ${ampm}`;
  return { date: datePart, time: timeFormatted };
}

/* ── Purchaser Status pill color map ── */
const PURCHASER_PILL = {
  'Not Start':                    styles.pillSlate,
  'RFQ - Request for Quotation':  styles.pillPink,
  'Compared':                     styles.pillAmber,
  'RL - Recommend Letter':        styles.pillViolet,
  'OA Created':                   styles.pillViolet,
  'Cancel OA':                    styles.pillPink,
  'Completed':                    styles.pillMint,
};

/* ── User Status pill color map ── */
const USER_STATUS_PILL = {
  'ต่อสัญญา':   styles.pillMint,   // green — same as Completed
  'ไม่ต่อสัญญา': styles.pillPink,   // pink/red — same as RFQ/Cancel OA
};

function StatusPill({ value, colorMap }) {
  if (!value) return <span className={styles.dash}>—</span>;
  const cls = colorMap[value] || styles.pillSlate;
  return (
    <span className={`${styles.pill} ${cls}`}>
      <span className={styles.pillDot} aria-hidden="true" />
      {value}
    </span>
  );
}

/* ── Default column widths (prototype values) ── */
const DEFAULT_WIDTHS = {
  0: 130, // Doc No
  1: 220, // Contract Name
  2: 160, // User Status  — bumped from 130→160 so "ไม่ต่อสัญญา" pill fits
  3: 260, // Purchaser Status — bumped from 160→260 for long labels
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
    fmtDate(row.update_at), // RAW value — not display-formatted
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
    <section className={styles.card} aria-labelledby="table-heading">
      {/* ── card header ── */}
      <div className={styles.cardHead}>
        <span className={`${styles.headDot} ${styles.dotViolet}`} aria-hidden="true" />
        <h2 id="table-heading" className={styles.cardTitle}>รายการที่บันทึกแล้ว</h2>
        <span className={styles.spacer} />
        <span className={styles.countBadge}>
          {activeCount > 0 ? `${filteredRows.length} / ${statuses.length}` : statuses.length} รายการ
        </span>
        {activeCount > 0 && (
          <button className={styles.clearPill} onClick={clearFilters}>
            ✕ ล้างฟิลเตอร์ ({activeCount})
          </button>
        )}
      </div>

      {/* OneLake note */}
      <p className={styles.onelakeNote}>
        <span className={styles.pulse} aria-hidden="true" />
        เขียนไป OneLake โดยตรง
      </p>

      {/* ── toolbar: export + refresh ── */}
      <div className={styles.toolbar}>
        <MagneticButton
          className={styles.exportBtn}
          onClick={() => exportToCsv(filteredRows, contractMap, nameCol)}
          strength={0.35}
          radius={85}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ↓ Export CSV{activeCount > 0 ? ` (${filteredRows.length})` : ''}
        </MagneticButton>
        <button className={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
          {refreshing ? '↺ Refreshing...' : '↺ Refresh data'}
        </button>
      </div>

      {/* ── empty state ── */}
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

            {/* ── single thead: column labels row + filter row ── */}
            <thead>
              {/* column labels + resize handles */}
              <tr className={styles.theadCols}>
                {columns.map(col => (
                  <th key={col.idx} style={{ width: colWidths[col.idx] }}>
                    <span className={styles.thText}>{col.label}</span>
                    <div className={styles.resizeHandle} onMouseDown={(e) => onResizeStart(e, col.idx)} />
                  </th>
                ))}
              </tr>

              {/* filter row */}
              <tr className={styles.theadFilters}>
                {columns.map(col => (
                  <th key={col.idx} className={styles.filterCell}>
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
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredRows.map(row => {
                const isFlashed = row.purchasing_doc_no === flashedDocNo;
                const rowKey = isFlashed
                  ? `${row.purchasing_doc_no}-${flashTick}`
                  : row.purchasing_doc_no;
                const dtDisplay = fmtDateDisplay(row.update_at);
                return (
                  <tr key={rowKey} className={isFlashed ? styles.flashRow : ''}>
                    <td className={styles.tdDocNo}>{row.purchasing_doc_no}</td>
                    {nameCol && <td className={styles.tdName}>{contractMap[row.purchasing_doc_no]?.[nameCol] || '—'}</td>}
                    <td>
                      <StatusPill value={row.user_status} colorMap={USER_STATUS_PILL} />
                    </td>
                    <td>
                      <StatusPill value={row.purchaser_status} colorMap={PURCHASER_PILL} />
                    </td>
                    <td className={styles.tdComment}>{row.comment || '—'}</td>
                    <td className={styles.tdNewNo}>{row.new_purchasing_doc_no || '—'}</td>
                    {/* DISPLAY-ONLY date formatter — raw value used for filters/CSV above */}
                    <td className={styles.tdUpdated}>
                      {dtDisplay ? (
                        <>
                          <span className={styles.uDate}>{dtDisplay.date}</span>
                          {dtDisplay.time && <span className={styles.uTime}>{dtDisplay.time}</span>}
                        </>
                      ) : (
                        <span className={styles.dash}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
