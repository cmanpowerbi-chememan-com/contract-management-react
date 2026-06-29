import { useState, useEffect, useRef } from 'react';
import { saveStatus } from '../services/api';
import { MagneticButton } from './ui/magnetic-button';
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
      <span className={styles.comboIcon} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </span>
      <input
        className={`${styles.input} ${styles.inputCombo}`}
        type="text"
        value={query}
        placeholder="ค้นหา Doc No..."
        onChange={e => { setQuery(e.target.value); onChange(''); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
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
    <section className={styles.card} aria-labelledby="form-heading">
      <div className={styles.cardHead}>
        <span className={`${styles.headDot} ${styles.dotPink}`} aria-hidden="true" />
        <h2 id="form-heading" className={styles.cardTitle}>เพิ่ม / แก้ไข</h2>
      </div>

      {/* Horizontal entry bar — all fields + Save button in one row */}
      <div className={styles.formRow}>
        {/* Doc No combobox */}
        <div className={`${styles.field} ${styles.fieldDoc}`}>
          <label className={styles.label} htmlFor="docno-input">Purchasing Doc No</label>
          <DocSearch
            docNumbers={docNumbers}
            docNumbersLoading={docNumbersLoading}
            value={docNo}
            onChange={setDocNo}
          />
        </div>

        {/* Purchaser Status */}
        <div className={`${styles.field} ${styles.fieldStatus}`}>
          <label className={styles.label} htmlFor="pstatus-select">Purchaser Status</label>
          <select
            id="pstatus-select"
            className={styles.select}
            value={purchaserStatus}
            onChange={e => setPurchaserStatus(e.target.value)}
          >
            <option value="">— Select —</option>
            {options.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>

        {/* Comment */}
        <div className={`${styles.field} ${styles.fieldComment}`}>
          <label className={styles.label} htmlFor="comment-input">Comment</label>
          <textarea
            id="comment-input"
            className={styles.textarea}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Enter comment..."
            rows={1}
          />
        </div>

        {/* เลขสัญญาใหม่ */}
        <div className={`${styles.field} ${styles.fieldNewNo}`}>
          <label className={styles.label} htmlFor="newno-input">เลขสัญญาใหม่</label>
          <input
            id="newno-input"
            className={styles.input}
            type="text"
            value={newDocNo}
            onChange={e => setNewDocNo(e.target.value.replace(/\D/g, ''))}
            placeholder="Digits only"
          />
        </div>

        {/* Save button */}
        <div className={`${styles.field} ${styles.fieldSave}`}>
          {/* Invisible label to keep vertical alignment consistent */}
          <label className={styles.labelHidden} aria-hidden="true">Save</label>
          <MagneticButton
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!docNo || !purchaserStatus || saving}
            strength={0.4}
            radius={100}
          >
            <span className={styles.saveBtnIcon} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </span>
            {saving ? 'Saving...' : 'Save'}
          </MagneticButton>
        </div>
      </div>

      {/* OneLake note + error */}
      <p className={styles.onelakeNote}>
        <span className={styles.pulse} aria-hidden="true" />
        เขียนไป OneLake โดยตรง
      </p>
      {saveError && <p className={styles.errorNote}>{saveError}</p>}
    </section>
  );
}
