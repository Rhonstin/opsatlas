'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ConfigExport, ConfigImportResult } from '@/lib/api';
import { encryptConfig, decryptConfig, isEncryptedEnvelope } from '@/lib/config-crypto';
import { useToast } from '@/lib/toast';
import styles from './settings.module.css';

const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar ($)' },
  { code: 'EUR', label: 'EUR — Euro (€)' },
  { code: 'SGD', label: 'SGD — Singapore Dollar (S$)' },
  { code: 'GBP', label: 'GBP — British Pound (£)' },
  { code: 'AUD', label: 'AUD — Australian Dollar (A$)' },
  { code: 'CAD', label: 'CAD — Canadian Dollar (CA$)' },
  { code: 'JPY', label: 'JPY — Japanese Yen (¥)' },
  { code: 'INR', label: 'INR — Indian Rupee (₹)' },
  { code: 'HKD', label: 'HKD — Hong Kong Dollar (HK$)' },
  { code: 'CHF', label: 'CHF — Swiss Franc (Fr)' },
];

export default function ConfigTab() {
  const { toast } = useToast();
  const [allowRegistrations, setAllowRegistrations] = useState<boolean | null>(null);
  const [togglingReg, setTogglingReg] = useState(false);

  // Currency state
  const [preferredCurrency, setPreferredCurrency] = useState('USD');
  const [savingCurrency, setSavingCurrency] = useState(false);

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPw, setExportPw] = useState('');
  const [exportPwConfirm, setExportPwConfirm] = useState('');
  const [exportPwError, setExportPwError] = useState('');
  const [exporting, setExporting] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ConfigImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [pendingFile, setPendingFile] = useState<string | null>(null); // raw file text awaiting password
  const [importPw, setImportPw] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getServerConfig()
      .then((cfg) => {
        setAllowRegistrations(cfg.allowRegistrations ?? true);
        setPreferredCurrency(cfg.preferredCurrency ?? 'USD');
      })
      .catch(() => setAllowRegistrations(true));
  }, []);

  async function handleSaveCurrency() {
    setSavingCurrency(true);
    try {
      await api.setPreferredCurrency(preferredCurrency);
      toast('success', `Currency set to ${preferredCurrency} — re-sync connections to apply`);
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Failed to save currency');
    } finally {
      setSavingCurrency(false);
    }
  }

  async function handleToggleRegistrations() {
    if (allowRegistrations === null) return;
    const next = !allowRegistrations;
    setTogglingReg(true);
    try {
      await api.setAllowRegistrations(next);
      setAllowRegistrations(next);
      toast('success', next ? 'Registrations enabled' : 'Registrations disabled');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'Failed to update setting');
    } finally {
      setTogglingReg(false);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  function openExportModal() {
    setExportPw('');
    setExportPwConfirm('');
    setExportPwError('');
    setShowExportModal(true);
  }

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (exportPw.length < 8) { setExportPwError('Password must be at least 8 characters'); return; }
    if (exportPw !== exportPwConfirm) { setExportPwError('Passwords do not match'); return; }
    setExportPwError('');
    setExporting(true);
    try {
      const data = await api.exportConfig();
      const plaintext = JSON.stringify(data, null, 2);
      const encrypted = await encryptConfig(plaintext, exportPw);
      const blob = new Blob([encrypted], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opsatlas-config-${new Date().toISOString().slice(0, 10)}.opsatlas`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      toast('success', 'Config exported (AES-256-GCM encrypted)');
    } catch (err: unknown) {
      setExportPwError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // ── Import ──────────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImportPw('');

    const text = await file.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { setImportError('Invalid file — not valid JSON'); return; }

    if (isEncryptedEnvelope(parsed)) {
      // Encrypted — need password before we can import
      setPendingFile(text);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    // Plain JSON (legacy) — import directly
    setPendingFile(null);
    await doImport(text);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleDecryptAndImport(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFile) return;
    setImportError('');
    setImporting(true);
    try {
      const plaintext = await decryptConfig(pendingFile, importPw);
      await doImport(plaintext);
      setPendingFile(null);
      setImportPw('');
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Decryption failed');
    } finally {
      setImporting(false);
    }
  }

  async function doImport(text: string) {
    setImporting(true);
    try {
      let parsed: ConfigExport;
      try { parsed = JSON.parse(text) as ConfigExport; } catch { throw new Error('Invalid JSON'); }
      if (!parsed.version || !Array.isArray(parsed.cloud_connections)) throw new Error('Not a valid opsatlas config file');
      const result = await api.importConfig(parsed);
      setImportResult(result);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const typeLabel = (type: string) => {
    if (type === 'cloud_connection') return 'Cloud connection';
    if (type === 'dns_connection') return 'DNS connection';
    if (type === 'auto_update_policy') return 'Auto-update policy';
    return type;
  };

  return (
    <section>
      {/* Export password modal */}
      {showExportModal && (
        <div className={styles.pwOverlay} onClick={(e) => e.target === e.currentTarget && setShowExportModal(false)}>
          <div className={styles.pwModal}>
            <div className={styles.pwTitle}>Export config</div>
            <div className={styles.pwDesc}>
              Set a password to encrypt the file with AES-256-GCM. You will need it to import the backup.
            </div>
            <form onSubmit={handleExport} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className={styles.pwField}>
                <label className={styles.pwLabel}>Password</label>
                <input
                  type="password"
                  className={styles.pwInput}
                  value={exportPw}
                  onChange={(e) => setExportPw(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoFocus
                />
              </div>
              <div className={styles.pwField}>
                <label className={styles.pwLabel}>Confirm password</label>
                <input
                  type="password"
                  className={styles.pwInput}
                  value={exportPwConfirm}
                  onChange={(e) => setExportPwConfirm(e.target.value)}
                  placeholder="Repeat password"
                />
              </div>
              {exportPwError && <div className={styles.pwError}>{exportPwError}</div>}
              <div className={styles.pwActions}>
                <button type="button" className="btn-ghost" onClick={() => setShowExportModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={exporting}>
                  {exporting ? 'Encrypting…' : 'Export & Download'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Configuration</div>
          <div className={styles.sectionDesc}>Export or import all connections and policies</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>New registrations</div>
            <div className={styles.cardDesc}>
              Allow new users to sign up with email and password. Disable this once your team is set up.
            </div>
          </div>
          <button
            className={allowRegistrations ? 'btn-danger' : 'btn-primary'}
            style={{ fontSize: '0.8125rem', flexShrink: 0 }}
            onClick={handleToggleRegistrations}
            disabled={togglingReg || allowRegistrations === null}
          >
            {togglingReg ? 'Saving…' : allowRegistrations ? 'Disable' : 'Enable'}
          </button>
        </div>
        {allowRegistrations !== null && (
          <div style={{ marginTop: '0.625rem', fontSize: '0.8125rem', color: allowRegistrations ? '#22c55e' : 'var(--muted)' }}>
            {allowRegistrations ? 'Registrations are open' : 'Registrations are closed — SSO or invite only'}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Display currency</div>
            <div className={styles.cardDesc}>
              All estimated costs and billing actuals are converted to this currency during sync using live exchange rates (Frankfurter / ECB). Re-sync connections after changing.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
            <select
              value={preferredCurrency}
              onChange={(e) => setPreferredCurrency(e.target.value)}
              style={{ width: 230 }}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <button className="btn-primary" style={{ fontSize: '0.8125rem' }} onClick={handleSaveCurrency} disabled={savingCurrency}>
              {savingCurrency ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Export</div>
            <div className={styles.cardDesc}>
              Download all cloud connections, DNS connections, and auto-update policies.
              Credentials are encrypted with your chosen password using AES-256-GCM.
            </div>
          </div>
          <button className="btn-primary" onClick={openExportModal}>Export</button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>
              Import
              {pendingFile && <span className={styles.encryptedBadge}>🔒 encrypted</span>}
            </div>
            <div className={styles.cardDesc}>
              Restore connections and policies from a previously exported file.
              Existing items (matched by provider + name) are skipped.
            </div>
          </div>
          {!pendingFile && (
            <div>
              <input ref={fileRef} type="file" accept=".json,.opsatlas,application/json" style={{ display: 'none' }} onChange={handleFileChange} />
              <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? 'Importing…' : 'Import file'}
              </button>
            </div>
          )}
        </div>

        {/* Decrypt form for encrypted files */}
        {pendingFile && (
          <form onSubmit={handleDecryptAndImport} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className={styles.pwField}>
              <label className={styles.pwLabel}>Decryption password</label>
              <input
                type="password"
                className={styles.pwInput}
                value={importPw}
                onChange={(e) => setImportPw(e.target.value)}
                placeholder="Enter the password used during export"
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '0.625rem' }}>
              <button type="button" className="btn-ghost" onClick={() => { setPendingFile(null); setImportPw(''); setImportError(''); }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={importing}>
                {importing ? 'Decrypting…' : 'Decrypt & Import'}
              </button>
            </div>
          </form>
        )}

        {importError && <div className={styles.error}>{importError}</div>}
        {importResult && (
          <div className={styles.resultBox}>
            <div className={styles.resultSummary}>
              <span className={styles.created}>{importResult.created} created</span>
              <span className={styles.skipped}>{importResult.skipped} skipped</span>
            </div>
            <div className={styles.resultList}>
              {importResult.results.map((r, i) => (
                <div key={i} className={styles.resultRow}>
                  <span className={`${styles.dot} ${r.status === 'created' ? styles.dotCreated : styles.dotSkipped}`} />
                  <span className={styles.resultType}>{typeLabel(r.type)}</span>
                  <span className={styles.resultName}>{r.name}</span>
                  <span className={styles.resultStatus}>{r.status === 'created' ? 'created' : `skipped${r.reason ? ` — ${r.reason}` : ''}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
