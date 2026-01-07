import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useArtifact } from '../context/ArtifactContext';
import ChartRenderer from './ChartRenderer';

const ArtifactRenderer = ({ content, type = 'markdown' }) => {
    const { openArtifact } = useArtifact();

    if (!content) return null;

    // Handle specific artifact types
    if (type === 'mermaid') {
        return (
            <div className="my-4">
                <button
                    onClick={() => openArtifact({ type: 'mermaid', content, title: 'Mermaid Diagram' })}
                    className="flex items-center space-x-2 bg-white border border-gray-200 hover:border-brand-teal/50 hover:bg-brand-teal/5 px-4 py-3 rounded-lg shadow-sm w-full transition-all group group-hover:shadow-md"
                >
                    <div className="bg-brand-teal/10 p-2 rounded-md group-hover:bg-brand-teal/20 transition-colors">
                        <svg className="h-6 w-6 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                    </div>
                    <div className="flex-1 text-left">
                        <h4 className="font-serif font-medium text-neutral-charcoal text-sm">Visual Artifact</h4>
                        <p className="text-xs text-neutral-slate">Click to view diagram</p>
                    </div>
                    <svg className="h-5 w-5 text-gray-400 group-hover:text-brand-teal group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
        );
    }

    // Detect and extract artifacts from markdown content
    return (
        <div className="artifact-renderer prose prose-slate max-w-none dark:prose-invert">
            <ReactMarkdown
                components={{
                    code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';
                        const value = String(children).replace(/\n$/, '');

                        // Intercept Mermaid blocks
                        if (!inline && language === 'mermaid') {
                            return (
                                <div className="my-4">
                                    <button
                                        onClick={() => openArtifact({ type: 'mermaid', content: value, title: 'Mermaid Diagram' })}
                                        className="flex items-center space-x-2 bg-gray-50 border border-gray-200 hover:border-brand-teal/50 hover:bg-brand-teal/5 px-4 py-2 rounded-lg w-full transition-all group"
                                    >
                                        <div className="bg-brand-teal/10 p-1.5 rounded group-hover:bg-brand-teal/20">
                                            <svg className="h-4 w-4 text-brand-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 text-left">
                                            <span className="text-xs font-medium text-gray-700 group-hover:text-brand-teal">View Diagram (Legacy)</span>
                                        </div>
                                    </button>
                                </div>
                            );
                        }

                        // Intercept JSON Chart blocks (Recharts)
                        // Checks for 'json-chart' tag OR 'json' tag with valid chart schema
                        if (!inline && (language === 'json-chart' || language === 'json')) {
                            let chartConfig = null;
                            let isParsing = true;
                            let parseError = null;

                            try {
                                chartConfig = JSON.parse(value);
                                isParsing = false;
                            } catch (e) {
                                // If parsing fails, we assume it's because it's still streaming/incomplete
                                parseError = e;
                            }

                            // If we successfully parsed it, check if it is a chart
                            if (!isParsing && chartConfig && chartConfig.type &&
                                ['bar', 'line', 'pie', 'area'].includes(chartConfig.type)) {
                                return (
                                    <div className="my-4">
                                        <button
                                            onClick={() => openArtifact({
                                                type: 'chart',
                                                content: chartConfig,
                                                title: chartConfig.title || 'Chart Visualization'
                                            })}
                                            className="flex items-center space-x-3 bg-white border border-gray-200 hover:border-brand-teal/50 hover:bg-brand-teal/5 px-4 py-3 rounded-xl shadow-sm w-full transition-all group duration-200"
                                        >
                                            <div className="bg-brand-clay/10 p-2.5 rounded-lg group-hover:bg-brand-clay/20 transition-colors">
                                                <svg className="h-6 w-6 text-brand-clay" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                </svg>
                                            </div>
                                            <div className="flex-1 text-left">
                                                <h4 className="font-serif font-bold text-neutral-charcoal text-base">
                                                    {chartConfig.title || 'Data Visualization'}
                                                </h4>
                                                <p className="text-xs text-neutral-slate mt-0.5">
                                                    Click to view interactive chart
                                                </p>
                                            </div>
                                            <div className="h-8 w-8 flex items-center justify-center rounded-full bg-gray-50 group-hover:bg-white text-gray-400 group-hover:text-brand-teal transition-all shadow-sm">
                                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </div>
                                        </button>
                                    </div>
                                );
                            }

                            // If parsing failed (likely streaming) OR it parses but isn't a chart (yet?)
                            // Show loading state if explicit 'json-chart' OR 'json' with chart indicators
                            const isLikelyChart = language === 'json-chart' ||
                                (language === 'json' && /"type":\s*"(bar|line|pie|area)"/.test(value));

                            if (isLikelyChart && (isParsing || !chartConfig)) {
                                return (
                                    <div className="my-4 p-4 bg-brand-teal/5 border border-brand-teal/20 rounded-xl flex items-center gap-3 animate-pulse">
                                        <div className="h-5 w-5 border-2 border-brand-teal border-t-transparent rounded-full animate-spin" />
                                        <span className="text-sm font-serif italic text-brand-teal">
                                            Weaving data tapestry...
                                        </span>
                                    </div>
                                );
                            }

                            // If it is just 'json' and NOT a valid chart config, fall through to default code block
                            // (We don't want to capture all JSON blocks)
                        }

                        // Default Code Block Rendering
                        return !inline ? (
                            <SyntaxHighlighter
                                {...props}
                                style={oneDark}
                                language={language}
                                PreTag="div"
                                className="rounded-lg !bg-gray-900 !m-0"
                            >
                                {value}
                            </SyntaxHighlighter>
                        ) : (
                            <code {...props} className={className}>
                                {children}
                            </code>
                        );
                    }
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default ArtifactRenderer;
