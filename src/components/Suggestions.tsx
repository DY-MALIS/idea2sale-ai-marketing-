import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, Check, Plus, Zap, AlertCircle } from 'lucide-react';
import { geminiService, PostingSuggestion, ActivityData } from '../lib/geminiService';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { useLanguage } from '../contexts/LanguageContext';

interface SuggestionsProps {
  activityVersion: number;
}

const Suggestions: React.FC<SuggestionsProps> = ({ activityVersion }) => {
  const { t, language } = useLanguage();
  const [suggestions, setSuggestions] = useState<PostingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingPost, setAddingPost] = useState<string | null>(null);

  const fetchSuggestions = async (uid: string) => {
    setLoading(true);
    try {
      const q = query(collection(db, 'audience_activity'), where('userId', '==', uid));
      const snapshot = await getDocs(q);
      const activityData = snapshot.docs.map(doc => doc.data() as ActivityData);

      if (activityData.length > 0) {
        const results = await geminiService.suggestBestPostingTimes(activityData, language);
        setSuggestions(results);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        fetchSuggestions(user.uid);
      }
    });
    return () => unsub();
  }, [activityVersion, language]);

  const handleApplySuggestion = async (suggestion: PostingSuggestion) => {
    if (!auth.currentUser) return;
    const suggestionId = `${suggestion.dayOfWeek}-${suggestion.hour}`;
    setAddingPost(suggestionId);
    
    try {
      // Find the next occurrence of this day and hour
      const now = new Date();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const targetDay = days.indexOf(suggestion.dayOfWeek);
      const currentDay = now.getDay();
      let daysToAdd = (targetDay - currentDay + 7) % 7;
      if (daysToAdd === 0 && now.getHours() >= suggestion.hour) daysToAdd = 7;
      
      const scheduledDate = new Date(now);
      scheduledDate.setDate(now.getDate() + daysToAdd);
      scheduledDate.setHours(suggestion.hour, 0, 0, 0);

      // Generate AI Content Draft
      const aiContentDraft = await geminiService.generateContentDraft("TIKTOK", suggestion.reason, language);

      await addDoc(collection(db, 'scheduled_posts'), {
        content: aiContentDraft,
        platform: "TIKTOK",
        scheduledTime: scheduledDate.toISOString(),
        status: "PENDING",
        userId: auth.currentUser.uid,
        aiSuggested: true,
        createdAt: serverTimestamp()
      });
      
      // Temporary success state would be nice, but for now just clear addingPost
    } catch (err) {
      console.error(err);
    } finally {
      setAddingPost(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          className="text-purple-500"
        >
          <Zap size={32} fill="currentColor" fillOpacity={0.2} />
        </motion.div>
        <p className="text-sm text-[#8E9299]">{t('calculatingSlots')}</p>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-12 px-6 border-2 border-dashed border-[#2A2B2F] rounded-xl bg-[#151619]/50">
        <AlertCircle size={32} className="mx-auto text-[#4A4B4F] mb-3" />
        <p className="text-sm text-[#8E9299]">{t('noAudienceData')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[#4A4B4F] mb-4 flex items-center gap-2">
        <Zap size={14} className="text-yellow-500" fill="currentColor" />
        {t('aiOptimalWindows')}
      </h3>
      <AnimatePresence>
        {suggestions.sort((a, b) => b.score - a.score).map((s, idx) => {
          const suggestionId = `${s.dayOfWeek}-${s.hour}`;
          const isProcessing = addingPost === suggestionId;
          
          return (
            <motion.div
              key={suggestionId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="group flex items-center justify-between p-4 bg-[#1A1B1E] border border-[#2A2B2F] rounded-lg hover:border-purple-500/50 transition-all cursor-default"
            >
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center justify-center w-12 h-12 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20">
                  <span className="text-[10px] uppercase font-bold leading-none">{s.dayOfWeek.slice(0, 3)}</span>
                  <span className="text-lg font-bold leading-none mt-1">{s.hour}:00</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white group-hover:text-purple-300 transition-colors">
                    {s.reason.split('.')[0]}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex h-1 w-24 bg-[#0A0A0B] rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${s.score * 100}%` }}
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500"
                      />
                    </div>
                    <span className="text-[10px] text-[#4A4B4F] font-mono">{t('confidence')}: {Math.round(s.score * 100)}%</span>
                  </div>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleApplySuggestion(s)}
                disabled={isProcessing}
                className="p-2 bg-[#2A2B2F] text-white rounded-full hover:bg-purple-600 transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus size={20} />
                )}
              </motion.button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default Suggestions;
