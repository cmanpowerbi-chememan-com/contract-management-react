import { useState, useEffect, useRef } from 'react';
import { saveStatus } from '../services/api';
import styles from './ContractForm.module.css';

function DocSearch({ docNumbers, docNumbersLoading, value, onChange }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Sync display when parent clears value
  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  const filtered = query.trim()
    ? docNumbers.filter(n => n.includes(query.trim()))
    : docNumbers;

  const select = (docNo) => {
    setQuery(docNo);
    onChange(docNo);
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (docNumbersLoading) return (
    <div className={styles.inputSkeleton}>Loading doc list…</div>
  );

  return (
    <div className={styles.comboWrap} ref={ref}>
      <input
        className={`${styles.input} ${styles.inputWhite}`}
        type="text"
        value={query}
        placeholder="ค้นหา Doc No..."
        onChange={e => { setQuery(e.target.value); onChange(''); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className={styles.dropdown}>
          {filtered.slice(0, 50).map(n => (
            <li
              key={n}
              className={`${styles.dropdownItem} ${n === value ? styles.dropdownItemActive : ''}`}
              onMouseDown={() => select(n)}
            >
              {n}
            </li>
          ))}
          {filtered.length > 50 && (
            <li className={styles.dropdownMore}>+{filtered.length - 50} รายการ — พิมพ์เพื่อค้นหาเพิ่ม</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function ContractForm({ docNumbers, docNumbersLoading, options, existingStatuses, onSave }) {
  const [docNo, setDocNo] = useState('');
  const [purchaserStatus, setPurchaserStatus] = useState('');
  const [comment, setComment] = useState('');
  const [newDocNo, setNewDocNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Pre-fill form from existing saved row; default status to first option (like Streamlit index=0)
  useEffect(() => {
    if (!docNo) return;
    const existing = existingStatuses.find(s => s.purchasing_doc_no === docNo);
    if (existing) {
      setPurchaserStatus(existing.purchaser_status || options[0] || '');
      setComment(existing.comment || '');
      setNewDocNo(existing.new_purchasing_doc_no || '');
    } else {
      setPurchaserStatus(options[0] || '');
      setComment('');
      setNewDocNo('');
    }
  }, [docNo]);

  const handleSave = async () => {
    if (!docNo || !purchaserStatus || saving) return;
    setSaveError('');
    setSaving(true);
    try {
      // Preserve existing user_status from email alerts — never overwrite it
      const existing = existingStatuses.find(s => s.purchasing_doc_no === docNo);
      const userStatus = existing?.user_status || '';

      const result = await saveStatus({
        purchasing_doc_no: docNo,
        purchaser_status: purchaserStatus,
        comment,
        new_purchasing_doc_no: newDocNo,
        user_status: userStatus,
      });
      onSave({
        purchasing_doc_no: docNo,
        user_status: userStatus,
        purchaser_status: purchaserStatus,
        comment,
        new_purchasing_doc_no: newDocNo,
        update_at: result.update_at,
      });
    } catch (err) {
      setSaveError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <h2 className={styles.title}>เพิ่ม / แก้ไข</h2>

      <div className={styles.field}>
        <label className={styles.label}>Purchasing Doc No</label>
        <DocSearch
          docNumbers={docNumbers}
          docNumbersLoading={docNumbersLoading}
          value={docNo}
          onChange={setDocNo}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Purchaser Status</label>
        <select className={styles.select} value={purchaserStatus} onChange={e => setPurchaserStatus(e.target.value)}>
          <option value="">— Select —</option>
          {options.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Comment</label>
        <textarea
          className={styles.textarea}
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Enter comment..."
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>เลขสัญญาใหม่</label>
        <input
          className={styles.input}
          type="text"
          value={newDocNo}
          onChange={e => setNewDocNo(e.target.value.replace(/\D/g, ''))}
          placeholder="Digits only"
        />
      </div>

      <button
        className={styles.saveBtn}
        onClick={handleSave}
        disabled={!docNo || !purchaserStatus || saving}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      {saving && <p className={styles.savingNote}>Writing to OneLake…</p>}
      {saveError && <p className={styles.errorNote}>{saveError}</p>}
    </div>
  );
}
