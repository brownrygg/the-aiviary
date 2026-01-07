import { useEffect, useState } from 'react';
import { agentsAPI } from '../api/client';

const AgentSelector = ({ selectedAgentId, onAgentSelect }) => {
  const [agents, setAgents] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const data = await agentsAPI.list();
        setAgents(data);
        if (data.length > 0 && !selectedAgentId) {
          onAgentSelect(data[0]);
        }
      } catch (err) {
        console.error('Error fetching agents:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAgents();
  }, [selectedAgentId, onAgentSelect]); // careful with deps

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors text-brand-teal font-medium"
      >
        <span>{selectedAgent?.name || 'Select Model'}</span>
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-64 bg-white/90 backdrop-blur-md border border-white/50 rounded-xl shadow-lg z-50 overflow-hidden py-1 max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-neutral-slate">Loading...</div>
            ) : (
              agents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => {
                    onAgentSelect(agent);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-brand-teal/5 flex items-center justify-between group ${selectedAgentId === agent.id ? 'text-brand-teal font-medium bg-brand-teal/5' : 'text-neutral-charcoal'
                    }`}
                >
                  <span>{agent.name}</span>
                  {selectedAgentId === agent.id && (
                    <svg className="w-4 h-4 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AgentSelector;
