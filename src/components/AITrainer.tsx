import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Brain, Sparkles, Send, Activity, Trash2, CheckCircle2 } from 'lucide-react';
import { geminiService } from '../lib/geminiService';
import { db, auth } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { AudienceActivity } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

interface AITrainerProps {
  onTrainingComplete: () => void;
}

const AITrainer: React.FC<AITrainerProps> = ({ onTrainingComplete }) => {
  const { t } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [description, setDescription] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrain = async () => {
    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if (!description.trim()) {
      setError(t('enterDescriptionError'));
      return;
    }

    if (!userToUse) {
      setError(t('signInToTrainError'));
      return;
    }

    setIsTraining(true);
    setError(null);
    setShowSuccess(false);

    if (isDemoMode) {
      // Simulate training success in demo mode
      setTimeout(() => {
        setDescription('');
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 5000);
        onTrainingComplete();
        setIsTraining(false);
      }, 1500);
      return;
    }

    try {
      const dataPoints = await geminiService.trainAIOnActivity(description);

      const batch = writeBatch(db);
      const activityRef = collection(db, 'audience_activity');

      dataPoints.forEach(point => {
        const newDocRef = doc(activityRef);
        batch.set(newDocRef, {
          ...point,
          userId: userToUse.uid,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      setDescription('');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
      onTrainingComplete();
    } catch (err) {
      console.error(err);
      setError(t('trainingFailedError'));
    } finally {
      setIsTraining(false);
    }
  };

  return (
    <div className="glass p-8 rounded-[2.5rem] shadow-sm relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-[0.04] pointer-events-none text-brand-700">
        <Brain size={120} />
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-brand-50 rounded-2xl text-brand-500">
          <Brain size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-brand-700 tracking-tight">{t('trainYourAi')}</h2>
          <p className="text-sm text-slate-500">{t('describeAudienceDesc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('trainerPlaceholder')}
            className="w-full h-32 bg-brand-50 border border-brand-100 rounded-2xl p-4 text-brand-700 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all resize-none placeholder:text-slate-400"
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleTrain}
              disabled={isTraining}
              className="px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-700/20"
            >
              {isTraining ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('learning')}
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  {t('trainAiBtn')}
                </>
              )}
            </motion.button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <Activity size={12} />
            {error}
          </p>
        )}

        {showSuccess && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-emerald-600 flex items-center gap-1"
          >
            <CheckCircle2 size={12} />
            {t('trainingSuccess')}
          </motion.p>
        )}

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="p-3 bg-brand-50 rounded-2xl border border-brand-100">
            <p className="text-[10px] uppercase tracking-wider text-brand-400 mb-1 font-bold">{t('howItWorks')}</p>
            <p className="text-xs text-slate-500">{t('geminiAnalysisDesc')}</p>
          </div>
          <div className="p-3 bg-brand-50 rounded-2xl border border-brand-100">
            <p className="text-[10px] uppercase tracking-wider text-brand-400 mb-1 font-bold">{t('tipTitle')}</p>
            <p className="text-xs text-slate-500">{t('tipDescription')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AITrainer;
