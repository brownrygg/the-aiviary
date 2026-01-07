import { useState, useEffect } from 'react';
import { agentsAPI } from '../api/client';

const AgentManagement = () => {
  const [agents, setAgents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    webhook_url: '',
    webhook_token: '',
    system_prompt: 'You are a helpful AI assistant.',
    config: '{}'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      setIsLoading(true);
      const data = await agentsAPI.list();
      setAgents(data);
    } catch (err) {
      setError('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Parse config JSON
    let parsedConfig = {};
    try {
      if (formData.config && formData.config.trim()) {
        parsedConfig = JSON.parse(formData.config);
      }
    } catch (err) {
      setError('Invalid JSON in Configuration field');
      return;
    }

    const payload = { ...formData, config: parsedConfig };

    try {
      if (editingAgent) {
        // Update existing agent
        await agentsAPI.update(editingAgent.id, payload);
        setSuccess('Agent updated successfully!');
      } else {
        // Create new agent
        await agentsAPI.create(payload);
        setSuccess('Agent created successfully!');
      }

      resetForm();
      loadAgents();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save agent');
    }
  };

  const handleEdit = (agent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      webhook_url: agent.webhook_url,
      webhook_token: agent.webhook_token || '',
      system_prompt: agent.system_prompt || 'You are a helpful AI assistant.',
      config: JSON.stringify(agent.config || {}, null, 2)
    });
    setShowForm(true);
  };

  const handleDelete = async (agentId) => {
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      await agentsAPI.delete(agentId);
      setSuccess('Agent deleted successfully!');
      loadAgents();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to delete agent');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      webhook_url: '',
      webhook_token: '',
      system_prompt: 'You are a helpful AI assistant.',
      config: '{}'
    });
    setEditingAgent(null);
    setShowForm(false);
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading agents...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Header with Add Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Agents</h2>
          <p className="text-sm text-gray-600 mt-1">Manage your AI agents and n8n webhook integrations</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
        >
          {showForm ? 'Cancel' : '+ New Agent'}
        </button>
      </div>

      {/* Agent Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingAgent ? 'Edit Agent' : 'Create New Agent'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Agent Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Customer Support Bot"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Brief description of the agent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                n8n Webhook URL *
              </label>
              <input
                type="url"
                value={formData.webhook_url}
                onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                placeholder="https://your-n8n.com/webhook/abc123"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                The webhook URL from your n8n workflow
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Webhook Bearer Token (Optional)
              </label>
              <input
                type="text"
                value={formData.webhook_token}
                onChange={(e) => setFormData({ ...formData, webhook_token: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                placeholder="your-secret-token"
              />
              <p className="text-xs text-gray-500 mt-1">
                Optional security token for webhook authentication
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                System Prompt *
              </label>
              <textarea
                value={formData.system_prompt}
                onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows="4"
                placeholder="You are a helpful AI assistant..."
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Instructions that define the agent's behavior and personality
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Configuration (JSON)
              </label>
              <textarea
                value={formData.config}
                onChange={(e) => setFormData({ ...formData, config: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows="4"
                placeholder="{}"
              />
              <p className="text-xs text-gray-500 mt-1">
                Additional settings in JSON format (e.g., model, type)
              </p>
            </div>

            <div className="flex space-x-3 pt-4">
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
              >
                {editingAgent ? 'Update Agent' : 'Create Agent'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Agents List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Webhook URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {agents.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-gray-500">
                    No agents yet. Create your first agent to get started!
                  </td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{agent.name}</div>
                      {agent.description && (
                        <div className="text-sm text-gray-500">{agent.description}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-mono text-gray-600 truncate max-w-md">
                        {agent.webhook_url}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${agent.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                        }`}>
                        {agent.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm space-x-2">
                      <button
                        onClick={() => handleEdit(agent)}
                        className="text-blue-600 hover:text-blue-900 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(agent.id)}
                        className="text-red-600 hover:text-red-900 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AgentManagement;
