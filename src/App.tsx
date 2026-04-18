/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RefreshCw, ChevronLeft, ChevronRight, Gauge, Pause, X } from 'lucide-react';

const SCREEN_WIDTH = 200; // Smaller canvas for retro feel
const SCREEN_HEIGHT = 400;
const CELL_SIZE = 10;
const LANE_WIDTH = 40; // 4 cells wide
const ROAD_X_OFFSET = 40; 

// Retro Palette
const COLORS = {
  bg: '#8e9a78',      // Olive green
  trackBg: '#8e9a78', // Same as bg
  laneLine: '#1a1a1a',// Black
  player: '#1a1a20',  // Darkest gray
  enemy: '#2a2a30',   // Dark gray
  accent: '#1a1a1a', 
  text: '#1a1a1a',
};

type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAMEOVER';

interface LogEntry {
  time: string;
  message: string;
}

interface Enemy {
  lane: number;
  y: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: '0.00', message: 'GFX_INIT SUCCESS' },
    { time: '0.12', message: 'C3D_INIT COMPLETE' },
  ]);
  const [velocity, setVelocity] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('citro_rush_highscore');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [isShaking, setIsShaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playBeep = (freq: number, duration: number, type: OscillatorType = 'square') => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.error('Audio failed', e);
    }
  };

  const addLog = useCallback((message: string) => {
    const time = ((performance.now() % 10000) / 100).toFixed(2);
    setLogs(prev => [{ time, message }, ...prev].slice(0, 15));
  }, []);

  // Game Logic Refs (to avoid re-renders during loop)
  const gameRef = useRef({
    playerLane: 1,
    playerY: 28,
    enemies: [] as Enemy[],
    score: 0,
    speed: 0.18, // Base speed (per frame)
    lastTime: 0,
    frameCount: 0,
    roadOffset: 0,
    distanceSinceSpawn: 0,
    nextSpawnGap: 8,
    keys: {} as Record<string, boolean>,
  });

  const startGame = useCallback(() => {
    gameRef.current = {
      playerLane: 1,
      playerY: 28,
      enemies: [
        { lane: Math.floor(Math.random() * 3), y: -4 },
      ],
      score: 0,
      speed: 0.18,
      lastTime: performance.now(),
      frameCount: 0,
      roadOffset: 0,
      distanceSinceSpawn: 0,
      nextSpawnGap: 8,
      keys: gameRef.current.keys, // Keep the same keys object
    };
    setScore(0);
    setGameState('PLAYING');
    addLog('SESSION_START...');
    addLog('NEURAL_SPAWN_PROCEDURE: ACTIVE');
  }, [addLog]);

  const handleGameOver = useCallback(() => {
    setGameState('GAMEOVER');
    setIsShaking(true);
    playBeep(120, 0.4, 'sawtooth'); // Deep wreck sound
    setTimeout(() => setIsShaking(false), 400);
    addLog('COLLISION_DETECTED: GAME_OVER');
  }, [addLog]);

  const togglePause = useCallback(() => {
    setGameState(prev => {
      if (prev === 'PLAYING') {
        addLog('SESSION_PAUSED');
        return 'PAUSED';
      }
      if (prev === 'PAUSED') {
        addLog('SESSION_RESUMED');
        // Reset lastTime to avoid huge jumps
        gameRef.current.lastTime = performance.now();
        return 'PLAYING';
      }
      return prev;
    });
  }, [addLog]);

  // Update Game Logic
  const update = useCallback((time: number) => {
    if (gameState !== 'PLAYING') return;

    const game = gameRef.current;

    // Calculate delta time
    if (!game.lastTime) game.lastTime = time;
    const dt = (time - game.lastTime) / 16.67; // Normalize to ~60fps
    game.lastTime = time;

    // Throttle UI updates
    game.frameCount++;
    if (game.frameCount % 10 === 0) {
      // Velocity as Blocks Per Second (BPS)
      // game.speed is cells per frame. speed * 60 = cells per second.
      const bps = Math.floor(game.speed * 60);
      setVelocity(bps);
    }
    
    // Handle Spawning
    game.distanceSinceSpawn += game.speed * dt;
    if (game.distanceSinceSpawn >= game.nextSpawnGap) {
      game.distanceSinceSpawn = 0;
      game.nextSpawnGap = 8 + Math.random() * 10; // Randomizing the gap (8 to 18 units)

      // Lane Blocking: Occasionally spawn 2 enemies
      const lanes = [0, 1, 2];
      const spawnCount = Math.random() > 0.8 ? 2 : 1; 
      
      // Shuffle lanes
      for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      }

      for (let i = 0; i < spawnCount; i++) {
        game.enemies.push({ lane: lanes[i], y: -5 });
      }
    }

    // Move and Remove enemies
    game.roadOffset = (game.roadOffset + game.speed * dt * CELL_SIZE) % (CELL_SIZE * 6);

    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const enemy = game.enemies[i];
      enemy.y += game.speed * dt;

      // Score and Remove enemy if it goes fully off screen
      if (enemy.y > 42) {
        game.enemies.splice(i, 1);
        
        game.score += 10;
        setScore(game.score);
        playBeep(880, 0.05); // Short sharp pass beep
        
        // Speed scaling every 50 points
        if (game.score > 0 && game.score % 50 === 0) {
          game.speed = Math.min(0.8, game.speed + 0.04);
          playBeep(1200, 0.15, 'square'); // Level up beep
          addLog(`SPEED_CALIBRATION: LEVEL UP (${Math.floor(game.speed * 60)} BpS)`);
        }
      }

      // Collision Check (Updated for vertical player movement)
      const dy = Math.abs(enemy.y - game.playerY);
      if (enemy.lane === game.playerLane && dy < 3.2) {
        handleGameOver();
      }
    }
  }, [gameState, handleGameOver, addLog]);

  // Draw Function
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const game = gameRef.current;
    
    // Clear Screen
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // Draw Grid (Authentic coarse grid)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= SCREEN_WIDTH; x += CELL_SIZE) {
      ctx.moveTo(x, 0); ctx.lineTo(x, SCREEN_HEIGHT);
    }
    for (let y = 0; y <= SCREEN_HEIGHT; y += CELL_SIZE) {
      ctx.moveTo(0, y); ctx.lineTo(SCREEN_WIDTH, y);
    }
    ctx.stroke();

    // Road Outer Box
    ctx.strokeStyle = COLORS.laneLine;
    ctx.lineWidth = 2;
    ctx.strokeRect(ROAD_X_OFFSET, 0, LANE_WIDTH * 3, SCREEN_HEIGHT);

    // Draw Authentically Styled Side Indicators (from image)
    ctx.fillStyle = COLORS.laneLine;
    const marginLeft = ROAD_X_OFFSET - 14; 
    const marginRight = ROAD_X_OFFSET + (LANE_WIDTH * 3) + 4;

    for (let y = -CELL_SIZE * 4; y < SCREEN_HEIGHT + CELL_SIZE * 4; y += CELL_SIZE * 6) {
      const drawY = y + game.roadOffset;
      // Boxes on the edges
      ctx.strokeRect(marginLeft, drawY, 10, 10);
      ctx.fillRect(marginLeft + 3, drawY + 3, 4, 4);
      
      ctx.strokeRect(marginRight, drawY, 10, 10);
      ctx.fillRect(marginRight + 3, drawY + 3, 4, 4);
    }

    const drawCar = (lane: number, y: number, color: string) => {
      const xOff = ROAD_X_OFFSET + lane * LANE_WIDTH + 5; 
      ctx.fillStyle = color;
      ctx.shadowBlur = 0; // No glows in retro mode
      
      // Retro Car Body
      // Row 0 (Top)
      ctx.fillRect(xOff + CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeRect(xOff + CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      // Row 1
      ctx.fillRect(xOff, (y + 1) * CELL_SIZE, CELL_SIZE * 3, CELL_SIZE);
      ctx.strokeRect(xOff, (y + 1) * CELL_SIZE, CELL_SIZE * 3, CELL_SIZE);
      // Row 2
      ctx.fillRect(xOff + CELL_SIZE, (y + 2) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeRect(xOff + CELL_SIZE, (y + 2) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      // Row 3 (Wheels/Tail)
      ctx.fillRect(xOff, (y + 3) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeRect(xOff, (y + 3) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.fillRect(xOff + CELL_SIZE * 2, (y + 3) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeRect(xOff + CELL_SIZE * 2, (y + 3) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      
      // Center dot for detail
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(xOff + CELL_SIZE + 3, (y+1) * CELL_SIZE + 3, 4, 4);
    };

    if (gameState === 'PLAYING') {
      game.enemies.forEach(enemy => {
        drawCar(enemy.lane, enemy.y, COLORS.enemy);
      });
      drawCar(game.playerLane, game.playerY, COLORS.player);
    }
  }, [gameState]);

  // Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;
    const loop = (time: number) => {
      update(time);
      draw(ctx);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [update, draw]);

  // Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'PLAYING') {
        const game = gameRef.current;
        if ((e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && game.playerLane > 0) {
          game.playerLane--;
        }
        if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && game.playerLane < 2) {
          game.playerLane++;
        }
        if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && game.playerY > 2) {
          game.playerY--;
        }
        if ((e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') && game.playerY < 32) {
          game.playerY++;
        }
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
          togglePause();
        }
      } else if (gameState === 'PAUSED' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) {
        togglePause();
      } else if (gameState === 'GAMEOVER' && (e.key === 'Enter' || e.key === ' ')) {
        startGame();
      } else if (gameState === 'START' && (e.key === 'Enter' || e.key === ' ')) {
        startGame();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, startGame, togglePause]);

  // High Score Persistence
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('citro_rush_highscore', score.toString());
    }
  }, [score, highScore]);

  const handleTrackpad = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gameState !== 'PLAYING') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    
    // Direct mapping to lane (0, 1, 2)
    const newLane = Math.max(0, Math.min(2, Math.floor(rx * 3)));
    
    // Direct mapping to vertical Y (Range 2 to 32)
    const newY = Math.max(2, Math.min(32, Math.floor(ry * 30) + 2));
    
    gameRef.current.playerLane = newLane;
    gameRef.current.playerY = newY;
  };

  const statLabelClass = "text-[12px] uppercase tracking-[1px] font-mono text-black/60 mb-1";
  const statValueClass = "text-xl sm:text-2xl font-mono font-bold text-black tabular-nums";

  return (
    <div className="bg-[#8e9a78] min-h-screen h-screen w-screen flex flex-col items-center justify-start p-3 sm:p-6 font-mono text-[#1a1a1a] select-none overflow-hidden touch-none no-scrollbar">
      {/* Top Header Section */}
      <header className="w-full max-w-[400px] flex justify-between items-start mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter uppercase">Race</h1>
        </div>
        <div className="text-right space-y-1">
          <div>
            <div className={statLabelClass}>Score</div>
            <div className={statValueClass}>{score.toString().padStart(6, '0')}</div>
          </div>
          <div>
            <div className={statLabelClass}>High Score</div>
            <div className={statValueClass}>{highScore.toString().padStart(6, '0')}</div>
          </div>
        </div>
      </header>

      {/* Main Gameplay Screen Area */}
      <motion.div 
        animate={isShaking ? {
          x: [-4, 4, -4, 4, 0],
          y: [-2, 2, -2, 2, 0],
          rotate: [-1, 1, -1, 1, 0]
        } : {}}
        transition={{ duration: 0.1, repeat: 3 }}
        className="flex-1 w-full max-w-[400px] flex flex-col items-center justify-center relative min-h-0"
      >
        <div className="relative border-[4px] border-black p-0.5 bg-black/5 shadow-[4px_4px_0_0_rgba(0,0,0,0.1)]">
          <canvas
            ref={canvasRef}
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            className="image-pixelated bg-[#8e9a78] block max-h-[60vh] sm:max-h-none w-auto h-auto"
          />

          {/* Pause Button */}
          <div className="absolute top-2 right-2 z-40">
            {gameState === 'PLAYING' && (
              <button 
                onClick={togglePause}
                className="p-1 border-2 border-black rounded bg-[#8e9a78]/50 text-black active:bg-black active:text-white transition-colors"
                title="Pause (ESC)"
              >
                <Pause size={16} />
              </button>
            )}
            {gameState === 'PAUSED' && (
              <button 
                onClick={togglePause}
                className="p-1 border-2 border-black rounded bg-white text-black"
                title="Resume (ESC)"
              >
                <Play size={16} fill="black" />
              </button>
            )}
          </div>

          {/* UI Overlays */}
          <AnimatePresence>
            {gameState === 'START' && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-[#8e9a78]/95 flex flex-col items-center justify-center text-center px-4 z-30"
              >
                <h2 className="text-2xl font-bold mb-6 uppercase tracking-tighter">Initialize</h2>
                <button
                  onClick={startGame}
                  className="bg-black text-[#8e9a78] py-4 px-10 font-bold uppercase text-sm border-2 border-black hover:bg-transparent hover:text-black transition-all rounded shadow-[4px_4px_0_0_#000]"
                >
                  Start Track
                </button>
              </motion.div>
            )}

            {gameState === 'PAUSED' && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-[#8e9a78]/80 backdrop-blur-[1px] flex flex-col items-center justify-center text-center p-4 z-30"
              >
                <div className="border-[3px] border-black p-8 bg-[#8e9a78] shadow-[6px_6px_0_0_#000]">
                  <h2 className="text-3xl font-black mb-8 uppercase tracking-widest">Paused</h2>
                  <button
                    onClick={togglePause}
                    className="w-full bg-black text-[#8e9a78] py-4 px-10 font-bold uppercase text-sm transition-all rounded"
                  >
                    Resume
                  </button>
                </div>
              </motion.div>
            )}

            {gameState === 'GAMEOVER' && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-center p-4 z-30"
              >
                <div className="bg-[#8e9a78] p-8 border-[4px] border-black shadow-[10px_10px_0_0_#1a1a1a] w-full max-w-[240px]">
                  <h2 className="text-3xl font-black mb-4 uppercase text-black italic">Wrecked</h2>
                  <div className="mb-8 border-y-2 border-black/10 py-4">
                    <p className={statLabelClass}>Final Score</p>
                    <p className="text-3xl font-bold tabular-nums text-black">{score.toLocaleString().padStart(6, '0')}</p>
                  </div>
                  <button
                    onClick={startGame}
                    className="w-full bg-black text-white py-4 px-6 font-bold uppercase text-sm rounded transition-transform active:scale-95"
                  >
                    Reboot
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Control Area (D-Pad + Info) */}
      <footer className="w-full max-w-[400px] flex items-center justify-center pt-4 pb-6 gap-6 relative border-t-2 border-black/10 mt-2">
        <div className="flex items-center gap-4 sm:gap-8">
          {/* D-Pad */}
          <div className="relative w-24 h-24 flex-shrink-0 touch-manipulation">
            <button 
              className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 border-[2px] border-black bg-black/5 rounded-md flex items-center justify-center active:bg-black active:text-white transition-colors"
              onPointerDown={() => { if (gameRef.current.playerY > 2) gameRef.current.playerY--; }}
            >
              <ChevronLeft className="rotate-90" size={16} />
            </button>
            <button 
              className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 border-[2px] border-black bg-black/5 rounded-md flex items-center justify-center active:bg-black active:text-white transition-colors"
              onPointerDown={() => { if (gameRef.current.playerLane > 0) gameRef.current.playerLane--; }}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-black/30 flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-black/40" />
            </div>
            <button 
              className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 border-[2px] border-black bg-black/5 rounded-md flex items-center justify-center active:bg-black active:text-white transition-colors"
              onPointerDown={() => { if (gameRef.current.playerLane < 2) gameRef.current.playerLane++; }}
            >
              <ChevronRight size={16} />
            </button>
            <button 
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-8 border-[2px] border-black bg-black/5 rounded-md flex items-center justify-center active:bg-black active:text-white transition-colors"
              onPointerDown={() => { if (gameRef.current.playerY < 32) gameRef.current.playerY++; }}
            >
              <ChevronRight className="rotate-90" size={16} />
            </button>
          </div>

          {/* Trackpad (Balanced Size) */}
          <div 
            className="w-32 sm:w-36 h-28 border-[2px] border-black bg-black/5 rounded-xl relative touch-none overflow-hidden select-none cursor-crosshair shadow-[inset_0_2px_10px_rgba(0,0,0,0.05)]"
            onPointerDown={handleTrackpad}
            onPointerMove={(e) => { if (e.buttons > 0) handleTrackpad(e); }}
          >
            {/* Visual Grid for Trackpad */}
            <div className="absolute inset-0 flex">
              <div className="flex-1 border-r border-black/10" />
              <div className="flex-1 border-r border-black/10" />
              <div className="flex-1" />
            </div>
            {/* Subtle Texture */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:6px_6px]" />
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] font-black text-black/20 tracking-[2px] uppercase whitespace-nowrap">
              Trackpad
            </div>
          </div>
        </div>

        <div className="absolute right-0 flex flex-col items-end gap-1 px-1 opacity-40 sm:opacity-100 pb-2">
          <div className="flex flex-col gap-0.5 text-[8px] font-bold text-black/60 text-right uppercase">
            <p className="whitespace-nowrap">Vel: {velocity}</p>
            <div className="flex gap-0.5 justify-end">
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < (velocity / 5) ? 'bg-black' : 'border border-black/20'}`} />
              ))}
            </div>
          </div>
          <p className="text-[6px] font-black tracking-widest text-black/20 uppercase mt-2 hidden sm:block">© 198X AIS</p>
        </div>
      </footer>

      <style>{`
        .image-pixelated {
          image-rendering: pixelated;
          image-rendering: -moz-crisp-edges;
          image-rendering: crisp-edges;
        }
        body {
          overscroll-behavior: none;
          touch-action: manipulation;
          background: #8e9a78;
        }
        .touch-manipulation {
          touch-action: manipulation;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
