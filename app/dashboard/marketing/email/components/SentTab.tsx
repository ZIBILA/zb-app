'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';

export default function SentTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const fetchLogs = async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/email/logs?page=${p}&limit=20`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.pages || 1);
      setPage(p);
    } catch (error) {
      toast.error('Failed to load email logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleCancelScheduled = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled email?')) return;
    try {
      const res = await fetch(`/api/email/logs?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Scheduled email cancelled');
        fetchLogs(page);
      } else {
        toast.error('Failed to cancel');
      }
    } catch (e) {
      toast.error('Failed to cancel');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-black dark:text-white">Sent Emails</h2>
        <button onClick={() => fetchLogs(page)} className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition text-sm">
          ↻ Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-black/20 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-black/10 dark:border-white/10">
              <th className="px-6 py-4">Subject</th>
              <th className="px-6 py-4">Template</th>
              <th className="px-6 py-4">Recipients</th>
              <th className="px-6 py-4">Sent / Scheduled At</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={6} className="px-6 py-4"><div className="h-4 bg-black/5 dark:bg-white/5 rounded w-full"></div></td>
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-foreground/50 text-sm bg-transparent">
                  No emails have been sent yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-black/[0.01] dark:hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-black dark:text-white max-w-[200px] truncate">{log.subject}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{log.templateName || 'Custom'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{log.recipientName}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {log.triggerEvent ? new Date(log.triggerEvent).toLocaleString() : new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-[10px] font-bold uppercase rounded-full ${
                      log.status === 'sent' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                      log.status === 'scheduled' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                      'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-black dark:text-white px-3 py-1.5 rounded transition font-medium border border-black/[0.05] dark:border-none"
                      >
                        Details
                      </button>
                      {log.status === 'scheduled' && (
                        <button
                          onClick={() => handleCancelScheduled(log.id)}
                          className="text-xs bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/40 text-red-700 dark:text-red-400 px-3 py-1.5 rounded transition font-bold"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        
        {totalPages > 1 && (
          <div className="p-4 border-t border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-black/20">
            <button 
              disabled={page === 1} 
              onClick={() => fetchLogs(page - 1)}
              className="px-4 py-2 text-xs bg-black/5 dark:bg-white/10 rounded hover:bg-black/10 dark:hover:bg-white/20 disabled:opacity-50 text-black dark:text-white font-medium border border-black/[0.05] dark:border-none"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</span>
            <button 
              disabled={page === totalPages} 
              onClick={() => fetchLogs(page + 1)}
              className="px-4 py-2 text-xs bg-black/5 dark:bg-white/10 rounded hover:bg-black/10 dark:hover:bg-white/20 disabled:opacity-50 text-black dark:text-white font-medium border border-black/[0.05] dark:border-none"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {selectedLog && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-[#161616]">
              <h2 className="text-base font-medium text-black dark:text-white">Email Log Details</h2>
              <button onClick={() => setSelectedLog(null)} className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white p-2">✕</button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block mb-1">Subject</span>
                  <span className="text-black dark:text-white font-medium">{selectedLog.subject}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block mb-1">Template</span>
                  <span className="text-black dark:text-white font-medium">{selectedLog.templateName || 'Custom'}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block mb-1">Recipients Count</span>
                  <span className="text-black dark:text-white font-medium">{selectedLog.recipientName}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block mb-1">Status</span>
                  <span className={`capitalize font-semibold ${selectedLog.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {selectedLog.status}
                  </span>
                </div>
              </div>
              
              {selectedLog.errorMessage && (
                <div className="mt-4 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-400 text-xs font-mono break-all">
                  {selectedLog.errorMessage}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-black/10 dark:border-white/10 bg-gray-50 dark:bg-[#161616] flex justify-end">
              <button onClick={() => setSelectedLog(null)} className="px-4 py-2 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-black dark:text-white rounded-lg transition text-sm font-semibold border border-black/[0.05] dark:border-none">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
