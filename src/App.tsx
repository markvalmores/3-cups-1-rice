/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, Eye, Zap, Skull, Settings2, Volume2, VolumeX, Gamepad2, User, List, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { db } from './firebase';
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';

// Assets
const CHARACTER_URL = "https://en-portal.g.kuroco-img.app/v=1749211658/files/user/character/riceshower/riceshower_03.png";
const CUP_URL = "https://image2url.com/r2/default/images/1775182806778-8759d6b4-bd9b-4f16-8452-2a88232dbf92.png";
const BG_URL = "https://external-preview.redd.it/pov-you-are-taking-a-stroll-through-tracen-academy-v0-bGt1aDUyZjJ2MHBiMaRMbkSxRlEoPkqEkHUdwxn3xVHx7JrATurTT389ylVe.png?format=pjpg&auto=webp&s=b4a068732a2c9d2bdb92e6d3c09ed30ab987d7ef";
const MUSIC_URL = "https://image2url.com/r2/default/audio/1775184251043-4c9486d5-b5bb-4dd3-9828-0e7f141c15d0.mp3";

type Difficulty = 'easy' | 'normal' | 'hard' | 'insanity';

interface DifficultyConfig {
  shuffles: number;
  speed: number; // Duration of one swap in seconds
  label: string;
  icon: ReactNode;
  color: string;
}

const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    shuffles: 5,
    speed: 0.6,
    label: 'Easy',
    icon: <Eye className="w-4 h-4" />,
    color: 'bg-green-500',
  },
  normal: {
    shuffles: 8,
    speed: 0.45,
    label: 'Normal',
    icon: <Play className="w-4 h-4" />,
    color: 'bg-blue-500',
  },
  hard: {
    shuffles: 12,
    speed: 0.3,
    label: 'Hard',
    icon: <Zap className="w-4 h-4" />,
    color: 'bg-orange-500',
  },
  insanity: {
    shuffles: 20,
    speed: 0.18,
    label: 'Insanity',
    icon: <Skull className="w-4 h-4" />,
    color: 'bg-red-600',
  },
};

type GameState = 'title' | 'name_input' | 'idle' | 'showing' | 'shuffling' | 'guessing' | 'result';

interface LeaderboardEntry {
  id: string;
  playerName: string;
  score: number;
  difficulty: string;
  timestamp: Timestamp;
}

export default function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [gameState, setGameState] = useState<GameState>('title');
  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [guestId, setGuestId] = useState('');
  const [cupPositions, setCupPositions] = useState<number[]>([0, 1, 2]);
  const [targetCup, setTargetCup] = useState<number>(1); // Index of the cup containing the character
  const [selectedCup, setSelectedCup] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState("Find Rice Shower!");
  const [isRevealed, setIsRevealed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initialize Audio
    const audio = new Audio(MUSIC_URL);
    audio.loop = true;
    audioRef.current = audio;

    // Guest ID setup
    let id = localStorage.getItem('guestId');
    if (!id) {
      id = 'guest_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('guestId', id);
    }
    setGuestId(id);

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Fetch Leaderboard
  useEffect(() => {
    const q = query(
      collection(db, 'leaderboard'),
      orderBy('score', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: LeaderboardEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push({ id: doc.id, ...doc.data() } as LeaderboardEntry);
      });
      setLeaderboard(entries);
    }, (error) => {
      console.error("Leaderboard fetch error:", error);
    });

    return () => unsubscribe();
  }, []);

  const saveScore = async (finalScore: number) => {
    if (!playerName || finalScore <= 0) return;

    try {
      await addDoc(collection(db, 'leaderboard'), {
        playerName,
        score: finalScore,
        difficulty,
        timestamp: serverTimestamp(),
        guestId
      });
    } catch (error) {
      console.error("Error saving score:", error);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const startFromTitle = () => {
    setGameState('name_input');
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.log("Audio play blocked:", err));
    }
  };

  const handleNameSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (playerName.trim().length >= 1 && playerName.trim().length <= 20) {
      setGameState('idle');
    }
  };

  const shuffleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const config = DIFFICULTY_CONFIGS[difficulty];

  // Initialize game
  const startGame = useCallback(() => {
    setGameState('showing');
    setIsRevealed(true);
    setSelectedCup(null);
    setMessage("Watch closely...");
    
    // Randomize initial target cup
    const initialTarget = Math.floor(Math.random() * 3);
    setTargetCup(initialTarget);

    // After 1.5s, hide and start shuffling
    setTimeout(() => {
      setIsRevealed(false);
      setGameState('shuffling');
      performShuffles();
    }, 1500);
  }, [difficulty]);

  const performShuffles = useCallback(async () => {
    let currentPositions = [0, 1, 2];
    const totalShuffles = config.shuffles;
    
    for (let i = 0; i < totalShuffles; i++) {
      await new Promise((resolve) => {
        // Pick two random indices to swap
        const idx1 = Math.floor(Math.random() * 3);
        let idx2 = Math.floor(Math.random() * 3);
        while (idx1 === idx2) {
          idx2 = Math.floor(Math.random() * 3);
        }

        const nextPositions = [...currentPositions];
        [nextPositions[idx1], nextPositions[idx2]] = [nextPositions[idx2], nextPositions[idx1]];
        
        setCupPositions(nextPositions);
        currentPositions = nextPositions;
        
        setTimeout(resolve, config.speed * 1000);
      });
    }

    setGameState('guessing');
    setMessage("Where is she?");
  }, [config]);

  const handleCupClick = (index: number) => {
    if (gameState !== 'guessing') return;

    setSelectedCup(index);
    setGameState('result');
    setIsRevealed(true);

    if (index === targetCup) {
      setMessage("You found her! Amazing!");
      const newScore = score + 1;
      setScore(newScore);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ff0000', '#ffffff', '#ff69b4']
      });
    } else {
      setMessage("Oh no! Better luck next time.");
      if (score > 0) {
        saveScore(score);
      }
      setScore(0);
    }
  };

  const resetGame = () => {
    setGameState('idle');
    setIsRevealed(false);
    setSelectedCup(null);
    setMessage("Find Rice Shower!");
    setCupPositions([0, 1, 2]);
  };

  return (
    <div 
      className="min-h-screen w-full bg-cover bg-center flex flex-col items-center font-sans overflow-hidden relative p-2 md:p-4"
      style={{ backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5)), url(${BG_URL})` }}
    >
      {/* Overlay for depth */}
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />

      {/* Main Content Container */}
      <div className="flex-1 w-full max-w-6xl flex flex-col items-center justify-between py-2 md:py-4 z-10">
        
        {/* Header UI */}
        <motion.div 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center relative w-full"
        >
          {/* Top Buttons */}
          <div className="absolute right-0 top-0 flex gap-2 z-30">
            <button 
              onClick={() => setShowLeaderboard(true)}
              className="p-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white hover:bg-white/20 transition-all"
              title="Leaderboard"
            >
              <List className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleMute}
              className="p-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white hover:bg-white/20 transition-all"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>

          <div className="absolute left-0 top-0 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 px-3 py-1.5 rounded-full text-white text-xs font-bold z-30">
            <User className="w-4 h-4 text-pink-400" />
            <span className="max-w-[80px] truncate">{playerName}</span>
          </div>

          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] tracking-tighter mb-1 md:mb-2 uppercase">
            3 CUPS <span className="text-pink-400">1 RICE</span>
          </h1>
          <div className="flex items-center justify-center gap-2 md:gap-4">
            <div className="bg-white/10 backdrop-blur-md border border-white/20 px-3 md:px-4 py-0.5 md:py-1 rounded-full text-white text-xs md:text-sm font-bold flex items-center gap-1 md:gap-2">
              <Trophy className="w-3 h-3 md:w-4 md:h-4 text-yellow-400" />
              Score: {score}
            </div>
            <div className={`px-3 md:px-4 py-0.5 md:py-1 rounded-full text-white text-xs md:text-sm font-bold flex items-center gap-1 md:gap-2 shadow-lg ${config.color}`}>
              {config.icon}
              {config.label}
            </div>
          </div>
        </motion.div>

        {/* Game Board Area */}
        <div className="relative w-full flex-1 flex items-center justify-center min-h-[250px] md:min-h-[350px] perspective-1000 landscape:min-h-[200px]">
          {/* Table Surface */}
          <div className="absolute bottom-1/4 w-[140%] md:w-[120%] h-24 md:h-32 bg-gradient-to-t from-stone-900 to-stone-800 rounded-[100%] transform -rotate-x-60 translate-z-[-100px] shadow-2xl border-t border-white/10" />

          {/* Cups and Character */}
          <div className="relative flex gap-4 sm:gap-8 md:gap-24 items-end pb-8 md:pb-12 z-10">
            {cupPositions.map((originalIndex) => {
              const isTarget = originalIndex === targetCup;
              const isSelected = selectedCup === originalIndex;
              
              return (
                <motion.div
                  key={originalIndex}
                  layout
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 35,
                    mass: 1,
                  }}
                  className="relative w-20 sm:w-24 md:w-32 h-28 sm:h-36 md:h-48 cursor-pointer group touch-manipulation"
                  onClick={() => handleCupClick(originalIndex)}
                >
                  {/* Character (Rice Shower) */}
                  <AnimatePresence>
                    {isTarget && isRevealed && (
                      <motion.div
                        initial={{ y: 40, opacity: 0, scale: 0.5 }}
                        animate={{ y: -20, opacity: 1, scale: 1 }}
                        exit={{ y: 40, opacity: 0, scale: 0.5 }}
                        className="absolute inset-0 flex items-center justify-center z-0"
                      >
                        <img 
                          src={CHARACTER_URL} 
                          alt="Rice Shower" 
                          className="w-12 sm:w-16 md:w-24 h-auto drop-shadow-[0_0_15px_rgba(255,105,180,0.8)]"
                          referrerPolicy="no-referrer"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Cup */}
                  <motion.div
                    animate={{
                      y: isRevealed && (isTarget || isSelected) ? -80 : (gameState === 'shuffling' ? [0, -20, 0] : 0),
                      rotateX: isRevealed && (isTarget || isSelected) ? -20 : 0,
                      scale: gameState === 'guessing' ? 1.05 : 1,
                    }}
                    transition={gameState === 'shuffling' ? {
                      duration: config.speed,
                      ease: "easeInOut"
                    } : {}}
                    whileHover={gameState === 'guessing' ? { scale: 1.1, y: -10 } : {}}
                    className="relative w-full h-full z-10"
                  >
                    {/* Cup Shadow */}
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-16 sm:w-20 md:w-24 h-3 sm:h-4 md:h-6 bg-black/40 blur-xl rounded-full" />
                    
                    {/* The Cup Image */}
                    <div 
                      className="w-full h-full bg-contain bg-no-repeat bg-center"
                      style={{ 
                        backgroundImage: `url(${CUP_URL})`,
                      }}
                    />
                  </motion.div>

                  {/* Selection Indicator */}
                  {isSelected && gameState === 'result' && (
                    <motion.div 
                      initial={{ scale: 0, y: 0 }}
                      animate={{ scale: 1, y: -140 }}
                      className={`absolute top-0 left-1/2 -translate-x-1/2 font-bold px-3 md:px-4 py-1 md:py-2 rounded-xl text-white text-[10px] sm:text-xs md:text-base whitespace-nowrap shadow-2xl z-30 ${isTarget ? 'bg-green-500 ring-4 ring-green-400/50' : 'bg-red-500 ring-4 ring-red-400/50'}`}
                    >
                      {isTarget ? '✨ EXCELLENT! ✨' : '❌ WRONG CUP ❌'}
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Footer Area (Controls + Message) */}
        <div className="w-full flex flex-col items-center gap-3 md:gap-6 landscape:flex-row landscape:justify-center landscape:gap-8">
          {/* Controls UI */}
          <div className="flex flex-col items-center gap-2 md:gap-4">
            {gameState === 'idle' || gameState === 'result' ? (
              <div className="flex flex-col items-center gap-2 md:gap-4">
                {gameState === 'idle' && (
                  <div className="flex flex-wrap justify-center bg-black/50 backdrop-blur-xl p-1 rounded-2xl border border-white/10 shadow-2xl">
                    {(Object.keys(DIFFICULTY_CONFIGS) as Difficulty[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={`px-3 md:px-6 py-1.5 md:py-2 rounded-xl font-bold transition-all flex items-center gap-1 md:gap-2 text-xs md:text-base ${
                          difficulty === d 
                            ? `${DIFFICULTY_CONFIGS[d].color} text-white shadow-lg scale-105` 
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {DIFFICULTY_CONFIGS[d].icon}
                        {DIFFICULTY_CONFIGS[d].label}
                      </button>
                    ))}
                  </div>
                )}
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={gameState === 'result' ? resetGame : startGame}
                  className="group relative px-6 md:px-12 py-2 md:py-4 bg-white text-black font-black text-base md:text-xl rounded-2xl shadow-[0_4px_0_rgb(200,200,200)] md:shadow-[0_6px_0_rgb(200,200,200)] hover:shadow-[0_2px_0_rgb(200,200,200)] md:hover:shadow-[0_3px_0_rgb(200,200,200)] hover:translate-y-1 active:shadow-none active:translate-y-2 transition-all flex items-center gap-2 md:gap-3 touch-manipulation"
                >
                  {gameState === 'result' ? (
                    <>
                      <RotateCcw className="w-4 h-4 md:w-6 md:h-6 group-hover:rotate-180 transition-transform duration-500" />
                      PLAY AGAIN
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 md:w-6 md:h-6 fill-current" />
                      START GAME
                    </>
                  )}
                </motion.button>
              </div>
            ) : null}
          </div>

          {/* Message UI */}
          <motion.div 
            key={message}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xs md:max-w-lg"
          >
            <p className="text-base md:text-3xl font-bold text-white text-center drop-shadow-lg bg-black/40 backdrop-blur-md px-4 md:px-6 py-2 md:py-3 rounded-2xl border border-white/10">
              {message}
            </p>
          </motion.div>
        </div>
      </div>

      {/* Instructions Overlay */}
      {gameState === 'idle' && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute bottom-2 md:bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-[10px] md:text-xs flex items-center gap-2 bg-black/20 px-4 py-1 rounded-full backdrop-blur-sm whitespace-nowrap"
        >
          <Settings2 className="w-3 h-3" />
          Choose difficulty and find where Rice Shower is hidden!
        </motion.div>
      )}

      {/* Title Screen Overlay */}
      <AnimatePresence>
        {gameState === 'title' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center text-white p-6 text-center"
          >
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mb-8 relative"
            >
              <div className="absolute -inset-4 bg-pink-500/20 blur-3xl rounded-full animate-pulse" />
              <img 
                src={CHARACTER_URL} 
                alt="Rice Shower" 
                className="w-32 md:w-48 h-auto drop-shadow-[0_0_20px_rgba(255,105,180,0.6)] relative z-10"
                referrerPolicy="no-referrer"
              />
            </motion.div>

            <motion.h1 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-5xl md:text-7xl font-black mb-2 tracking-tighter drop-shadow-2xl"
            >
              3 CUPS <span className="text-pink-400">1 RICE</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-lg md:text-xl text-white/60 mb-12 font-medium"
            >
              Can you find Rice Shower?
            </motion.p>

            <motion.button
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.8 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startFromTitle}
              className="group relative px-12 py-4 bg-pink-500 text-white font-black text-2xl rounded-2xl shadow-[0_6px_0_rgb(190,24,93)] hover:shadow-[0_3px_0_rgb(190,24,93)] hover:translate-y-1 active:shadow-none active:translate-y-2 transition-all flex items-center gap-3"
            >
              <Gamepad2 className="w-8 h-8" />
              START GAME
            </motion.button>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-12 text-white/40 text-sm flex items-center gap-2"
            >
              <Volume2 className="w-4 h-4" />
              Music will play on start
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Name Input Screen */}
      <AnimatePresence>
        {gameState === 'name_input' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center text-white p-6 text-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl shadow-2xl"
            >
              <div className="mb-6 bg-pink-500/20 w-20 h-20 rounded-full flex items-center justify-center mx-auto border border-pink-500/30">
                <User className="w-10 h-10 text-pink-400" />
              </div>
              <h2 className="text-3xl font-black mb-2">WHO ARE YOU?</h2>
              <p className="text-white/60 mb-8">Enter your name for the leaderboard</p>
              
              <form onSubmit={handleNameSubmit} className="space-y-6">
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Your Name"
                  maxLength={20}
                  required
                  autoFocus
                  className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-xl font-bold text-center focus:outline-none focus:ring-4 focus:ring-pink-500/50 transition-all placeholder:text-white/20"
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={playerName.trim().length < 1}
                  className="w-full py-4 bg-pink-500 text-white font-black text-xl rounded-2xl shadow-[0_6px_0_rgb(190,24,93)] hover:shadow-[0_3px_0_rgb(190,24,93)] hover:translate-y-1 active:shadow-none active:translate-y-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  CONTINUE
                </motion.button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Leaderboard Overlay */}
      <AnimatePresence>
        {showLeaderboard && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-8"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-2xl bg-stone-900 border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-pink-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="bg-yellow-400/20 p-3 rounded-2xl">
                    <Trophy className="w-8 h-8 text-yellow-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">LEADERBOARD</h2>
                    <p className="text-white/40 text-sm font-medium">Top 10 Global Players</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowLeaderboard(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-8 h-8" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-3">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-20 text-white/20 italic">
                    No scores yet. Be the first!
                  </div>
                ) : (
                  leaderboard.map((entry, idx) => {
                    const isTop1 = idx === 0;
                    const isTop2 = idx === 1;
                    const isTop3 = idx === 2;
                    const isCurrentUser = (entry as any).guestId === guestId;

                    return (
                      <motion.div 
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: idx * 0.05 }}
                        key={entry.id}
                        className={`flex items-center justify-between p-4 rounded-2xl border relative overflow-hidden ${
                          isTop1 ? 'bg-yellow-400/10 border-yellow-400/30' : 
                          isTop2 ? 'bg-gray-300/10 border-gray-300/30' : 
                          isTop3 ? 'bg-orange-400/10 border-orange-400/30' : 
                          isCurrentUser ? 'bg-pink-500/10 border-pink-500/30' : 
                          'bg-white/5 border-white/5'
                        }`}
                      >
                        {/* Shine effect for Top 1 */}
                        {isTop1 && (
                          <motion.div 
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/10 to-transparent skew-x-12"
                          />
                        )}

                        <div className="flex items-center gap-4 relative z-10">
                          <span className={`w-8 text-center font-black text-xl ${
                            isTop1 ? 'text-yellow-400' : 
                            isTop2 ? 'text-gray-300' : 
                            isTop3 ? 'text-orange-400' : 
                            'text-white/20'
                          }`}>
                            #{idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-white text-lg leading-none">{entry.playerName}</p>
                              {isCurrentUser && (
                                <span className="bg-pink-500 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase">YOU</span>
                              )}
                            </div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-white/30 mt-1">{entry.difficulty}</p>
                          </div>
                        </div>
                        <div className="text-right relative z-10">
                          <p className={`text-2xl font-black leading-none ${
                            isTop1 ? 'text-yellow-400' : 
                            isTop2 ? 'text-gray-300' : 
                            isTop3 ? 'text-orange-400' : 
                            'text-pink-400'
                          }`}>{entry.score}</p>
                          <p className="text-[10px] text-white/20 font-medium">STREAK</p>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

              <div className="p-6 bg-black/40 border-t border-white/5 text-center">
                <p className="text-white/30 text-xs font-medium">Scores are saved automatically when your streak ends</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <style dangerouslySetInnerHTML={{ __html: `
        .perspective-1000 {
          perspective: 1000px;
        }
        .rotate-x-60 {
          transform: rotateX(60deg);
        }
        .translate-z-[-100px] {
          transform: translateZ(-100px);
        }
      `}} />
    </div>
  );
}
