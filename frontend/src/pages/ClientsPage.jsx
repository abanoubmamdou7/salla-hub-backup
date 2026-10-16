import { useState, useEffect, useCallback } from 'react';
import { clientsList, clientCreate, clientUpdate, clientDelete, clientStores, clientAuthUrl } from '../api/client';

const EMPTY_FORM = {
  name: '', slug: '',
  sallaClientId: '', sallaClientSecret: '', sallaWebhookSecret: '',
  hubApiKey: '', clientId: '',
  xEnvironment: 'production',
  playerIdField: 'الأيدي',
  telegramBotToken: '', telegramChatId: '',
  blockOrdersAfterMinutes: '',
  isActive: true,
};

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    </svg>
  );
}

function IconStore() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskSecret(val) {
  if (!val) return null;
  if (val.length <= 10) return '••••••••';
  return val.slice(0, 4) + '••••' + val.slice(-4);
}

function tokenStatus(expiresAt) {
  if (!expiresAt) return { label: 'unknown', cls: '' };
  const ms = new Date(expiresAt) - Date.now();
  const h  = ms / 3600000;
  if (ms < 0)  return { label: 'expired',  cls: 'token-expired'  };
  if (h < 24)  return { label: `${Math.round(h)}h left`, cls: 'token-warn' };
  const days = Math.floor(h / 24);
  return { label: `${days}d left`, cls: 'token-ok' };
}

// ── Stores Modal ──────────────────────────────────────────────────────────────
function StoresModal({ client, onClose }) {
  const [stores, setStores]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl]         = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    clientStores(client.id)
      .then((d) => setStores(d.data ?? []))
      .catch(() => setStores([]))
      .finally(() => setLoading(false));
    clientAuthUrl(client.id)
      .then((d) => setUrl(d.authUrl ?? ''))
      .catch(() => {});
  }, [client.id]);

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content clients-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Connected Stores</h2>
            <p className="modal-subtitle">{client.name}</p>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        {url && (
          <div style={{ marginBottom: 16 }}>
            <p className="clients-auth-hint">Share this link with the merchant. After they authorize, their store is connected automatically.</p>
            <div className="clients-url-box">
              <code className="clients-url-text">{url}</code>
            </div>
            <div className="clients-auth-actions">
              <button className={`btn-primary${copied ? ' clients-btn-copied' : ''}`} onClick={copy}>
                {copied ? <><IconCheck /> Copied!</> : 'Copy OAuth Link'}
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost clients-open-link">Open ↗</a>
            </div>
          </div>
        )}

        {loading ? (
          <div className="table-loading"><div className="spinner" aria-hidden /><p>Loading…</p></div>
        ) : stores.length === 0 ? (
          <div className="clients-empty-msg">
            <IconStore />
            <p>No stores connected yet.</p>
            <p className="clients-empty-hint">Share the OAuth link above with the merchant to connect their store.</p>
          </div>
        ) : (
          <table className="orders-table">
            <thead>
              <tr>
                <th>Store ID</th>
                <th>Token Status</th>
                <th>Expires At</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const { label, cls } = tokenStatus(s.expiresAt);
                return (
                  <tr key={s.storeId}>
                    <td><code className="clients-code">{s.storeId}</code></td>
                    <td><span className={`clients-token-badge ${cls}`}>{label}</span></td>
                    <td className="brands-date-cell">{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}</td>
                    <td className="brands-date-cell">{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── OAuth URL Modal ───────────────────────────────────────────────────────────
function AuthUrlModal({ client, onClose }) {
  const [url, setUrl]         = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    clientAuthUrl(client.id)
      .then((d) => setUrl(d.authUrl ?? ''))
      .catch(() => setUrl(''))
      .finally(() => setLoading(false));
  }, [client.id]);

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content clients-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>OAuth Authorization URL</h2>
            <p className="modal-subtitle">{client.name}</p>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div className="table-loading"><div className="spinner" aria-hidden /></div>
        ) : (
          <>
            <p className="clients-auth-hint">
              Send this link to the merchant. After they click it and authorize your Salla app, their store token will be saved automatically.
            </p>
            <div className="clients-url-box">
              <code className="clients-url-text">{url}</code>
            </div>
            <div className="clients-auth-actions">
              <button className={`btn-primary${copied ? ' clients-btn-copied' : ''}`} onClick={copy}>
                {copied ? <><IconCheck /> Copied!</> : 'Copy Link'}
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost clients-open-link">
                Open in browser ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Client Drawer ─────────────────────────────────────────────────────────────
function ClientDrawer({ form, editingId, saving, formError, showMasa, onChange, onSlugChange, onToggleMasa, onSubmit, onCancel }) {
  return (
    <>
      <div className="cl-drawer-backdrop" onClick={onCancel} />
      <div className="cl-drawer">
        {/* Drawer header */}
        <div className="cl-drawer-header">
          <div>
            <h2 className="cl-drawer-title">{editingId ? 'Edit Client' : 'New Client'}</h2>
            <p className="cl-drawer-subtitle">
              {editingId ? 'Update Salla OAuth credentials' : 'Add a new tenant client'}
            </p>
          </div>
          <button className="cl-drawer-close" onClick={onCancel} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {/* Drawer body */}
        <form onSubmit={onSubmit} className="cl-drawer-body">
          {/* Basic Info */}
          <div className="cl-drawer-section">
            <span className="cl-drawer-section-label">Basic Info</span>
            <div className="cl-drawer-grid">
              <label className="cl-field">
                <span>Client Name</span>
                <input value={form.name} onChange={onChange('name')} placeholder="Acme Store" autoComplete="off" />
              </label>
              <label className="cl-field">
                <span>Slug</span>
                <input value={form.slug} onChange={onSlugChange} placeholder="acme-store" autoComplete="off" className="brands-field-mono" />
                <span className="cl-field-hint">Lowercase letters, numbers, hyphens only</span>
              </label>
            </div>
            <label className="cl-toggle">
              <input type="checkbox" checked={form.isActive} onChange={onChange('isActive')} />
              <span className="cl-toggle-track"><span className="cl-toggle-thumb" /></span>
              <span className="cl-toggle-label">Active</span>
              <span className="cl-field-hint" style={{ marginTop: 0 }}>Inactive clients cannot authorize or receive webhooks</span>
            </label>
          </div>

          {/* Salla OAuth */}
          <div className="cl-drawer-section">
            <div className="cl-drawer-section-label-row">
              <span className="cl-drawer-section-label">Salla OAuth</span>
              <span className="cl-drawer-section-hint">From your Salla Partner Dashboard</span>
            </div>
            <div className="cl-drawer-grid">
              <label className="cl-field">
                <span>Client ID</span>
                <input value={form.sallaClientId} onChange={onChange('sallaClientId')} placeholder="16a31f30-7dea-…" autoComplete="off" className="brands-field-mono" />
              </label>
              <label className="cl-field">
                <span>Client Secret</span>
                <input value={form.sallaClientSecret} onChange={onChange('sallaClientSecret')} placeholder="6361a89f…" autoComplete="off" className="brands-field-mono" type="password" />
              </label>
              <label className="cl-field">
                <span>Webhook Secret <span className="cl-field-optional">optional</span></span>
                <input value={form.sallaWebhookSecret} onChange={onChange('sallaWebhookSecret')} placeholder="whsec_…" autoComplete="off" className="brands-field-mono" />
                <span className="cl-field-hint">Set in your Salla app webhook settings</span>
              </label>
            </div>
          </div>

          {/* Supplier Hub */}
          <div className="cl-drawer-section">
            <button type="button" className="cl-collapsible" onClick={onToggleMasa}>
              <span className="cl-collapsible-icon"><IconKey /></span>
              <span>Supplier Hub Settings</span>
              <span className={`cl-collapsible-arrow${showMasa ? ' open' : ''}`}><IconChevron /></span>
            </button>
            {showMasa && (
              <div className="cl-drawer-grid" style={{ marginTop: '0.75rem' }}>
                <label className="cl-field">
                  <span>X-API-KEY</span>
                  <input value={form.hubApiKey} onChange={onChange('hubApiKey')} placeholder="hub_…" autoComplete="off" className="brands-field-mono" />
                </label>
                <label className="cl-field">
                  <span>Client ID</span>
                  <input value={form.clientId} onChange={onChange('clientId')} placeholder="ch_…" autoComplete="off" className="brands-field-mono" />
                </label>
                <label className="cl-field">
                  <span>Environment</span>
                  <select value={form.xEnvironment} onChange={onChange('xEnvironment')} style={{ fontFamily: 'inherit', fontSize: '0.875rem', padding: '0.55em 0.85em', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', color: 'var(--text)', background: 'var(--surface)' }}>
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </label>
                <label className="cl-field">
                  <span>Player ID Field</span>
                  <input value={form.playerIdField} onChange={onChange('playerIdField')} placeholder="الأيدي" autoComplete="off" />
                  <span className="cl-field-hint">Salla product option name used to extract the player ID</span>
                </label>
                <label className="cl-field">
                  <span>Telegram Bot Token</span>
                  <input value={form.telegramBotToken} onChange={onChange('telegramBotToken')} placeholder="123456:ABC-…" autoComplete="off" className="brands-field-mono" />
                </label>
                <label className="cl-field">
                  <span>Telegram Chat ID</span>
                  <input value={form.telegramChatId} onChange={onChange('telegramChatId')} placeholder="-100…" autoComplete="off" className="brands-field-mono" />
                </label>
                <label className="cl-field">
                  <span>Block Orders After <span className="cl-field-optional">minutes</span></span>
                  <input type="number" min="1" step="1" value={form.blockOrdersAfterMinutes} onChange={onChange('blockOrdersAfterMinutes')} placeholder="e.g. 5" autoComplete="off" />
                  <span className="cl-field-hint">Orders older than this (since Salla created them) are blocked — not sent to Supplier Hub. Leave empty to disable.</span>
                </label>
              </div>
            )}
          </div>

          {formError && (
            <div className="brands-form-error" style={{ marginTop: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {formError}
            </div>
          )}

          {/* Drawer footer */}
          <div className="cl-drawer-footer">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update Client' : 'Add Client'}
            </button>
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}

// ── Client Card ───────────────────────────────────────────────────────────────
function ClientCard({ c, editingId, deletingId, onEdit, onDelete, onStores, onAuthUrl, onToggleActive, togglingId }) {
  const initials = c.name.slice(0, 2).toUpperCase();
  const isEditing = editingId === c.id;
  const isToggling = togglingId === c.id;

  return (
    <div className={`cl-card${isEditing ? ' cl-card-editing' : ''}${!c.isActive ? ' cl-card-inactive' : ''}`}>
      {/* Card header */}
      <div className="cl-card-header">
        <div className="cl-card-identity">
          <div className="cl-card-avatar">{initials}</div>
          <div className="cl-card-meta">
            <span className="cl-card-name">{c.name}</span>
            <code className="cl-card-slug">{c.slug}</code>
          </div>
        </div>
        <button
          className={`cl-active-toggle${c.isActive ? ' on' : ''}`}
          onClick={() => onToggleActive(c)}
          disabled={isToggling}
          title={c.isActive ? 'Deactivate client' : 'Activate client'}
        >
          <span className="cl-active-toggle-track">
            <span className="cl-active-toggle-thumb" />
          </span>
          <span className="cl-active-toggle-label">{isToggling ? '…' : c.isActive ? 'Active' : 'Inactive'}</span>
        </button>
      </div>

      {/* Credential grid */}
      <div className="cl-card-creds">
        <div className="cl-cred">
          <span className="cl-cred-label">Salla Client ID</span>
          <code className="cl-cred-value">{maskSecret(c.sallaClientId) ?? '—'}</code>
        </div>
        <div className="cl-cred">
          <span className="cl-cred-label">Hub API Key</span>
          <code className="cl-cred-value">{maskSecret(c.hubApiKey) ?? '—'}</code>
        </div>
        <div className="cl-cred">
          <span className="cl-cred-label">Block Orders After</span>
          <code className="cl-cred-value">{c.blockOrdersAfterMinutes ? `${c.blockOrdersAfterMinutes} min` : 'Off'}</code>
        </div>
        <div className="cl-cred cl-cred-full">
          <span className="cl-cred-label">Redirect URI</span>
          <span className="cl-cred-uri">{c.sallaRedirectUri}</span>
        </div>
      </div>

      {/* Card footer */}
      <div className="cl-card-footer">
        <span className="cl-card-date">
          Added {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
        </span>
        <div className="cl-card-actions">
          <button className="cl-action-btn" title="OAuth URL" onClick={() => onAuthUrl(c)}>
            <IconLink /> OAuth URL
          </button>
          <button className="cl-action-btn" onClick={() => onStores(c)}>
            <IconStore /> Stores
          </button>
          <button className="cl-action-btn" onClick={() => onEdit(c)}>
            <IconEdit /> Edit
          </button>
          <button
            className="cl-action-btn cl-action-danger"
            onClick={() => onDelete(c)}
            disabled={deletingId === c.id}
          >
            {deletingId === c.id ? '…' : <><IconTrash /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const [clients, setClients]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [editingId, setEditingId]       = useState(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState(null);
  const [deletingId, setDeletingId]     = useState(null);
  const [togglingId, setTogglingId]     = useState(null);
  const [storesFor, setStoresFor]       = useState(null);
  const [authUrlFor, setAuthUrlFor]     = useState(null);
  const [showMasa, setShowMasa]         = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    clientsList()
      .then((d) => setClients(d.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowMasa(false);
    setDrawerOpen(true);
  }

  function startEdit(c) {
    setEditingId(c.id);
    setForm({
      name:               c.name ?? '',
      slug:               c.slug ?? '',
      sallaClientId:      c.sallaClientId ?? '',
      sallaClientSecret:  c.sallaClientSecret ?? '',
      sallaWebhookSecret: c.sallaWebhookSecret ?? '',
      hubApiKey:          c.hubApiKey ?? '',
      clientId:           c.masaClientId ?? '',
      xEnvironment:       c.xEnvironment ?? 'production',
      playerIdField:      c.playerIdField ?? 'الأيدي',
      telegramBotToken:   c.telegramBotToken ?? '',
      telegramChatId:     c.telegramChatId ?? '',
      blockOrdersAfterMinutes: c.blockOrdersAfterMinutes ?? '',
      isActive:           c.isActive ?? true,
    });
    setFormError(null);
    setShowMasa(false);
    setDrawerOpen(true);
  }

  function cancelEdit() {
    setDrawerOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function onChange(key) {
    return (e) => setForm((prev) => ({
      ...prev,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));
  }

  function slugify(val) {
    return val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function onSlugChange(e) {
    setForm((p) => ({ ...p, slug: slugify(e.target.value) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim())              return setFormError('Name is required');
    if (!form.slug.trim())              return setFormError('Slug is required');
    if (!form.sallaClientId.trim())     return setFormError('Salla Client ID is required');
    if (!form.sallaClientSecret.trim()) return setFormError('Salla Client Secret is required');

    setSaving(true);
    try {
      const payload = {
        name:               form.name.trim(),
        slug:               slugify(form.slug),
        sallaClientId:      form.sallaClientId.trim(),
        sallaClientSecret:  form.sallaClientSecret.trim(),
        sallaWebhookSecret: form.sallaWebhookSecret.trim() || null,
        isActive:           form.isActive,
        ...(form.hubApiKey.trim()         && { hubApiKey:         form.hubApiKey.trim() }),
        ...(form.clientId.trim()          && { clientId:          form.clientId.trim() }),
        xEnvironment:      form.xEnvironment || 'production',
        playerIdField:     form.playerIdField.trim() || 'الأيدي',
        ...(form.telegramBotToken.trim()  && { telegramBotToken:  form.telegramBotToken.trim() }),
        ...(form.telegramChatId.trim()    && { telegramChatId:    form.telegramChatId.trim() }),
        blockOrdersAfterMinutes:
          String(form.blockOrdersAfterMinutes).trim() === ''
            ? null
            : parseInt(form.blockOrdersAfterMinutes, 10),
      };

      if (editingId) {
        await clientUpdate(editingId, payload);
      } else {
        await clientCreate(payload);
      }
      cancelEdit();
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(c) {
    setTogglingId(c.id);
    try {
      await clientUpdate(c.id, { isActive: !c.isActive });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete "${c.name}"? Their linked store tokens will be unlinked.`)) return;
    setDeletingId(c.id);
    try {
      await clientDelete(c.id);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="dashboard">
      {/* ── Page Header ── */}
      <div className="cl-page-header">
        <div className="cl-page-header-left">
          <h1 className="cl-page-title">Clients</h1>
          <p className="cl-page-desc">Manage Salla OAuth credentials for each tenant</p>
        </div>
        <div className="cl-page-header-right">
          {!loading && !error && clients.length > 0 && (
            <span className="cl-count-pill">{clients.length} client{clients.length !== 1 ? 's' : ''}</span>
          )}
          <button className="cl-new-btn" onClick={openNew}>
            <IconPlus /> New Client
          </button>
        </div>
      </div>

      {/* ── Client List ── */}
      {loading ? (
        <div className="table-wrap table-loading-wrap">
          <div className="table-loading">
            <div className="spinner" aria-hidden />
            <p>Loading clients…</p>
          </div>
        </div>
      ) : error ? (
        <div className="table-wrap"><div className="table-error-inline">Error: {error}</div></div>
      ) : clients.length === 0 ? (
        <div className="cl-empty-state">
          <div className="cl-empty-icon"><IconUsers /></div>
          <p className="cl-empty-title">No clients yet</p>
          <p className="cl-empty-desc">Add your first client to start managing multi-tenant Salla credentials.</p>
          <button className="cl-new-btn" onClick={openNew}>
            <IconPlus /> Add First Client
          </button>
        </div>
      ) : (
        <div className="cl-cards">
          {clients.map((c) => (
            <ClientCard
              key={c.id}
              c={c}
              editingId={editingId}
              deletingId={deletingId}
              onEdit={startEdit}
              onDelete={handleDelete}
              onStores={setStoresFor}
              onAuthUrl={setAuthUrlFor}
              onToggleActive={handleToggleActive}
              togglingId={togglingId}
            />
          ))}
        </div>
      )}

      {/* ── Drawer ── */}
      {drawerOpen && (
        <ClientDrawer
          form={form}
          editingId={editingId}
          saving={saving}
          formError={formError}
          showMasa={showMasa}
          onChange={onChange}
          onSlugChange={onSlugChange}
          onToggleMasa={() => setShowMasa((v) => !v)}
          onSubmit={handleSubmit}
          onCancel={cancelEdit}
        />
      )}

      {storesFor  && <StoresModal  client={storesFor}  onClose={() => setStoresFor(null)}  />}
      {authUrlFor && <AuthUrlModal client={authUrlFor} onClose={() => setAuthUrlFor(null)} />}
    </div>
  );
}
