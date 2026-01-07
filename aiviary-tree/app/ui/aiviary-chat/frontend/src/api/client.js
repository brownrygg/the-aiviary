import axios from 'axios';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true, // Important for httpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token if needed
apiClient.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors globally
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - redirect to login if needed
      const currentPath = window.location.pathname;
      if (currentPath !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API calls
export const authAPI = {
  login: async (email, password) => {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
  },

  register: async (userData) => {
    const response = await apiClient.post('/auth/register', userData);
    return response.data;
  },

  logout: async () => {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },

  me: async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },
};

// Agents API calls
export const agentsAPI = {
  list: async () => {
    const response = await apiClient.get('/agents');
    return response.data;
  },

  get: async (agentId) => {
    const response = await apiClient.get(`/agents/${agentId}`);
    return response.data;
  },

  create: async (agentData) => {
    const response = await apiClient.post('/agents', agentData);
    return response.data;
  },

  update: async (agentId, agentData) => {
    const response = await apiClient.put(`/agents/${agentId}`, agentData);
    return response.data;
  },

  delete: async (agentId) => {
    const response = await apiClient.delete(`/agents/${agentId}`);
    return response.data;
  },
};

// Users API calls (Admin)
export const usersAPI = {
  list: async () => {
    const response = await apiClient.get('/users');
    return response.data;
  },

  delete: async (userId) => {
    const response = await apiClient.delete(`/users/${userId}`);
    return response.data;
  },

  create: async (userData) => {
    const response = await apiClient.post('/users', userData);
    return response.data;
  },
};


// Chat API calls
export const chatAPI = {
  // Standard REST API methods
  list: async () => {
    const response = await apiClient.get('/chats');
    return response.data;
  },

  get: async (chatId) => {
    const response = await apiClient.get(`/chats/${chatId}`);
    return response.data;
  },

  createChat: async (agentId, title) => {
    const response = await apiClient.post('/chats', {
      agent_id: agentId,
      title: title || 'New Chat'
    });
    return response.data;
  },

  deleteChat: async (chatId) => {
    const response = await apiClient.delete(`/chats/${chatId}`);
    return response.data;
  },

  sendMessageToChat: async (chatId, message, onChunk, onDone, onError, onStatus) => {
    try {
      const response = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ content: message }), // Standard endpoint expects 'content'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Re-use the same SSE reading logic as legacy...
      // (We can duplicate for now to keep it self-contained or refactor code sharing if needed)
      // For simplicity in this tool call, I will duplicate the reader logic since it's robust

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'message' && event.data?.content) {
                fullMessage += event.data.content;
                if (onChunk) onChunk(event.data.content);
              } else if (event.type === 'status') {
                if (onStatus) onStatus(event.data?.description || 'Processing...');
              } else if (event.type === 'done') {
                if (onStatus) onStatus('');
                if (onDone) onDone(fullMessage);
              } else if (event.type === 'error') {
                if (onStatus) onStatus('');
                if (onError) onError(event.data?.message || 'Unknown error');
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', data);
              fullMessage += data;
              if (onChunk) onChunk(data);
            }
          }
        }
      }
      return { message: fullMessage };
    } catch (error) {
      if (onError) onError(error.message);
      throw error;
    }
  },

  // Legacy (Keep for backward compatibility if needed, but we are switching away)
  sendMessage: async (agentId, message, onChunk, onDone, onError, onStatus) => {
    // ... legacy implementation ...
    try {
      const response = await fetch(`/api/chat/${agentId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ message }),
      });
      // ... same reader logic ...
      // To save token output space, referring to existing implementation
      // But since I'm replacing the whole block, I must be careful.
      // Actually, I will just prepend the new methods and keep the old one as is? 
      // replace_file_content works on blocks.
      // I'll rewrite the sendMessage but implementation is identical reader-wise.
      // Let's just create a shared reader helper? No, too much refactoring risk.
      // I'll just paste the reader logic again.
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              if (event.type === 'message' && event.data?.content) {
                fullMessage += event.data.content;
                if (onChunk) onChunk(event.data.content);
              } else if (event.type === 'status') {
                if (onStatus) onStatus(event.data?.description || 'Processing...');
              } else if (event.type === 'done') {
                if (onStatus) onStatus('');
                if (onDone) onDone(fullMessage);
              } else if (event.type === 'error') {
                if (onStatus) onStatus('');
                if (onError) onError(event.data?.message || 'Unknown error');
              }
            } catch (e) {
              fullMessage += data;
              if (onChunk) onChunk(data);
            }
          }
        }
      }
      return { message: fullMessage };
    } catch (error) {
      if (onError) onError(error.message);
      throw error;
    }
  },

  getHistory: async (agentId, limit = 50) => {
    const response = await apiClient.get(`/chat/${agentId}/history`, {
      params: { limit }
    });
    return response.data;
  },
};

export default apiClient;
