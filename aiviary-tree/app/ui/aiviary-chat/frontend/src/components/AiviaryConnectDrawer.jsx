import { useState, useEffect } from 'react';
import { connectAPI } from '../api/client';

// Platform configuration (same as ConnectPage)
const SERVICES = [
  { id: 'meta', category: 'social', name: 'Meta / Instagram', description: 'Business portfolio and audience insights.', enabled: true },
  { id: 'tiktok', category: 'social', name: 'TikTok', description: 'Short-form video metrics.', enabled: false },
  { id: 'youtube', category: 'social', name: 'YouTube', description: 'Channel performance.', enabled: false },
  { id: 'linkedin', category: 'social', name: 'LinkedIn', description: 'Professional network data.', enabled: false },
  { id: 'google', category: 'workspace', name: 'Google Workspace', description: 'Mail and Drive resources.', enabled: false },
  { id: 'asana', category: 'workspace', name: 'Asana', description: 'Task flow synchronization.', enabled: false },
  { id: 'monday', category: 'workspace', name: 'Monday.com', description: 'Project tracking.', enabled: false },
  { id: 'slack', category: 'workspace', name: 'Slack', description: 'Team communications.', enabled: false }
];

const OAUTH_BROKER_URL = 'https://oauth.theaiviary.com';

function AiviaryConnectDrawer({ isOpen, onClose }) {
  const [connectionStatus, setConnectionStatus] = useState({});
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Get CLIENT_ID from hostname
  const clientId = window.location.hostname.split('.')[0];

  // Poll connection status when drawer is open
  useEffect(() => {
    if (!isOpen) return;

    const checkStatus = async () => {
      try {
        setLoading(true);
        const data = await connectAPI.getStatus();
        setConnectionStatus(data.platforms || {});
      } catch (e) {
        console.error('Status check failed', e);
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Poll sync status when Meta is connected
  useEffect(() => {
    if (!isOpen || !connectionStatus.meta) return;

    const checkSyncStatus = async () => {
      try {
        const data = await connectAPI.getSyncStatus();
        setSyncStatus(data);
      } catch (e) {
        console.error('Sync status check failed', e);
      }
    };

    checkSyncStatus();
    const interval = setInterval(checkSyncStatus, 5000);
    return () => clearInterval(interval);
  }, [isOpen, connectionStatus.meta]);

  const handleConnect = (platformId) => {
    const service = SERVICES.find(s => s.id === platformId);
    if (service && service.enabled) {
      window.location.href = `${OAUTH_BROKER_URL}/auth/${platformId}?client_id=${clientId}`;
    }
  };

  const connectedCount = Object.values(connectionStatus).filter(Boolean).length;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 flex flex-col w-full max-w-md glass-panel border-l border-white/40 z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-white/20 bg-white/10 backdrop-blur-md">
          <div className="flex items-center space-x-3">
            <svg className="h-5 w-5 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <h2 className="text-lg font-serif font-bold text-brand-teal">
              Aiviary Connect
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-slate hover:text-brand-teal hover:bg-brand-teal/10 rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-white/50 p-6">
          {/* Status Summary */}
          <div className="mb-6 p-4 bg-brand-teal/5 rounded-xl border border-brand-teal/10">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-slate">Connected Platforms</span>
              <span className="text-lg font-semibold text-brand-teal">
                {connectedCount} / {SERVICES.filter(s => s.enabled).length}
              </span>
            </div>
          </div>

          {/* Sync Status Banner */}
          {syncStatus && (syncStatus.syncing || syncStatus.status === 'queued') && (
            <div className="mb-6 p-4 bg-brand-clay/5 border border-brand-clay/20 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="animate-spin w-4 h-4 border-2 border-brand-clay border-t-transparent rounded-full" />
                <div>
                  <p className="text-brand-clay font-medium text-sm">
                    {syncStatus.status === 'queued' ? 'Sync queued...' : 'Syncing data...'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {syncStatus?.completed && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-green-800 font-medium text-sm">Sync complete</p>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-brand-teal border-t-transparent rounded-full" />
            </div>
          )}

          {/* Platform List */}
          {!loading && (
            <div className="space-y-3">
              {SERVICES.map((service) => {
                const isConnected = connectionStatus[service.id] === true;
                return (
                  <div
                    key={service.id}
                    className={`p-4 rounded-xl border transition-all ${
                      service.enabled
                        ? isConnected
                          ? 'bg-brand-teal/5 border-brand-teal/20'
                          : 'bg-white border-gray-200 hover:border-brand-clay/30'
                        : 'bg-gray-50 border-gray-100 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-medium ${service.enabled ? 'text-brand-teal' : 'text-gray-400'}`}>
                          {service.name}
                        </h3>
                        <p className="text-xs text-neutral-slate mt-0.5 truncate">
                          {service.description}
                        </p>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        {service.enabled ? (
                          isConnected ? (
                            <span className="flex items-center gap-2 text-sm font-medium text-brand-teal">
                              <span className="w-2 h-2 bg-brand-teal rounded-full" />
                              Active
                            </span>
                          ) : (
                            <button
                              onClick={() => handleConnect(service.id)}
                              className="px-4 py-1.5 bg-brand-clay text-white text-sm font-medium rounded-lg hover:bg-[#A64D21] transition-colors shadow-sm"
                            >
                              Connect
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-gray-400 italic">Coming Soon</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/20 bg-white/30">
          <p className="text-xs text-center text-neutral-slate">
            Manage your platform connections to enable AI-powered analytics.
          </p>
        </div>
      </div>
    </>
  );
}

export default AiviaryConnectDrawer;
