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
    <div className="bg-[#151619] border border-[#2A2B2F] rounded-xl p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Thermometer size={18} className="text-orange-500" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Audience Pulse</h3>
        </div>
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-[10px] text-[#8E9299] uppercase font-medium">Real-time engagement map</span>
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pulseColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2B2F" vertical={false} />
            <XAxis 
              dataKey="hour" 
              fontSize={10} 
              axisLine={false} 
              tickLine={false} 
              stroke="#4A4B4F"
              interval={4}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1A1B1E', border: '1px solid #2A2B2F', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ color: '#8B5CF6' }}
              labelStyle={{ color: '#8E9299' }}
            />
            <Area 
              type="monotone" 
              dataKey="intensity" 
              stroke="#8B5CF6" 
              fillOpacity={1} 
              fill="url(#pulseColor)" 
              strokeWidth={3}
              animationDuration={2000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <p className="text-[10px] text-[#4A4B4F] mt-2 italic text-center">
        This pulse represents your overall audience engagement based on current training.
      </p>
    </div>
  );
};

export default ActivityPulse;
