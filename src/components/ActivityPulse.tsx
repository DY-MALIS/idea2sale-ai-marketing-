import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Thermometer } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { AudienceActivity } from '../types';

interface ActivityPulseProps {
  version: number;
}

const ActivityPulse: React.FC<ActivityPulseProps> = ({ version }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser) return;
      setLoading(true);
      try {
        const q = query(collection(db, 'audience_activity'), where('userId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const activities = snapshot.docs.map(doc => doc.data() as AudienceActivity);

        // Group by hour and day to show a weekly pulse
        // For simplicity, let's show an average day pulse
        const hourlyPulse = Array.from({ length: 24 }, (_, hour) => {
          const relevantPoints = activities.filter(a => a.hour === hour);
          const avgIntensity = relevantPoints.length > 0
            ? relevantPoints.reduce((acc, curr) => acc + curr.intensity, 0) / relevantPoints.length
            : 0;

          return {
            hour: `${hour}:00`,
            intensity: Math.round(avgIntensity * 100),
          };
        });

        setData(hourlyPulse);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [version]);

  if (loading) return null;
  if (data.every(d => d.intensity === 0)) return null;

  return (
    <div className="glass p-6 rounded-[2rem] shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Thermometer size={18} className="text-brand-500" />
          <h3 className="text-sm font-bold text-brand-700 uppercase tracking-wider">Audience Pulse</h3>
        </div>
        <div className="flex gap-1 items-center">
          <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
          <span className="text-[10px] text-slate-500 uppercase font-medium">Real-time engagement map</span>
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pulseColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35}/>
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#fde68a" vertical={false} />
            <XAxis
              dataKey="hour"
              fontSize={10}
              axisLine={false}
              tickLine={false}
              stroke="#b45309"
              interval={4}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #fde68a', borderRadius: '12px', fontSize: '12px' }}
              itemStyle={{ color: '#b45309' }}
              labelStyle={{ color: '#78716c' }}
            />
            <Area
              type="monotone"
              dataKey="intensity"
              stroke="#f59e0b"
              fillOpacity={1}
              fill="url(#pulseColor)"
              strokeWidth={3}
              animationDuration={2000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-slate-400 mt-2 italic text-center">
        This pulse represents your overall audience engagement based on current training.
      </p>
    </div>
  );
};

export default ActivityPulse;
