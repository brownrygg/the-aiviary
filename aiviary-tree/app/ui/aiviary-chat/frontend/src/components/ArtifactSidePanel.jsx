import React from 'react';
import { useArtifact } from '../context/ArtifactContext';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import mermaid from 'mermaid';
import { useEffect, useState } from 'react';
import ChartRenderer from './ChartRenderer';

// Initialize mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
});

// Re-use MermaidChart logic but optimized for side panel
const SidePanelMermaid = ({ chart }) => {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState(false);

    useEffect(() => {
        const renderChart = async () => {
            try {
                const id = `mermaid-panel-${Math.random().toString(36).substr(2, 9)}`;
                let cleanChart = chart
                    .replace(/```mermaid/g, '')
                    .replace(/```/g, '')
                    .trim();

                if (cleanChart.includes('&gt;')) cleanChart = cleanChart.replace(/&gt;/g, '>');
                if (cleanChart.includes('&lt;')) cleanChart = cleanChart.replace(/&lt;/g, '<');

                // Robustness: Attempt to quote unquoted node labels
                // This regex finds content inside [] that isn't already quoted and wrap it in double quotes
                cleanChart = cleanChart.replace(/\[\s*(?!["'])(.+?)(?!["'])\s*\]/g, '["$1"]');

                // Robustness: Quote unquoted subgraph titles
                // Matches "subgraph Title with spaces" and converts to "subgraph "Title with spaces""
                cleanChart = cleanChart.replace(/^\s*subgraph\s+(?!["'])(.+?)\s*$/gm, 'subgraph "$1"');

                const { svg } = await mermaid.render(id, cleanChart);
                setSvg(svg);
                setError(false);
            } catch (error) {
                console.warn('SidePanel Mermaid render warning:', error);
                setError(true);
            }
        };
        renderChart();
    }, [chart]);

    if (error) {
        return (
            <div className="p-4 flex flex-col h-full">
                <div className="text-red-500 text-sm mb-4 font-semibold flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Rendering Failed (Syntax Error)
                </div>
                <div className="flex-1 overflow-auto bg-gray-900 rounded-lg p-4 border border-red-500/20">
                    <p className="text-gray-400 text-xs mb-2">Adjusted Source Code:</p>
                    <SyntaxHighlighter language="mermaid" style={oneDark} className="!bg-transparent !p-0 text-xs">
                        {chart}
                    </SyntaxHighlighter>
                </div>
            </div>
        );
    }

    return (
        <div
            className="mermaid-chart bg-white p-6 rounded-lg shadow-sm overflow-auto max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
};

const ArtifactSidePanel = () => {
    const { isPanelOpen, activeArtifact, closePanel } = useArtifact();

    // Determine content to render
    const renderContent = () => {
        if (!activeArtifact) return null;

        if (activeArtifact.type === 'mermaid') {
            return (
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-auto p-4">
                        <SidePanelMermaid chart={activeArtifact.content} />
                    </div>
                    <div className="p-4 border-t border-white/10 bg-black/20">
                        <h4 className="text-sm font-medium text-brand-teal mb-2">Source Code</h4>
                        <SyntaxHighlighter language="mermaid" style={oneDark} className="rounded-lg text-xs !bg-gray-900 max-h-40 overflow-auto">
                            {activeArtifact.content}
                        </SyntaxHighlighter>
                    </div>
                </div>
            );
        }

        if (activeArtifact.type === 'chart') {
            return (
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                        <ChartRenderer config={activeArtifact.content} />
                    </div>
                    <div className="p-4 border-t border-white/10 bg-black/20">
                        <h4 className="text-sm font-medium text-brand-teal mb-2">Configuration</h4>
                        <SyntaxHighlighter language="json" style={oneDark} className="rounded-lg text-xs !bg-gray-900 max-h-40 overflow-auto">
                            {JSON.stringify(activeArtifact.content, null, 2)}
                        </SyntaxHighlighter>
                    </div>
                </div>
            );
        }

        // Default code blocks
        return (
            <div className="p-4 overflow-auto h-full">
                <SyntaxHighlighter language={activeArtifact.type || 'text'} style={oneDark} className="rounded-lg text-sm !bg-gray-900 h-full">
                    {activeArtifact.content}
                </SyntaxHighlighter>
            </div>
        );
    };

    return (
        <div
            className={`fixed inset-y-0 right-0 flex flex-col w-[500px] glass-panel border-l border-white/40 z-30 transform transition-transform duration-300 ease-in-out ${isPanelOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
        >
            {/* Header */}
            <div className="flex items-center justify-between h-16 px-6 border-b border-white/20 bg-white/10 backdrop-blur-md">
                <div className="flex items-center space-x-2">
                    <svg className="h-5 w-5 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <h2 className="text-lg font-serif font-bold text-brand-teal">
                        {activeArtifact ? (activeArtifact.title || 'Artifact Viewer') : 'Artifact Viewer'}
                    </h2>
                </div>
                <button
                    onClick={closePanel}
                    className="text-neutral-slate hover:text-brand-teal transition-colors"
                >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden bg-white/50">
                {activeArtifact ? renderContent() : (
                    <div className="flex items-center justify-center h-full text-neutral-slate/60">
                        Select an artifact to view
                    </div>
                )}
            </div>
        </div>
    );
};

export default ArtifactSidePanel;
