import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import AgentSelector from './AgentSelector';
import ChatHistorySidebar from './ChatHistorySidebar';
import { authAPI } from '../api/client';
import { ArtifactProvider } from '../context/ArtifactContext';
import ArtifactSidePanel from './ArtifactSidePanel';

const ChatLayoutContent = () => {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [user, setUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await authAPI.me();
        setUser(userData);
      } catch (error) {
        console.error('Error loading user:', error);
      }
    };
    loadUser();
  }, []);

  const handleAgentSelect = (agent) => {
    setSelectedAgent(agent);
    // Note: In OpenWebUI, selecting a model often starts a new chat or sets context.
    // We will pass this down.
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      navigate('/login');
    } catch (error) {
      navigate('/login');
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-transparent relative font-sans">
      {/* Mobile sidebar backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-brand-teal/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar (History) */}
      <ChatHistorySidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top Bar (Header) */}
        <header className="flex-shrink-0 h-16 bg-white/40 backdrop-blur-md border-b border-white/20 flex items-center justify-between px-4 z-10 relative">
          <div className="flex items-center z-20">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden mr-4 text-brand-teal"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Agent Selector (Left) */}
            <AgentSelector
              selectedAgentId={selectedAgent?.id}
              onAgentSelect={handleAgentSelect}
            />
          </div>

          {/* Centered Brand Title */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <h1 className="hidden md:block text-xl font-serif font-bold text-[#1F4E5F] tracking-wide">The Aiviary</h1>
          </div>

          <div className="flex items-center space-x-4 z-20">
            <button onClick={handleLogout} title="Logout" className="text-neutral-slate hover:text-brand-clay transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        {/* Router Outlet for ChatArea */}
        <div className="flex-1 overflow-hidden relative">
          <Outlet context={{ selectedAgent, user }} />
        </div>
      </div>

      {/* Artifact Side Panel (Right) */}
      <ArtifactSidePanel />
    </div>
  );
};

const ChatLayout = () => {
  return (
    <ArtifactProvider>
      <ChatLayoutContent />
    </ArtifactProvider>
  );
};

export default ChatLayout;
