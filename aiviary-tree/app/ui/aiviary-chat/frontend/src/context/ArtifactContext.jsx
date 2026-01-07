import React, { createContext, useContext, useState } from 'react';

const ArtifactContext = createContext();

export const useArtifact = () => {
    const context = useContext(ArtifactContext);
    if (!context) {
        throw new Error('useArtifact must be used within an ArtifactProvider');
    }
    return context;
};

export const ArtifactProvider = ({ children }) => {
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [activeArtifact, setActiveArtifact] = useState(null); // { type, content, title }

    const openArtifact = (artifact) => {
        setActiveArtifact(artifact);
        setIsPanelOpen(true);
    };

    const closePanel = () => {
        setIsPanelOpen(false);
        // Don't clear activeArtifact immediately to avoid content jumping during transition
    };

    const togglePanel = () => {
        setIsPanelOpen(prev => !prev);
    };

    return (
        <ArtifactContext.Provider value={{
            isPanelOpen,
            activeArtifact,
            openArtifact,
            closePanel,
            togglePanel
        }}>
            {children}
        </ArtifactContext.Provider>
    );
};
