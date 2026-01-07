import React from 'react';
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    PieChart,
    Pie,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { Download, Maximize2 } from 'lucide-react';

// Custom colors matching the brand theme
const COLORS = [
    '#2C4A52', // Deep Teal (Brand Primary)
    '#8E6C5D', // Clay (Brand Secondary)
    '#537A82', // Lighter Teal
    '#BFAE9F', // Sand/Beige
    '#E67E22', // Accent Orange
    '#2980B9', // Accent Blue
    '#27AE60', // Accent Green
    '#8E44AD'  // Accent Purple
];

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/95 border border-gray-200 p-3 rounded-lg shadow-lg text-sm backdrop-blur-sm">
                <p className="font-semibold text-neutral-charcoal mb-2">{label}</p>
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center gap-2 mb-1 last:mb-0">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-gray-600 capitalize">{entry.name}:</span>
                        <span className="font-medium text-neutral-charcoal">
                            {entry.value.toLocaleString()}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const ChartRenderer = ({ config }) => {
    if (!config || !config.data || !config.type) {
        return (
            <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm">
                Invalid chart configuration
            </div>
        );
    }

    const { type, title, subtitle, data, xAxisKey, dataKeys } = config;

    const renderChart = () => {
        switch (type) {
            case 'bar':
                return (
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis
                            dataKey={xAxisKey}
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value.toLocaleString()}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {dataKeys.map((key, index) => (
                            <Bar
                                key={key.key}
                                dataKey={key.key}
                                name={key.label || key.key}
                                fill={key.color || COLORS[index % COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                barSize={32}
                            />
                        ))}
                    </BarChart>
                );

            case 'line':
                return (
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis
                            dataKey={xAxisKey}
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value.toLocaleString()}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {dataKeys.map((key, index) => (
                            <Line
                                key={key.key}
                                type="monotone"
                                dataKey={key.key}
                                name={key.label || key.key}
                                stroke={key.color || COLORS[index % COLORS.length]}
                                strokeWidth={3}
                                dot={{ r: 4, fill: 'white', strokeWidth: 2 }}
                                activeDot={{ r: 6 }}
                            />
                        ))}
                    </LineChart>
                );

            case 'area':
                return (
                    <AreaChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis
                            dataKey={xAxisKey}
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value.toLocaleString()}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {dataKeys.map((key, index) => (
                            <Area
                                key={key.key}
                                type="monotone"
                                dataKey={key.key}
                                name={key.label || key.key}
                                stroke={key.color || COLORS[index % COLORS.length]}
                                fill={key.color || COLORS[index % COLORS.length]}
                                fillOpacity={0.2}
                            />
                        ))}
                    </AreaChart>
                );

            case 'pie':
                return (
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value" // Standardize pie data to have 'name' and 'value' keys
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    </PieChart>
                );

            default:
                return (
                    <div className="flex items-center justify-center h-full text-gray-500">
                        Unsupported chart type: {type}
                    </div>
                );
        }
    };

    return (
        <div className="w-full my-6 bg-white border border-gray-100 rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow duration-200">
            <div className="flex justify-between items-start mb-6">
                <div>
                    {title && (
                        <h3 className="font-serif text-lg font-semibold text-neutral-charcoal mb-1">
                            {title}
                        </h3>
                    )}
                    {subtitle && (
                        <p className="text-sm text-gray-500">
                            {subtitle}
                        </p>
                    )}
                </div>

                {/* Actions (could be enhanced with download logic) */}
                <div className="flex gap-2">
                    <button
                        className="p-1.5 text-gray-400 hover:text-brand-teal hover:bg-brand-teal/5 rounded-md transition-colors"
                        title="Download Image"
                    >
                        <Download size={16} />
                    </button>
                    <button
                        className="p-1.5 text-gray-400 hover:text-brand-teal hover:bg-brand-teal/5 rounded-md transition-colors"
                        title="Expand"
                    >
                        <Maximize2 size={16} />
                    </button>
                </div>
            </div>

            <div className="w-full h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                    {renderChart()}
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default ChartRenderer;
