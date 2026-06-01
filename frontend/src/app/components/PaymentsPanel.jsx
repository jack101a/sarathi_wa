import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Check, X, Clipboard, Wallet, Calendar, AlertCircle, 
  Hourglass, CheckCircle2, XCircle, Search, Sparkles
} from 'lucide-react';
import { apiGet, apiPostJson } from '../../api/client.js';

export function PaymentsPanel({ isDark, showToast }) {
  const queryClient = useQueryClient();
  const [filterText, setFilterText] = useState('');
  
  // Modal states
  const [activeRequest, setActiveRequest] = useState(null); // { req, type: 'approve' | 'reject' }
  const [amount, setAmount] = useState('100');
  const [adminNote, setAdminNote] = useState('');
  const [processing, setProcessing] = useState(false);

  // Queries
  const { data: pendingData, isLoading: loadingPending, refetch: refetchPending } = useQuery({
    queryKey: ['payments-pending'],
    queryFn: () => apiGet('/admin/api/payments/pending'),
    refetchInterval: 10000, // Autorefresh every 10s
  });

  const { data: historyData, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['payments-history'],
    queryFn: () => apiGet('/admin/api/payments'),
  });

  // Mutate requests
  const approveMutation = useMutation({
    mutationFn: ({ id, amount, note }) => apiPostJson(`/admin/api/payments/${id}/approve`, { amount, note }),
    onSuccess: (data) => {
      showToast('Payment request approved successfully!', 'success');
      queryClient.invalidateQueries(['payments-pending']);
      queryClient.invalidateQueries(['payments-history']);
      queryClient.invalidateQueries(['session-verify']); // Refresh dashboard stats
      closeModal();
    },
    onError: (err) => {
      showToast(err.message || 'Approval failed', 'error');
      setProcessing(false);
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }) => apiPostJson(`/admin/api/payments/${id}/reject`, { note }),
    onSuccess: (data) => {
      showToast('Payment request rejected.', 'info');
      queryClient.invalidateQueries(['payments-pending']);
      queryClient.invalidateQueries(['payments-history']);
      closeModal();
    },
    onError: (err) => {
      showToast(err.message || 'Rejection failed', 'error');
      setProcessing(false);
    }
  });

  const closeModal = () => {
    setActiveRequest(null);
    setAmount('100');
    setAdminNote('');
    setProcessing(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  };

  const handleAction = async (e) => {
    e.preventDefault();
    if (!activeRequest) return;
    setProcessing(true);
    
    if (activeRequest.type === 'approve') {
      const amtVal = Number(amount);
      if (isNaN(amtVal) || amtVal <= 0) {
        showToast('Please enter a valid amount greater than 0', 'error');
        setProcessing(false);
        return;
      }
      approveMutation.mutate({ id: activeRequest.req.id, amount: amtVal, note: adminNote });
    } else {
      rejectMutation.mutate({ id: activeRequest.req.id, note: adminNote });
    }
  };

  // Styles
  const cardStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', backdropFilter: 'blur(20px)' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', backdropFilter: 'blur(20px)' };

  const tableHeaderStyle = {
    padding: '1rem 0.75rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? '#9ca3af' : '#4b5563',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  };

  const tableRowStyle = (idx) => ({
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
    background: idx % 2 === 0 ? 'transparent' : (isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'),
    transition: 'background 0.2s',
  });

  const tableCellStyle = {
    padding: '1rem 0.75rem',
    fontSize: '0.85rem',
    color: isDark ? '#e6edf3' : '#1f2937',
  };

  const pendingRequests = pendingData?.pending || [];
  const processedRequests = (historyData?.payments || []).filter(p => p.status !== 'pending');

  const filteredProcessed = processedRequests.filter(p => {
    const text = filterText.toLowerCase();
    return (
      (p.utr || '').toLowerCase().includes(text) ||
      (p.canonical_phone || '').toLowerCase().includes(text) ||
      (p.user_name || '').toLowerCase().includes(text)
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: isDark ? '#e6edf3' : '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wallet style={{ color: '#6366f1' }} size={24} /> Payment Verification
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: isDark ? '#9ca3af' : '#4b5563', marginTop: '0.25rem' }}>
            Verify UPI payment UTR receipts and approve manual top-ups.
          </p>
        </div>
      </div>

      {/* Pending Section */}
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#f3f4f6' : '#1f2937', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Hourglass style={{ color: '#fbbf24' }} size={18} /> Pending Approvals ({pendingRequests.length})
        </h3>

        {loadingPending ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', border: '2px solid #818cf8', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : pendingRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: isDark ? '#9ca3af' : '#6b7280' }}>
            <CheckCircle2 size={36} style={{ color: '#10b981', marginBottom: '0.5rem' }} />
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>All payments verified!</p>
            <p style={{ margin: 0, fontSize: '0.8rem', marginTop: '0.25rem' }}>No pending top-up requests waiting.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>User</th>
                  <th style={tableHeaderStyle}>UTR (Transaction ID)</th>
                  <th style={tableHeaderStyle}>Suggested Amount</th>
                  <th style={tableHeaderStyle}>Submitted At</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req, idx) => (
                  <tr key={req.id} style={tableRowStyle(idx)}>
                    <td style={tableCellStyle}>
                      <span style={{ fontWeight: 600 }}>{req.user_name || 'Unregistered'}</span>
                      <br />
                      <span style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>+{req.canonical_phone}</span>
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <code style={{ fontSize: '0.9rem', color: '#6366f1', background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>
                          {req.utr}
                        </code>
                        <button 
                          onClick={() => copyToClipboard(req.utr)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#4b5563', padding: '0.25rem' }}
                          title="Copy UTR"
                        >
                          <Clipboard size={14} />
                        </button>
                      </div>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{ fontWeight: 600, color: '#10b981' }}>
                        {req.amount > 0 ? `₹${req.amount}` : '₹100 (Default)'}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: isDark ? '#9ca3af' : '#4b5563' }}>
                        <Calendar size={14} />
                        {new Date(req.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'end' }}>
                        <button
                          onClick={() => setActiveRequest({ req, type: 'approve' })}
                          style={{
                            background: '#10b981', border: 'none', color: 'white',
                            padding: '0.4rem 0.8rem', borderRadius: '0.5rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600
                          }}
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          onClick={() => setActiveRequest({ req, type: 'reject' })}
                          style={{
                            background: '#ef4444', border: 'none', color: 'white',
                            padding: '0.4rem 0.8rem', borderRadius: '0.5rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600
                          }}
                        >
                          <X size={14} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History Section */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#f3f4f6' : '#1f2937', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 style={{ color: '#10b981' }} size={18} /> Audit Log (Processed Payments)
          </h3>

          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: '0.5rem', padding: '0.35rem 0.75rem', width: '250px'
          }}>
            <Search size={14} style={{ color: isDark ? '#9ca3af' : '#6b7280' }} />
            <input 
              type="text" 
              placeholder="Search history..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                color: isDark ? '#e6edf3' : '#1f2937', fontSize: '0.85rem', width: '100%'
              }}
            />
          </div>
        </div>

        {loadingHistory ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', border: '2px solid #818cf8', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : filteredProcessed.length === 0 ? (
          <p style={{ textAlign: 'center', margin: 0, padding: '2rem', color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.85rem' }}>
            No transaction history records found.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>User</th>
                  <th style={tableHeaderStyle}>UTR</th>
                  <th style={tableHeaderStyle}>Verified Amount</th>
                  <th style={tableHeaderStyle}>Status</th>
                  <th style={tableHeaderStyle}>Admin Note</th>
                  <th style={tableHeaderStyle}>Verified At</th>
                </tr>
              </thead>
              <tbody>
                {filteredProcessed.map((req, idx) => (
                  <tr key={req.id} style={tableRowStyle(idx)}>
                    <td style={tableCellStyle}>
                      <span style={{ fontWeight: 600 }}>{req.user_name || 'Unregistered'}</span>
                      <br />
                      <span style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>+{req.canonical_phone}</span>
                    </td>
                    <td style={tableCellStyle}>
                      <code style={{ fontSize: '0.85rem', color: isDark ? '#cbd5e1' : '#475569' }}>
                        {req.utr}
                      </code>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{ fontWeight: 600 }}>
                        ₹{req.amount}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '0.5rem',
                        background: req.status === 'approved' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                        color: req.status === 'approved' ? '#10b981' : '#ef4444'
                      }}>
                        {req.status === 'approved' ? (
                          <>
                            <CheckCircle2 size={12} /> Approved
                          </>
                        ) : (
                          <>
                            <XCircle size={12} /> Rejected
                          </>
                        )}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{ fontStyle: req.admin_note ? 'normal' : 'italic', color: isDark ? '#cbd5e1' : '#475569', fontSize: '0.8rem' }}>
                        {req.admin_note || '(none)'}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{ fontSize: '0.8rem', color: isDark ? '#9ca3af' : '#6b7280' }}>
                        {new Date(req.verified_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dialog */}
      {activeRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
        }}>
          <div style={{
            background: isDark ? '#0d1117' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: '1rem', width: '100%', maxWidth: '450px', overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
          }}>
            {/* Modal Title */}
            <div style={{
              padding: '1.25rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
              display: 'flex', alignItems: 'center', justifyBetween: 'between',
              background: activeRequest.type === 'approve' ? 'linear-gradient(90deg, rgba(16,185,129,0.05) 0%, transparent 100%)' : 'linear-gradient(90deg, rgba(239,68,68,0.05) 0%, transparent 100%)'
            }}>
              <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#f3f4f6' : '#1f2937', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {activeRequest.type === 'approve' ? (
                  <>
                    <CheckCircle2 size={20} style={{ color: '#10b981' }} /> Approve UPI Payment
                  </>
                ) : (
                  <>
                    <XCircle size={20} style={{ color: '#ef4444' }} /> Reject Payment Request
                  </>
                )}
              </h4>
              <button onClick={closeModal} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#4b5563' }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleAction} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{
                background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.85rem'
              }}>
                <p style={{ margin: 0, color: isDark ? '#9ca3af' : '#4b5563' }}>
                  User: <strong style={{ color: isDark ? 'white' : 'black' }}>{activeRequest.req.user_name || 'Unregistered'} ({activeRequest.req.canonical_phone})</strong>
                </p>
                <p style={{ margin: '0.25rem 0 0 0', color: isDark ? '#9ca3af' : '#4b5563' }}>
                  UTR: <code style={{ color: '#6366f1' }}>{activeRequest.req.utr}</code>
                </p>
              </div>

              {activeRequest.type === 'approve' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: isDark ? '#9ca3af' : '#4b5563', marginBottom: '0.35rem' }}>
                    Credits to Add (₹1 = 1 Credit)
                  </label>
                  <input
                    type="number"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 100"
                    style={{
                      width: '100%', padding: '0.625rem', borderRadius: '0.5rem',
                      background: isDark ? 'rgba(255,255,255,0.04)' : '#ffffff',
                      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
                      color: isDark ? 'white' : 'black', outline: 'none'
                    }}
                  />
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>
                    Suggested by user: {activeRequest.req.amount > 0 ? `₹${activeRequest.req.amount}` : 'Not specified'}
                  </p>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: isDark ? '#9ca3af' : '#4b5563', marginBottom: '0.35rem' }}>
                  {activeRequest.type === 'approve' ? 'Optional Note' : 'Reason for Rejection'}
                </label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder={activeRequest.type === 'approve' ? 'e.g. Verified from Bank statement' : 'e.g. UTR matches no transaction, invalid screenshot'}
                  required={activeRequest.type === 'reject'}
                  rows={3}
                  style={{
                    width: '100%', padding: '0.625rem', borderRadius: '0.5rem',
                    background: isDark ? 'rgba(255,255,255,0.04)' : '#ffffff',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
                    color: isDark ? 'white' : 'black', outline: 'none', resize: 'vertical'
                  }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyEnd: 'end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={processing}
                  style={{
                    background: 'transparent', border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
                    color: isDark ? '#e6edf3' : '#1f2937', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  style={{
                    background: activeRequest.type === 'approve' ? '#10b981' : '#ef4444',
                    border: 'none', color: 'white', padding: '0.5rem 1.25rem', borderRadius: '0.5rem', cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem'
                  }}
                >
                  {processing ? (
                    <div style={{ width: '1rem', height: '1rem', borderRadius: '50%', border: '2px solid white', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                  ) : activeRequest.type === 'approve' ? (
                    'Confirm Approval'
                  ) : (
                    'Confirm Rejection'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
