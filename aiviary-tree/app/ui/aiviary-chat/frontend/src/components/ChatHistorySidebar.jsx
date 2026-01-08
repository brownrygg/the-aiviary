import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { chatAPI, authAPI } from '../api/client';
import AiviaryConnectDrawer from './AiviaryConnectDrawer';

const ChatHistorySidebar = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const { chatId } = useParams();
    const [chats, setChats] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    // User is now loaded in layout but we don't have it passed here yet.
    // Wait, I need to pass user to ChatHistorySidebar in ChatLayout.
    const [user, setUser] = useState(null); // Keep local for now to avoid breaking if props missing or redundant fetch optimization later

    // Actually simplicity: Fetching twice is okay for now, or I pass it. I will keep local fetch to minimize diffs and potential bugs, 
    // BUT user asked for User Name in Main Area. ChatLayout has it.
    // I'll leave sidebar as is for now to avoid regression risk, focusing on ChatArea.
    const [chatToDelete, setChatToDelete] = useState(null); // ID of chat to delete
    const [isDeleting, setIsDeleting] = useState(false);
    const [isConnectDrawerOpen, setIsConnectDrawerOpen] = useState(false);

    const loadChats = async () => {
        try {
            const data = await chatAPI.list();
            setChats(data);
        } catch (error) {
            console.error('Error loading chats:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadUser = async () => {
        try {
            const userData = await authAPI.me();
            setUser(userData);
        } catch (error) {
            console.error('Error loading user:', error);
        }
    };

    useEffect(() => {
        loadChats();
        loadUser();
    }, [chatId]);

    const handleNewChat = () => {
        navigate('/chat');
        if (window.innerWidth < 1024) onClose();
    };

    const handleChatClick = (id) => {
        navigate(`/chat/${id}`);
        if (window.innerWidth < 1024) onClose();
    };

    const handleAdminClick = (e) => {
        e.stopPropagation();
        navigate('/admin');
    };

    const confirmDelete = (e, chat) => {
        e.stopPropagation();
        setChatToDelete(chat);
    };

    const cancelDelete = () => {
        setChatToDelete(null);
    };

    const handleDeleteChat = async () => {
        if (!chatToDelete) return;

        setIsDeleting(true);
        try {
            await chatAPI.deleteChat(chatToDelete.id);
            setChats(chats.filter(c => c.id !== chatToDelete.id));
            if (chatId === chatToDelete.id) {
                navigate('/chat');
            }
            setChatToDelete(null);
        } catch (error) {
            console.error('Error deleting chat:', error);
            // Optionally show error toast
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div
            className={`fixed inset-y-0 left-0 flex flex-col w-64 glass-panel border-r border-white/40 z-30 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
        >
            {/* Header / New Chat */}
            <div className="p-4 border-b border-white/20">
                <button
                    onClick={handleNewChat}
                    className="w-full flex items-center justify-between px-4 py-2 bg-brand-teal/10 hover:bg-brand-teal/20 text-brand-teal rounded-lg border border-transparent hover:border-brand-teal/30 transition-all group"
                >
                    <span className="font-medium text-sm">New Chat</span>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-2">
                {isLoading ? (
                    <div className="flex justify-center py-4">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-teal"></div>
                    </div>
                ) : chats.length === 0 ? (
                    <div className="text-center py-8 text-neutral-slate/70 text-sm">
                        <p>No chat history</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {chats.map(chat => (
                            <div key={chat.id} className="group relative">
                                <button
                                    onClick={() => handleChatClick(chat.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors pr-8 ${chatId == chat.id
                                        ? 'bg-brand-teal/10 text-brand-teal font-medium'
                                        : 'text-neutral-charcoal hover:bg-white/40'
                                        }`}
                                >
                                    {chat.title || 'New Chat'}
                                    <span className="block text-[10px] text-neutral-slate/60 mt-0.5">
                                        {new Date(chat.created_at || Date.now()).toLocaleDateString()}
                                    </span>
                                </button>
                                <button
                                    onClick={(e) => confirmDelete(e, chat)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-slate/40 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all z-10"
                                    title="Delete chat"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom/User Section */}
            <div className="p-4 border-t border-white/20 bg-white/10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="w-8 h-8 flex-shrink-0 rounded-full bg-brand-clay/20 flex items-center justify-center">
                            <span className="text-brand-clay font-bold text-xs">
                                {user?.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
                            </span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-charcoal truncate">
                                {user?.full_name || 'User Account'}
                            </p>
                            <p className="text-xs text-neutral-slate truncate">
                                {user?.email}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-1">
                        {/* Connect Platforms button - visible to all users */}
                        <button
                            onClick={() => setIsConnectDrawerOpen(true)}
                            title="Connect Platforms"
                            className="p-1.5 text-neutral-slate hover:text-brand-clay hover:bg-brand-clay/10 rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                        </button>

                        {/* Admin Settings button - admin only */}
                        {user?.role === 'admin' && (
                            <button
                                onClick={handleAdminClick}
                                title="Admin Settings"
                                className="p-1.5 text-neutral-slate hover:text-brand-teal hover:bg-brand-teal/10 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Aiviary Connect Drawer */}
            <AiviaryConnectDrawer
                isOpen={isConnectDrawerOpen}
                onClose={() => setIsConnectDrawerOpen(false)}
            />

            {/* Delete Confirmation Modal */}
            {
                chatToDelete && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 border border-white/20 transform transition-all scale-100">
                            <h3 className="text-lg font-serif font-bold text-brand-teal mb-2">Delete Chat?</h3>
                            <p className="text-sm text-neutral-slate mb-6">
                                Are you sure you want to delete <span className="font-medium text-neutral-charcoal">"{chatToDelete.title || 'this chat'}"</span>? This action cannot be undone.
                            </p>
                            <div className="flex justify-end space-x-3">
                                <button
                                    onClick={cancelDelete}
                                    className="px-4 py-2 text-sm font-medium text-neutral-slate hover:text-neutral-charcoal transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteChat}
                                    disabled={isDeleting}
                                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                                >
                                    {isDeleting ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default ChatHistorySidebar;
