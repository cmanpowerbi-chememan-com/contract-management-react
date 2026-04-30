import styles from './LoadingOverlay.module.css';

export default function LoadingOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles.ring} />
    </div>
  );
}
