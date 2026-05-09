import { useState, useEffect, useRef } from 'react';
import { getContracts, getDocNumbers, getStatus, refreshStatus, getOptions } from './services/api';
import LoadingOverlay from './components/LoadingOverlay';
import ContractForm from './components/ContractForm';
import ContractTable from './components/ContractTable';
import { BackgroundGradientAnimation } from './components/ui/background-gradient-animation';
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
    showToast(`✅ Saved — ${entry.purchasing_doc_no}`);
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
    <BackgroundGradientAnimation
      gradientBackgroundStart="rgb(8, 8, 18)"
      gradientBackgroundEnd="rgb(5, 5, 20)"
      firstColor="4, 100, 140"
      secondColor="90, 40, 140"
      thirdColor="60, 30, 100"
      fourthColor="20, 60, 120"
      fifthColor="50, 50, 110"
      pointerColor="80, 50, 160"
      containerClassName="min-h-screen"
    >
      {/* dark veil to dim the animated blobs */}
      <div className="absolute inset-0 bg-black/60 z-[5]" />
      <div className={`${styles.app} absolute inset-0 z-10`}>
        <div>
          <h1 className={styles.title}>Contract Status</h1>
          <p className={styles.caption}>กรอก Purchaser Status สำหรับแต่ละ Purchasing Doc</p>
        </div>
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
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </BackgroundGradientAnimation>
  );
}
