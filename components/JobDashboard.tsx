'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApplicationRecord, APPLICATION_QUEUE_KEY, getApplicationQueue, getAutoSubmitPreference, setAutoSubmitPreference, updateApplicationRecord, removeApplication } from '@/lib/applicationQueue';

interface JobDashboardProps {
  onViewJob?: (record: ApplicationRecord) => void;
}

type TabKey = 'queued' | 'applying' | 'applied' | 'failed';

export default function JobDashboard({ onViewJob }: JobDashboardProps) {
  const [records, setRecords] = useState<ApplicationRecord[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('queued');
  const [autoSubmit, setAutoSubmit] = useState<boolean>(() => getAutoSubmitPreference());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const load = () => setRecords(getApplicationQueue());
    load();
    const handler = (event: StorageEvent) => {
      if (event.key === APPLICATION_QUEUE_KEY) {
        load();
      }
    };
    window.addEventListener('storage', handler);
    const interval = window.setInterval(load, 1000);
    return () => {
      window.removeEventListener('storage', handler);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setAutoSubmitPreference(autoSubmit);
  }, [autoSubmit]);

  const stats = useMemo(() => {
    const totals = {
      queued: 0,
      applying: 0,
      applied: 0,
      failed: 0
    };
    records.forEach(record => {
      totals[record.status] = (totals[record.status] ?? 0) + 1;
    });
    return totals;
  }, [records]);

  const filtered = useMemo(
    () =>
      records
        .filter(record => record.status === activeTab)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [records, activeTab]
  );

  const toggleAutoSubmit = () => {
    setAutoSubmit(prev => !prev);
  };

  const handleRetry = (record: ApplicationRecord) => {
    updateApplicationRecord(record.jobId, {
      status: 'queued',
      updatedAt: new Date().toISOString(),
      error: undefined
    });
    setRecords(getApplicationQueue());
  };

  const handleRemove = (jobId: string) => {
    removeApplication(jobId);
    setRecords(getApplicationQueue());
  };

  const renderStatusBadge = (status: ApplicationRecord['status']) => {
    const classes = {
      queued: 'bg-gray-100 text-gray-700',
      applying: 'bg-yellow-100 text-yellow-800',
      applied: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    }[status];

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${classes}`}>
        {status === 'queued' && 'Queued'}
        {status === 'applying' && 'Applying'}
        {status === 'applied' && 'Applied'}
        {status === 'failed' && 'Failed'}
      </span>
    );
  };

const formatTimestamp = (value?: string) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Job Applications</h2>
          <p className="text-gray-600">Queued and submitted applications tracked locally.</p>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-sm text-gray-600">Auto-submit mode</span>
          <button
            onClick={toggleAutoSubmit}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoSubmit ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                autoSubmit ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Queued" value={stats.queued} icon="📝" color="bg-gray-100" />
        <StatCard label="Applying" value={stats.applying} icon="⚙️" color="bg-yellow-100" />
        <StatCard label="Applied" value={stats.applied} icon="✅" color="bg-green-100" />
        <StatCard label="Failed" value={stats.failed} icon="⚠️" color="bg-red-100" />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="border-b border-gray-200 flex flex-wrap">
          {(['queued', 'applying', 'applied', 'failed'] as TabKey[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({stats[tab]})
            </button>
          ))}
        </div>

        <div className="p-6">
          {filtered.length === 0 ? (
            <EmptyState status={activeTab} />
          ) : (
            <div className="space-y-4">
              {filtered.map(record => (
                <div key={record.jobId} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-1">
                        <h3 className="text-lg font-semibold text-gray-900">{record.job.title}</h3>
                        {renderStatusBadge(record.status)}
                      </div>
                      <div className="text-sm text-blue-600 font-medium mb-1">{record.job.company}</div>
                      <div className="text-sm text-gray-600 mb-1">{record.job.location}</div>
                      <div className="text-xs text-gray-500">Queued {formatTimestamp(record.updatedAt)}</div>
                      {record.appliedAt && (
                        <div className="text-xs text-green-600">Applied {formatTimestamp(record.appliedAt)}</div>
                      )}
                      {record.error && (
                        <div className="mt-1 text-xs text-red-600">Error: {record.error}</div>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <a
                        href={record.job.atsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="px-3 py-2 text-sm text-blue-600 hover:underline"
                      >
                        View Posting
                      </a>
                      {onViewJob && (
                        <button
                          className="px-3 py-2 text-sm text-gray-700 hover:text-blue-600"
                          onClick={() => onViewJob(record)}
                        >
                          Details
                        </button>
                      )}
                      {record.status === 'failed' && (
                        <button
                          className="px-3 py-2 text-sm text-red-600 hover:text-red-700"
                          onClick={() => handleRetry(record)}
                        >
                          Retry
                        </button>
                      )}
                      {(record.status === 'applied' || record.status === 'failed') && (
                        <button
                          className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                          onClick={() => handleRemove(record.jobId)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={() => setRecords(getApplicationQueue())}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Refresh Queue
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className={`border border-gray-200 rounded-lg p-4 flex items-center bg-white`}
    >
      <div className={`${color} w-10 h-10 rounded-full flex items-center justify-center text-lg mr-3`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-600">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({ status }: { status: TabKey }) {
  const messages: Record<TabKey, string> = {
    queued: 'No jobs queued. Swipe right to add jobs to the queue.',
    applying: 'No jobs are currently applying.',
    applied: 'No completed applications yet.',
    failed: 'No failed applications. Great job!'
  };

  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-gray-600">{messages[status]}</p>
    </div>
  );
}
