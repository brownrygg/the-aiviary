import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { connectAPI } from '../api/client';

// Platform configuration
const SERVICES = [
  // Social Channels
  { id: 'meta', category: 'social', name: 'Meta / Instagram', description: 'Business portfolio and audience insights.', enabled: true },
  { id: 'tiktok', category: 'social', name: 'TikTok', description: 'Short-form video metrics.', enabled: false },
  { id: 'youtube', category: 'social', name: 'YouTube', description: 'Channel performance.', enabled: false },
  { id: 'linkedin', category: 'social', name: 'LinkedIn', description: 'Professional network data.', enabled: false },

  // Workspace Tools
  { id: 'google', category: 'workspace', name: 'Google Workspace', description: 'Mail and Drive resources.', enabled: false },
  { id: 'asana', category: 'workspace', name: 'Asana', description: 'Task flow synchronization.', enabled: false },
  { id: 'monday', category: 'workspace', name: 'Monday.com', description: 'Project tracking.', enabled: false },
  { id: 'slack', category: 'workspace', name: 'Slack', description: 'Team communications.', enabled: false }
];

const CATEGORIES = {
  social: {
    title: 'Social Channels',
    description: "Connecting these streams activates the Nest's observational core. All content is automatically archived, indexed, and analyzed. This enables your agents to surface deep engagement insights, generate data-backed content strategies, and recall specific media or concepts instantly."
  },
  workspace: {
    title: 'Workspace Tools',
    description: 'Linking these tools empowers your agents with direct agency. It activates secure MCP (Model Context Protocol) bridges, allowing your digital workforce to read documentation, manage tasks, and coordinate workflows within your existing ecosystem.'
  }
};

const OAUTH_BROKER_URL = 'https://oauth.theaiviary.com';

function ConnectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [connectionStatus, setConnectionStatus] = useState({});
  const [syncStatus, setSyncStatus] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [showAbout, setShowAbout] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  // Get CLIENT_ID from hostname
  const clientId = window.location.hostname.split('.')[0];

  // Check if user just connected (redirected back from OAuth)
  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setJustConnected(true);
      // Clear the URL parameter
      window.history.replaceState({}, '', '/');
    }
  }, [searchParams]);

  // Poll connection status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await connectAPI.getStatus();
        setConnectionStatus(data.platforms || {});
      } catch (e) {
        console.error('Status check failed', e);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Poll sync status when connected
  useEffect(() => {
    if (!connectionStatus.meta) return;

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
  }, [connectionStatus.meta]);

  const hasConnection = Object.values(connectionStatus).some(status => status === true);

  const handleConnect = (platformId) => {
    const service = SERVICES.find(s => s.id === platformId);
    if (service && service.enabled) {
      window.location.href = `${OAUTH_BROKER_URL}/auth/${platformId}?client_id=${clientId}`;
    }
  };

  const handleGoToChat = () => {
    navigate('/chat');
  };

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Group services by category
  const groupedServices = SERVICES.reduce((acc, service) => {
    if (!acc[service.category]) acc[service.category] = [];
    acc[service.category].push(service);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#C2E0FF] to-[#F7F5F0] flex flex-col items-center px-5 py-20">
      <div className="w-full max-w-[720px]">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="font-serif font-medium text-[3.5rem] text-brand-teal tracking-tight mb-2">
            The Aiviary
          </h1>
          <p className="font-serif italic text-lg text-neutral-slate mb-6">
            Integration Manifest
          </p>

          {/* About Toggle */}
          <div className="max-w-[480px] mx-auto">
            <button
              onClick={() => setShowAbout(!showAbout)}
              className="text-xs font-semibold text-brand-teal uppercase tracking-wider opacity-80 hover:opacity-100 hover:text-brand-clay transition-colors flex items-center gap-2 mx-auto"
            >
              About the Nest
              <span className={`transform transition-transform ${showAbout ? 'rotate-180' : ''}`}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {showAbout && (
              <p className="font-serif text-base text-neutral-slate mt-3 italic animate-slideDown">
                The Aiviary is a decentralized ecosystem for content automation. This nest serves as the central hub where social streams and workspace tools converge, allowing your digital agents to observe, analyze, and act on your behalf.
              </p>
            )}
          </div>
        </header>

        {/* Success Banner */}
        {justConnected && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl text-center animate-slideDown">
            <p className="text-green-800 font-medium">Platform connected successfully!</p>
            <p className="text-green-600 text-sm mt-1">Your data is now being synced.</p>
          </div>
        )}

        {/* Sync Status Banner */}
        {syncStatus && (syncStatus.syncing || syncStatus.status === 'queued') && (
          <div className="mb-6 p-4 bg-brand-teal/5 border border-brand-teal/20 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-5 h-5 border-2 border-brand-teal border-t-transparent rounded-full" />
              <div>
                <p className="text-brand-teal font-medium">
                  {syncStatus.status === 'queued' ? 'Sync queued...' : 'Syncing your data...'}
                </p>
                <p className="text-neutral-slate text-sm">
                  This may take a few minutes. You can proceed to the chat while we sync.
                </p>
              </div>
            </div>
          </div>
        )}

        {syncStatus?.completed && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-green-800 font-medium">Sync complete!</p>
                <p className="text-green-600 text-sm">Your data is ready for analysis.</p>
              </div>
            </div>
          </div>
        )}

        {/* Services Panel */}
        <div className="bg-white/65 backdrop-blur-xl rounded-xl border border-white/90 p-10 shadow-[0_4px_20px_rgba(44,74,82,0.05)]">
          {Object.entries(groupedServices).map(([categoryKey, services]) => (
            <div
              key={categoryKey}
              className={`${categoryKey !== 'social' ? 'mt-8 pt-8 border-t border-brand-teal/10' : ''}`}
            >
              {/* Category Header */}
              <h2 className="font-serif text-xl text-brand-teal mb-3">
                {CATEGORIES[categoryKey].title}
              </h2>

              {/* Category Toggle */}
              <div className="mb-6">
                <button
                  onClick={() => toggleCategory(categoryKey)}
                  className="text-xs font-semibold text-brand-teal uppercase tracking-wider opacity-80 hover:opacity-100 hover:text-brand-clay transition-colors flex items-center gap-2"
                >
                  Intelligence Capabilities
                  <span className={`transform transition-transform ${expandedCategories[categoryKey] ? 'rotate-180' : ''}`}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>
                {expandedCategories[categoryKey] && (
                  <p className="text-sm text-neutral-slate mt-3 bg-brand-teal/[0.03] p-4 rounded-lg border-l-[3px] border-brand-teal animate-slideDown">
                    {CATEGORIES[categoryKey].description}
                  </p>
                )}
              </div>

              {/* Service Items */}
              {services.map((service) => {
                const isConnected = connectionStatus[service.id] === true;
                return (
                  <div
                    key={service.id}
                    className={`flex items-center justify-between py-5 border-t border-brand-teal/10 ${
                      !service.enabled ? 'opacity-50 grayscale pointer-events-none' : ''
                    }`}
                  >
                    <div>
                      <h3 className="font-semibold text-brand-teal">{service.name}</h3>
                      <p className="text-sm text-neutral-slate max-w-[380px]">{service.description}</p>
                    </div>
                    <div>
                      {service.enabled ? (
                        isConnected ? (
                          <span className="font-serif text-brand-teal font-semibold flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-brand-teal rounded-full shadow-[0_0_0_4px_rgba(44,74,82,0.1)]" />
                            Active
                          </span>
                        ) : (
                          <button
                            onClick={() => handleConnect(service.id)}
                            className="px-5 py-2 bg-brand-clay text-white font-medium text-sm rounded hover:bg-[#A64D21] transition-all shadow-[0_4px_12px_rgba(191,91,40,0.25)] hover:-translate-y-0.5"
                          >
                            Connect
                          </button>
                        )
                      ) : (
                        <span className="font-serif italic text-neutral-slate opacity-80">Planned</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer Action */}
        <div className="mt-16 text-center">
          <button
            onClick={handleGoToChat}
            disabled={!hasConnection}
            className={`font-serif text-xl text-brand-teal border-b pb-1 transition-all ${
              hasConnection
                ? 'opacity-100 border-brand-clay hover:text-brand-clay cursor-pointer'
                : 'opacity-40 border-brand-teal/30 cursor-not-allowed'
            }`}
          >
            Proceed to Nest &rarr;
          </button>
          <p className="mt-4 text-sm text-neutral-slate italic">
            {hasConnection ? 'Data streams ready.' : 'Establish a connection to proceed.'}
          </p>
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slideDown {
          animation: slideDown 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default ConnectPage;
