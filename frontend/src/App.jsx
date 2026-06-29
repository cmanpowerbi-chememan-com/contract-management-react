import { useState, useEffect, useRef } from 'react';
import { getContracts, getDocNumbers, getStatus, refreshStatus, getOptions } from './services/api';
import LoadingOverlay from './components/LoadingOverlay';
import ContractForm from './components/ContractForm';
import ContractTable from './components/ContractTable';
import { PlayfulBackground } from './components/ui/playful-background';
import styles from './App.module.css';

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [docNumbers, setDocNumbers] = useState([]);
  const [docNumbersLoading, setDocNumbersLoading] = useState(true);
  const [statuses, setStatuses] = useState([]);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [flashedDocNo, setFlashedDocNo] = useState(null);
  const [flashTick, setFlashTick] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    // Show UI as soon as status + options are ready — other data loads in background
    Promise.all([getStatus(), getOptions()])
      .then(([s, o]) => {
        setStatuses(s);
        setOptions(o);
      })
      .catch(err => {
        setLoadError(`Cannot connect to backend: ${err.message}. Make sure the FastAPI server is running on http://localhost:8000`);
      })
      .finally(() => setLoading(false));

    // Doc numbers from silver_sap_tct_header — populates the dropdown
    getDocNumbers()
      .then(nums => setDocNumbers(nums))
      .catch(() => {})
      .finally(() => setDocNumbersLoading(false));

    // Contracts from gold_contract_management — used for contract name join in table
    getContracts()
      .then(c => setContracts(c))
      .catch(() => {});
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const handleSave = (entry) => {
    setStatuses(prev => [
      entry,
      ...prev.filter(s => s.purchasing_doc_no !== entry.purchasing_doc_no),
    ]);
    setFlashedDocNo(entry.purchasing_doc_no);
    setFlashTick(t => t + 1);
    showToast(`Saved — ${entry.purchasing_doc_no}`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const s = await refreshStatus();  // force-reload from OneLake, bypass cache
      setStatuses(s);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <LoadingOverlay />;

  if (loadError) return (
    <div className={styles.errorScreen}>
      <p className={styles.errorMsg}>{loadError}</p>
      <button className={styles.retryBtn} onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );

  return (
    <PlayfulBackground>
      {/* ── Page header ── */}
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          Procurement Tracker
        </span>
        <h1 className={styles.title}>
          Contract <span className={styles.titlePop}>Status</span>
        </h1>
        <svg className={styles.squiggle} viewBox="0 0 240 14" fill="none" aria-hidden="true">
          <path d="M2 8 Q16 1 30 8 T58 8 T86 8 T114 8 T142 8 T170 8 T198 8 T226 8" stroke="#F472B6" strokeWidth="4" strokeLinecap="round"/>
        </svg>
        <p className={styles.caption}>กรอก Purchaser Status สำหรับแต่ละ Purchasing Doc</p>
      </header>

      {/* ── Main content: form on top, table below ── */}
      <div className={styles.layout}>
        <ContractForm
          docNumbers={docNumbers}
          docNumbersLoading={docNumbersLoading}
          options={options}
          existingStatuses={statuses}
          onSave={handleSave}
        />
        <ContractTable
          contracts={contracts}
          statuses={statuses}
          flashedDocNo={flashedDocNo}
          flashTick={flashTick}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          <span className={styles.toastCheck} aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1E293B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          {toast}
        </div>
      )}
    </PlayfulBackground>
  );
}
