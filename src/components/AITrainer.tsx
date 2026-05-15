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
    <div className="bg-[#151619] border border-[#2A2B2F] rounded-xl p-6 shadow-2xl overflow-hidden relative">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
        <Brain size={120} />
      </div>
      
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
          <Brain size={24} />
        </div>
        <div>
          <h2 className="text-xl font-medium text-white tracking-tight">{t('trainYourAi')}</h2>
          <p className="text-sm text-[#8E9299]">{t('describeAudienceDesc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('trainerPlaceholder')}
            className="w-full h-32 bg-[#0A0A0B] border border-[#2A2B2F] rounded-lg p-4 text-white text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none transition-all resize-none placeholder:text-[#4A4B4F]"
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleTrain}
              disabled={isTraining}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
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
            className="text-xs text-green-500 flex items-center gap-1"
          >
            <CheckCircle2 size={12} />
            {t('trainingSuccess')}
          </motion.p>
        )}

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="p-3 bg-[#1A1B1E] rounded-lg border border-[#2A2B2F]">
            <p className="text-[10px] uppercase tracking-wider text-[#8E9299] mb-1 font-semibold">{t('howItWorks')}</p>
            <p className="text-xs text-[#BCBFC4]">{t('geminiAnalysisDesc')}</p>
          </div>
          <div className="p-3 bg-[#1A1B1E] rounded-lg border border-[#2A2B2F]">
            <p className="text-[10px] uppercase tracking-wider text-[#8E9299] mb-1 font-semibold">{t('tipTitle')}</p>
            <p className="text-xs text-[#BCBFC4]">{t('tipDescription')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AITrainer;
