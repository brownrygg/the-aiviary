import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { chatAPI } from '../api/client';
import ArtifactRenderer from './ArtifactRenderer';

import birdGeometric1 from '../assets/bird_geometric_1.png';
import birdGeometric2 from '../assets/bird_geometric_2.png';
import birdGeometricFlying from '../assets/bird_geometric_flying.png';

// Helper to parse SSE - duplicated from client.js for now (should externalize later)
// actually, let's keep it simple using the client logic or just copy for speed.
// Since client.js has sendMessageToChat with onChunk, we use that.

const ChatArea = () => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedAgent, user } = useOutletContext();
  const selectedAgentId = selectedAgent?.id;
  const selectedAgentName = selectedAgent?.name;

  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input on load
  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [chatId, isLoading]);

  // Load Chat History if chatId exists
  useEffect(() => {
    const loadChat = async () => {
      if (!chatId) {
        setMessages([]);
        return;
      }

      // 1. If we have partial state passed from navigation (New Chat -> Saved), use it first
      if (location.state?.messages) {
        setMessages(location.state.messages);
        // CRITICAL FIX: Do NOT fetch from API immediately. 
        // The backend might still be saving the message (delayed consistency).
        // Trust the local state for this initial load.
        return;
      } else {
        setIsLoading(true);
      }

      try {
        const chatData = await chatAPI.get(chatId);
        setMessages(chatData.messages || []);
      } catch (error) {
        console.error('Error loading chat:', error);
        // Only redirect if we didn't have local state
        if (!location.state?.messages) {
          navigate('/');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadChat();
  }, [chatId, navigate, location.state]);


  const handleSendMessage = async (eOrText) => {
    let messageText = '';
    if (typeof eOrText === 'string') {
      messageText = eOrText;
    } else {
      if (eOrText?.preventDefault) eOrText.preventDefault();
      messageText = inputMessage;
    }

    if (!messageText.trim() || isSending) return;

    if (!selectedAgentId) {
      alert('Please select a model/agent first.');
      return;
    }

    setInputMessage('');
    setIsSending(true);

    // Optimistically add user message
    const tempUserId = Date.now();
    const userMessage = {
      id: tempUserId,
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Placeholder for assistant
    const assistantMsgId = Date.now() + 1;
    const assistantMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      let activeChatId = chatId;

      // If New Chat (no ID), Create it first
      if (!activeChatId) {
        const newChat = await chatAPI.createChat(selectedAgentId, messageText.substring(0, 30) + '...');
        activeChatId = newChat.id;

        // Update URL without reloading (replace)
        // Actually we should navigate so the URL updates and Sidebar refreshes
        // But we don't want to unmount this component if possible.
        // React Router navigate replaces URL.
        window.history.replaceState(null, '', `/c/${activeChatId}`);
        // Ideally we trigger sidebar update here context/event
      }

      await chatAPI.sendMessageToChat(
        activeChatId,
        messageText,
        (chunk) => {
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId ? { ...msg, content: msg.content + chunk } : msg
          ));
        },
        (fullResponse) => {
          setIsSending(false);
          setStatusMessage('');

          if (!chatId) {
            // For new chat, pass the final state to the next route to prevent flashing
            const finalMessages = [
              userMessage,
              { ...assistantMessage, content: fullResponse }
            ];
            navigate(`/c/${activeChatId}`, {
              replace: true,
              state: { messages: finalMessages }
            });
          }
        },
        (err) => {
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId ? { ...msg, isError: true, content: 'Error: ' + err } : msg
          ));
          setIsSending(false);
        },
        (status) => setStatusMessage(status)
      );

    } catch (error) {
      console.error('Send error:', error);
      setIsSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // --- RENDER ---

  // Empty State (New Chat)
  if (!chatId && messages.length === 0) {
    const examplePrompts = [
      "Analyze the sentiment of my recent comments",
      "What is the best time to post based on my history?",
      "Show me a chart of my engagement rate",
      "Draft a caption for a sunset photo"
    ];

    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-4xl w-full">
          <h2 className="text-3xl font-serif font-bold text-brand-teal mb-3">
            {selectedAgentName || 'How can I help you today?'}
          </h2>
          <p className="text-neutral-slate mb-10 max-w-2xl mx-auto text-lg leading-relaxed">
            {selectedAgent?.description || 'I can help you analyze your social media data, generate beautiful charts, and brainstorm content strategies using your own data.'}
          </p>

          {/* Input for Empty State */}
          <div className="w-full relative max-w-3xl mx-auto mb-10 shadow-xl rounded-xl">
            {/* Decorative Birds */}
            <img
              src={birdGeometric1}
              alt=""
              className="absolute -top-12 -left-8 w-24 h-auto transform -rotate-12 opacity-90 pointer-events-none z-10"
            />
            <img
              src={birdGeometricFlying}
              alt=""
              className="absolute -top-16 -right-12 w-28 h-auto transform rotate-6 opacity-80 pointer-events-none z-10"
            />

            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask anything..."
              rows={1}
              className="w-full p-5 pr-14 rounded-xl border border-white/50 shadow-sm focus:border-brand-teal focus:ring-1 focus:ring-brand-teal resize-none bg-white/90 backdrop-blur-md text-lg"
              style={{ minHeight: '64px' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isSending}
              className="absolute right-3 bottom-3 p-2.5 bg-brand-teal text-white rounded-lg hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* Example Prompts */}
          <div className="relative">
            <img
              src={birdGeometric2}
              alt=""
              className="absolute -top-10 right-0 w-20 h-auto transform rotate-3 opacity-90 pointer-events-none z-10"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto text-left px-2">
              {examplePrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(prompt)}
                  className="p-4 rounded-xl border border-white/40 bg-white/40 hover:bg-white/70 hover:border-brand-teal/30 transition-all text-sm text-neutral-charcoal shadow-sm hover:shadow-md backdrop-blur-sm group flex items-center gap-3"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-teal/10 flex items-center justify-center text-brand-teal group-hover:bg-brand-teal group-hover:text-white transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 content-center scroll-smooth">
        <div className="max-w-3xl mx-auto space-y-8 pb-4">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const isStreaming = !isUser && isSending && idx === messages.length - 1;

            return (
              <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
                <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center space-x-2 mb-2 px-1">
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${isUser ? 'text-brand-clay' : 'text-brand-teal'}`}>
                      {isUser ? (user?.full_name || 'You') : (selectedAgentName || 'Analytics Agent')}
                    </span>

                    {/* Persistent Status Indicator */}
                    {isStreaming && (
                      <div className="flex items-center space-x-1.5 ml-3 bg-brand-teal/5 px-2 py-0.5 rounded-full border border-brand-teal/10">
                        <div className="flex space-x-0.5">
                          <div className="w-1.5 h-1.5 bg-brand-teal rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-brand-teal rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-brand-teal rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-[10px] font-medium text-brand-teal uppercase tracking-widest animate-pulse">
                          {statusMessage || 'Thinking...'}
                        </span>
                      </div>
                    )}
                  </div>


                  {(msg.content || isUser) && (
                    <div className={`rounded-2xl px-6 py-5 shadow-sm transition-all ${isUser
                      ? 'bg-[#F3F4F6] text-neutral-charcoal'
                      : 'bg-white text-neutral-charcoal border border-neutral-100 shadow-sm'
                      }`}>
                      {isUser ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        <div className="prose prose-sm max-w-none prose-slate leading-relaxed">
                          <ArtifactRenderer content={msg.content} />
                          {/* Cursor only if no status indicator or if we want extra feedback */}
                          {isStreaming && msg.content && (
                            <span className="inline-block w-2 h-4 align-middle bg-brand-teal/50 animate-pulse ml-1" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Error State */}
                  {msg.isError && (
                    <p className="text-red-500 text-xs mt-2 pl-1 font-medium">Failed to send message</p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area (Sticky Bottom) */}
      <div className="flex-shrink-0 p-4 bg-gradient-to-t from-white via-white to-transparent pt-10">
        <div className="max-w-3xl mx-auto relative">
          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Message..."
            rows={1}
            className="w-full p-4 pr-12 rounded-xl border border-gray-200 shadow-sm focus:border-brand-teal focus:ring-1 focus:ring-brand-teal resize-none bg-white"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isSending}
            className="absolute right-3 bottom-3 p-2 bg-brand-teal text-white rounded-lg hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-center text-xs text-neutral-slate/50 mt-2">
          AI can make mistakes. Please verify important information.
        </p>
      </div>
    </div>
  );
};

export default ChatArea;
