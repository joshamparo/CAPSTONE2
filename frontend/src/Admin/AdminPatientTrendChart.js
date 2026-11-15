import React from 'react';
import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';

export default function AdminPatientTrendChart({ data = [] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} dy={10} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} />
        <Tooltip
          cursor={{ fill: 'var(--chart-cursor)' }}
          contentStyle={{
            borderRadius: '10px',
            border: '1px solid var(--chart-tooltip-border)',
            background: 'var(--chart-tooltip-bg)',
            color: 'var(--chart-tooltip-text)',
            boxShadow: '0 14px 28px rgba(2,6,23,.18)'
          }}
        />
        <Bar dataKey="count" name="Patients" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#ea580c' : '#fdba74'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
