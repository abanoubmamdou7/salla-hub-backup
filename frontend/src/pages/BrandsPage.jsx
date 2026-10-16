import { useState, useEffect, useCallback, useRef } from 'react';
import { brandsList, brandCreate, brandUpdate, brandDelete, clientsList } from '../api/client';

function IconTag() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function IconX() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  );
}

function groupByBrandCode(brands) {
  const map = {};
  for (const b of brands) {
    const key = `${b.brand_code}__${b.client_id ?? 'global'}`;
    if (!map[key]) map[key] = { brandCode: b.brand_code, description: b.description ?? '', clientId: b.client_id ?? null, keywords: [] };
    map[key].keywords.push({ id: b.id, keyword: b.keyword, created_at: b.created_at });
  }
  return Object.values(map).sort((a, b) => {
    if (a.clientId === b.clientId) return a.brandCode.localeCompare(b.brandCode);
    if (a.clientId === null) return 1;
    if (b.clientId === null) return -1;
    return a.clientId - b.clientId;
  });
}

function TagInput({ tags, onChange, placeholder = 'Type keyword + Enter' }) {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  function addTag(raw) {
    const val = raw.trim();
    if (!val) return;
    const parts = val.split(',').map(s => s.trim()).filter(Boolean);
    const next = [...tags];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setInput('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addTag(input); }
    else if (e.key === ',') { e.preventDefault(); addTag(input); }
    else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function removeTag(i) {
    onChange(tags.filter((_, idx) => idx !== i));
  }

  return (
    <div className="bm-tag-input" onClick={() => inputRef.current?.focus()}>
      {tags.map((t, i) => (
        <span key={i} className="bm-tag">
          <span dir="auto">{t}</span>
          <button type="button" onClick={() => removeTag(i)} className="bm-tag-remove" tabIndex={-1}><IconX /></button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(input)}
        placeholder={tags.length === 0 ? placeholder : ''}
        dir="auto"
        autoComplete="off"
        className="bm-tag-input-field"
      />
    </div>
  );
}

function BrandCard({ group, clients, onAddKeyword, onDeleteKeyword, onDeleteBrand, onEditDesc }) {
  const clientName = group.clientId
    ? (clients.find(c => c.id === group.clientId)?.name ?? `Client #${group.clientId}`)
    : null;
  const [addingKw, setAddingKw] = useState(false);
  const [newKw, setNewKw] = useState('');
  const [savingKw, setSavingKw] = useState(false);
  const kwInputRef = useRef(null);

  function startAddKw() {
    setAddingKw(true);
    setTimeout(() => kwInputRef.current?.focus(), 50);
  }

  async function commitKw() {
    const val = newKw.trim();
    if (!val) { setAddingKw(false); setNewKw(''); return; }
    setSavingKw(true);
    const parts = val.split(',').map(s => s.trim()).filter(Boolean);
    for (const kw of parts) {
      await onAddKeyword(group.brandCode, group.description, kw);
    }
    setSavingKw(false);
    setNewKw('');
    setAddingKw(false);
  }

  function onKwKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitKw(); }
    else if (e.key === 'Escape') { setAddingKw(false); setNewKw(''); }
  }

  return (
    <div className="bm-card">
      <div className="bm-card-header">
        <div className="bm-card-title">
          <span className="bm-code-badge">{group.brandCode}</span>
          {group.description && <span className="bm-card-desc">{group.description}</span>}
          {clientName
            ? <span className="bm-client-badge">{clientName}</span>
            : <span className="bm-global-badge">Global</span>
          }
        </div>
        <div className="bm-card-actions">
          <button type="button" className="bm-action-btn" onClick={() => onEditDesc(group)} title="Edit brand">
            <IconEdit />
          </button>
          <button type="button" className="bm-action-btn bm-action-btn-danger" onClick={() => onDeleteBrand(group)} title="Delete brand">
            <IconTrash />
          </button>
        </div>
      </div>

      <div className="bm-keywords">
        {group.keywords.map(kw => (
          <span key={kw.id} className="bm-keyword-chip">
            <span dir="auto">{kw.keyword}</span>
            <button
              type="button"
              className="bm-chip-remove"
              onClick={() => onDeleteKeyword(kw.id, group.keywords.length)}
              title="Remove keyword"
            >
              <IconX />
            </button>
          </span>
        ))}

        {addingKw ? (
          <span className="bm-keyword-chip bm-keyword-chip-input">
            <input
              ref={kwInputRef}
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              onKeyDown={onKwKeyDown}
              onBlur={commitKw}
              placeholder="keyword…"
              dir="auto"
              disabled={savingKw}
              autoComplete="off"
            />
          </span>
        ) : (
          <button type="button" className="bm-add-kw-btn" onClick={startAddKw}>
            <IconPlus /> Add keyword
          </button>
        )}
      </div>

      <div className="bm-card-footer">
        {group.keywords.length} keyword{group.keywords.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ── Keywords Field (Tags mode or Paste-bulk mode) ─────────────────────────────
function KeywordsField({ keywords, onChange }) {
  const [mode, setMode] = useState('tags'); // 'tags' | 'bulk'
  const [bulkText, setBulkText] = useState('');

  function applyBulk() {
    const lines = bulkText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    const merged = [...keywords];
    for (const l of lines) if (!merged.includes(l)) merged.push(l);
    onChange(merged);
    setBulkText('');
    setMode('tags');
  }

  return (
    <div className="brands-field" style={{ marginTop: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Keywords</span>
        <div style={{ display: 'flex', gap: '2px', background: 'var(--border)', borderRadius: 6, padding: '2px' }}>
          {['tags', 'bulk'].map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                fontSize: '0.72rem', fontWeight: 500, padding: '2px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--surface)' : 'transparent',
                color: mode === m ? 'var(--text)' : 'var(--text-secondary)',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {m === 'tags' ? 'One by one' : 'Paste bulk'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'tags' ? (
        <>
          <TagInput
            tags={keywords}
            onChange={onChange}
            placeholder="Type a keyword and press Enter (or use commas)"
          />
          <span className="brands-field-hint">Each keyword will be matched against incoming product names</span>
        </>
      ) : (
        <>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={"كوينز - ماسا 50,000\nكوينز - ماسا 75,000\nكوينز - ماسا 100,000"}
            rows={6}
            dir="auto"
            spellCheck={false}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.85rem', padding: '0.6em 0.8em', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}>
            <button
              type="button"
              onClick={applyBulk}
              disabled={!bulkText.trim()}
              style={{ fontSize: '0.8rem', padding: '0.35em 1em', borderRadius: 6, border: 'none', cursor: bulkText.trim() ? 'pointer' : 'not-allowed', background: 'var(--accent, #6366f1)', color: '#fff', opacity: bulkText.trim() ? 1 : 0.5 }}
            >
              Add {bulkText.split('\n').filter(l => l.trim()).length || ''} keywords
            </button>
            <span className="brands-field-hint" style={{ margin: 0 }}>One keyword per line — duplicates are skipped</span>
          </div>
          {keywords.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {keywords.map((k, i) => (
                <span key={i} className="bm-tag">
                  <span dir="auto">{k}</span>
                  <button type="button" onClick={() => onChange(keywords.filter((_, j) => j !== i))} className="bm-tag-remove" tabIndex={-1}><IconX /></button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EMPTY_FORM = { brandCode: '', description: '', keywords: [], clientId: '' };

// ── Bulk Import Panel ─────────────────────────────────────────────────────────
function BulkImportPanel({ clients, onClose, onImported }) {
  const [text, setText]             = useState('');
  const [clientId, setClientId]     = useState('');
  const [defaultCode, setDefaultCode] = useState('');
  const [saving, setSaving]         = useState(false);
  const [result, setResult]         = useState(null);

  function parseLines(raw) {
    const fallback = defaultCode.trim().toUpperCase();
    return raw.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\t|\||\s{2,}/).map(p => p.trim()).filter(Boolean);
        const isBrandCode = s => /^[A-Za-z0-9_\-]{1,20}$/.test(s);
        // Single column → use default brand code
        if (parts.length === 1) {
          return fallback ? { brandCode: fallback, keyword: parts[0] } : null;
        }
        if (isBrandCode(parts[0])) return { brandCode: parts[0].toUpperCase(), keyword: parts.slice(1).join(' ') };
        if (isBrandCode(parts[parts.length - 1])) return { brandCode: parts[parts.length - 1].toUpperCase(), keyword: parts.slice(0, -1).join(' ') };
        // No detectable brand code → use default
        return fallback ? { brandCode: fallback, keyword: line } : null;
      })
      .filter(Boolean);
  }

  const preview = parseLines(text);

  async function handleImport() {
    if (!preview.length) return;
    setSaving(true);
    setResult(null);
    let ok = 0, failed = 0;
    for (const { brandCode, keyword } of preview) {
      try {
        await brandCreate({ keyword, brandCode, clientId: clientId ? parseInt(clientId, 10) : null });
        ok++;
      } catch { failed++; }
    }
    setSaving(false);
    setResult({ ok, failed });
    onImported();
  }

  return (
    <div className="bm-bulk-backdrop" onClick={onClose}>
      <div className="bm-bulk-panel" onClick={e => e.stopPropagation()}>
        <div className="bm-bulk-header">
          <div>
            <h2 className="bm-bulk-title">Bulk Import</h2>
            <p className="bm-bulk-subtitle">Paste your data — one mapping per line</p>
          </div>
          <button type="button" className="bm-close-btn" onClick={onClose}><IconX /></button>
        </div>

        <div className="bm-bulk-body">
          {/* Format hint */}
          <div className="bm-bulk-hint">
            <p>Supported formats (tab, comma, pipe, or 2+ spaces as separator):</p>
            <code>MA001    كوينز - ماسا 50,000</code>
            <code>كوينز - ماسا 50,000 | MA001</code>
          </div>

          {/* Client selector */}
          <label className="brands-field">
            <span>Client <span style={{ fontWeight: 400, color: 'var(--text-secondary)', textTransform: 'none', letterSpacing: 0 }}>(optional — leave empty for global)</span></span>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="bm-bulk-select">
              <option value="">Global (all clients)</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}
            </select>
          </label>

          {/* Textarea */}
          <label className="brands-field" style={{ marginTop: '0.85rem' }}>
            <span>Data</span>
            <textarea
              className="bm-bulk-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"MA001\tكوينز - ماسا 50,000\nMA002\tكوينز - ماسا 75,000\nMA003\tكوينز - ماسا 100,000"}
              rows={10}
              dir="auto"
              spellCheck={false}
            />
          </label>

          {/* Preview */}
          {preview.length > 0 && (
            <div className="bm-bulk-preview">
              <div className="bm-bulk-preview-head">
                Preview — {preview.length} mapping{preview.length !== 1 ? 's' : ''}
              </div>
              <div className="bm-bulk-preview-list">
                {preview.slice(0, 8).map((row, i) => (
                  <div key={i} className="bm-bulk-preview-row">
                    <span className="bm-code-badge" style={{ fontSize: '0.72rem' }}>{row.brandCode}</span>
                    <span className="bm-bulk-preview-kw" dir="auto">{row.keyword}</span>
                  </div>
                ))}
                {preview.length > 8 && (
                  <div className="bm-bulk-preview-more">+{preview.length - 8} more</div>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className={`bm-bulk-result ${result.failed > 0 ? 'warn' : 'ok'}`}>
              ✓ {result.ok} imported{result.failed > 0 ? ` · ${result.failed} failed (duplicates?)` : ''}
            </div>
          )}
        </div>

        <div className="bm-bulk-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={saving || preview.length === 0}
          >
            {saving ? `Importing…` : `Import ${preview.length || ''} Mappings`}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function BrandsPage() {
  const [brands, setBrands]       = useState([]);
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [showBulk, setShowBulk]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    brandsList()
      .then(d => setBrands(d.data ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { clientsList().then(d => setClients(d.data ?? [])).catch(() => {}); }, []);

  const groups = groupByBrandCode(brands);

  function openNewForm() {
    setEditingGroup(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
    setTimeout(() => document.getElementById('bm-code-input')?.focus(), 50);
  }

  function openEditForm(group) {
    setEditingGroup(group);
    setForm({ brandCode: group.brandCode, description: group.description, keywords: [] });
    setFormError(null);
    setShowForm(true);
    setTimeout(() => document.getElementById('bm-desc-input')?.focus(), 50);
  }

  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingGroup(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    if (!form.brandCode.trim()) { setFormError('Brand Code is required'); return; }

    if (editingGroup) {
      // Update description on all entries for this brand code
      if (!form.description.trim() && editingGroup.description === '') {
        closeForm(); return;
      }
      setSaving(true);
      try {
        for (const kw of editingGroup.keywords) {
          await brandUpdate(kw.id, {
            keyword:     kw.keyword,
            brandCode:   editingGroup.brandCode,
            description: form.description.trim(),
          });
        }
        load();
        closeForm();
      } catch (err) {
        setFormError(err.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (form.keywords.length === 0) { setFormError('Add at least one keyword'); return; }

    setSaving(true);
    try {
      for (const kw of form.keywords) {
        await brandCreate({
          keyword:     kw,
          brandCode:   form.brandCode.trim(),
          description: form.description.trim(),
          clientId:    form.clientId ? parseInt(form.clientId, 10) : null,
        });
      }
      load();
      closeForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddKeyword(brandCode, description, keyword) {
    await brandCreate({ keyword, brandCode, description });
    load();
  }

  async function handleDeleteKeyword(id, total) {
    if (total === 1) {
      if (!window.confirm('This is the last keyword — deleting it will remove the entire brand mapping. Continue?')) return;
    }
    await brandDelete(id).catch(e => alert(e.message));
    load();
  }

  async function handleDeleteBrand(group) {
    if (!window.confirm(`Delete brand "${group.brandCode}" and all ${group.keywords.length} keyword${group.keywords.length !== 1 ? 's' : ''}?`)) return;
    try {
      await Promise.all(group.keywords.map(kw => brandDelete(kw.id)));
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <header className="bm-page-header">
        <div className="bm-page-header-left">
          <h1>Brand Mappings</h1>
          <p>Route orders automatically by mapping product keywords to supplier brand codes</p>
        </div>
        <div className="bm-page-header-right">
          {!loading && !error && brands.length > 0 && (
            <span className="bm-count-pill">{groups.length} brand{groups.length !== 1 ? 's' : ''} · {brands.length} keyword{brands.length !== 1 ? 's' : ''}</span>
          )}
          <button type="button" className="btn-ghost bm-new-btn" onClick={() => setShowBulk(true)}>
            Bulk Import
          </button>
          <button type="button" className="btn-primary bm-new-btn" onClick={openNewForm}>
            <IconPlus /> New Brand
          </button>
        </div>
      </header>

      {/* ── Form Panel ── */}
      {showForm && (
        <div className="bm-form-panel">
          <div className="bm-form-panel-header">
            <h2>{editingGroup ? `Edit "${editingGroup.brandCode}"` : 'New Brand Mapping'}</h2>
            <button type="button" className="bm-close-btn" onClick={closeForm}><IconX /></button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bm-form-row">
              <label className="brands-field" style={{ flex: '0 0 140px' }}>
                <span>Brand Code</span>
                <input
                  id="bm-code-input"
                  value={form.brandCode}
                  onChange={e => setForm(f => ({ ...f, brandCode: e.target.value.toUpperCase() }))}
                  placeholder="e.g. MSA"
                  maxLength={20}
                  className="brands-field-mono"
                  disabled={!!editingGroup}
                  autoComplete="off"
                />
              </label>
              <label className="brands-field" style={{ flex: 1 }}>
                <span>Description</span>
                <input
                  id="bm-desc-input"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Masa Chat"
                  autoComplete="off"
                />
              </label>
            </div>

            {!editingGroup && (
              <label className="brands-field" style={{ marginTop: '0.85rem' }}>
                <span>Client <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(optional — leave empty for global)</span></span>
                <select
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  style={{ fontFamily: 'inherit', fontSize: '0.875rem', padding: '0.55em 0.85em', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', color: 'var(--text)', background: 'var(--surface)' }}
                >
                  <option value="">Global (all clients)</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}
                </select>
              </label>
            )}

            {!editingGroup && (
              <KeywordsField
                keywords={form.keywords}
                onChange={kws => setForm(f => ({ ...f, keywords: kws }))}
              />
            )}

            {formError && (
              <div className="brands-form-error" style={{ marginTop: '0.75rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {formError}
              </div>
            )}

            <div className="brands-form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editingGroup ? 'Update Description' : 'Add Brand'}
              </button>
              <button type="button" className="btn-ghost" onClick={closeForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="table-wrap table-loading-wrap">
          <div className="table-loading">
            <div className="spinner" aria-hidden />
            <p>Loading mappings…</p>
          </div>
        </div>
      ) : error ? (
        <div className="table-wrap"><div className="table-error-inline">Error: {error}</div></div>
      ) : groups.length === 0 ? (
        <div className="table-wrap">
          <div className="brands-empty-state">
            <div className="brands-empty-icon"><IconTag /></div>
            <p className="table-empty-title">No brand mappings yet</p>
            <p className="table-empty-desc">Create your first brand mapping to start routing orders automatically.</p>
            <button type="button" className="btn-primary" style={{ marginTop: '1rem' }} onClick={openNewForm}>
              <IconPlus /> New Brand
            </button>
          </div>
        </div>
      ) : (
        <div className="bm-cards-grid">
          {groups.map(g => (
            <BrandCard
              key={`${g.brandCode}-${g.clientId ?? 'global'}`}
              group={g}
              clients={clients}
              onAddKeyword={handleAddKeyword}
              onDeleteKeyword={handleDeleteKeyword}
              onDeleteBrand={handleDeleteBrand}
              onEditDesc={openEditForm}
            />
          ))}
        </div>
      )}

      {showBulk && (
        <BulkImportPanel
          clients={clients}
          onClose={() => setShowBulk(false)}
          onImported={() => { load(); setShowBulk(false); }}
        />
      )}
    </div>
  );
}
