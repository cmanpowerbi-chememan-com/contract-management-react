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
  // Show YYYY-MM-DD HH:MM only (strip seconds), matching Streamlit strftime("%Y-%m-%d %H:%M")
  return String(val).substring(0, 16) || '—';
}

export default function ContractTable({ contracts, statuses, flashedDocNo, flashTick, onRefresh, refreshing }) {
  const nameCol = findNameCol(contracts);
  const contractMap = Object.fromEntries(contracts.map(c => [c.purchasing_doc_no, c]));
  const rows = statuses.slice(0, 20);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>รายการที่บันทึกแล้ว</span>
          <span className={styles.badge}>{statuses.length} รายการ</span>
        </div>
        <button className={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? '↺ Refreshing...' : '↺ Refresh data'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>ยังไม่มีข้อมูล</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Doc No</th>
                {nameCol && <th>Contract Name</th>}
                <th>User Status</th>
                <th>Purchaser Status</th>
                <th>Comment</th>
                <th>เลขสัญญาใหม่</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
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
