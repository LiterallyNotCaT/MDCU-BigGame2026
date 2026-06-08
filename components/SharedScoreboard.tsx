'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Medal, Crown, RefreshCw, Clock } from 'lucide-react';
import { withCompetitionRanks } from '@/lib/ranking';

// --- 1. PROPS DEFINITION: The customizable settings for this component ---
type SharedScoreboardProps = {
  title: string;
  subtitle: string;
  bgColor: string;
  csvUrlLower?: string;
  csvUrlUpper?: string;
  csvUrlTotal?: string;
  showDetails?: boolean;
  showNumbers?: boolean;
  mode?: 'fullscreen' | 'embedded';
};

// Internal Helper Component for the running numbers
const AnimatedNumber = ({ value }: { value: number }) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (displayValue === value) return;
    const distance = Math.abs(value - displayValue);
    const step = Math.ceil(distance / 20) || 1; 
    
    const interval = setInterval(() => {
      setDisplayValue((prev) => {
        if (prev < value) return Math.min(prev + step, value);
        if (prev > value) return Math.max(prev - step, value);
        return value;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [value, displayValue]);

  return <span className="tabular-nums">{displayValue.toLocaleString()}</span>;
};

type House = {
  id: string;
  name: string;
  scoreLower: number;
  scoreUpper: number;
  totalScore: number;
};

const parseCSVLine = (line: string) => {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cols.push(current);
  return cols;
};

const parseCSVData = (csvText: string) => {
  const scores: Record<string, number> = {};
  const lines = csvText.trim().split('\n');
  
  lines.forEach((line, index) => {
    const cols = parseCSVLine(line);
    if (cols.length === 1) {
      const score = parseInt(cols[0].replace(/,/g, '').trim(), 10);
      if (!isNaN(score)) scores[String(index + 1)] = score;
    } else if (cols.length >= 2) {
      const houseIdStr = cols[0].trim();
      const scoreStr = cols[1].replace(/,/g, '').trim();
      const houseNumMatch = houseIdStr.match(/\d+/);
      if (houseNumMatch) {
        const houseId = houseNumMatch[0];
        const score = parseInt(scoreStr, 10);
        if (!isNaN(score)) {
          scores[houseId] = score;
        }
      }
    }
  });
  return scores;
};

const freshUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

// --- 2. THE MAIN COMPONENT ---
export default function SharedScoreboard({ 
  title, 
  subtitle, 
  bgColor, 
  csvUrlLower, 
  csvUrlUpper,
  csvUrlTotal,
  showDetails = true,
  showNumbers = true,
  mode = 'fullscreen',
}: SharedScoreboardProps) {

  const initialHouses: House[] = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    name: `บ้าน ${i + 1}`,
    scoreLower: 0,
    scoreUpper: 0,
    totalScore: 0,
  }));

  const [houses, setHouses] = useState<House[]>(initialHouses);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // FETCH DATA: Uses props instead of hardcoded links.
  const fetchData = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      if (csvUrlTotal) {
        const resTotal = await fetch(freshUrl(csvUrlTotal), { cache: 'no-store' });
        const dataTotal = parseCSVData(await resTotal.text());
        setHouses(prevHouses => 
          prevHouses.map(house => {
            const total = dataTotal[house.id] || 0;
            return { ...house, scoreLower: 0, scoreUpper: 0, totalScore: total };
          })
        );
      } else if (csvUrlLower && csvUrlUpper) {
        const [resLower, resUpper] = await Promise.all([
          fetch(freshUrl(csvUrlLower), { cache: 'no-store' }),
          fetch(freshUrl(csvUrlUpper), { cache: 'no-store' })
        ]);
        const dataLower = parseCSVData(await resLower.text());
        const dataUpper = parseCSVData(await resUpper.text());

        setHouses(prevHouses => 
          prevHouses.map(house => {
            const lower = dataLower[house.id] || 0;
            const upper = dataUpper[house.id] || 0;
            return { ...house, scoreLower: lower, scoreUpper: upper, totalScore: lower + upper };
          })
        );
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      if (manual) setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [csvUrlLower, csvUrlTotal, csvUrlUpper]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => fetchData(false), 0);
    const intervalId = setInterval(() => fetchData(false), 10000);
    return () => {
      window.clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [fetchData]);

  const sortedHouses = withCompetitionRanks(
    [...houses].sort((a, b) => b.totalScore - a.totalScore),
    house => house.totalScore,
  );
  const displayHouses = mode === 'embedded'
    ? [
        ...sortedHouses.slice(0, 6),
        ...sortedHouses.slice(6, 12),
      ]
    : sortedHouses;

  const formatTime = (date: Date | null) => {
    if (!date) return 'กำลังโหลด...';
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    // Uses the dynamic bgColor prop here!
    <div className={`shared-scoreboard ${mode === 'fullscreen' ? 'h-screen w-screen overflow-hidden' : 'shared-scoreboard-embedded rounded-xl'} ${bgColor} p-5 pt-8 lg:p-8 lg:pt-10 flex flex-col items-center transition-colors duration-500`}>
      
      <div className="flex justify-between items-center w-full max-w-[1400px] mb-5 shrink-0 px-3">
        <div>
          {/* Uses the dynamic title and subtitle props here! */}
          <h1 className="text-3xl lg:text-5xl font-extrabold text-white drop-shadow-md mb-1">{title}</h1>
          <p className="text-sm lg:text-xl text-white/80 font-medium">{subtitle}</p>
        </div>
        
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={isRefreshing}
          className={`shared-scoreboard-clock shared-scoreboard-refresh-button flex items-center gap-3 bg-white/10 backdrop-blur-sm px-4 py-2.5 rounded-xl border border-white/20 ${isRefreshing ? 'opacity-75 cursor-wait' : 'hover:bg-white/15 active:scale-[0.98]'}`}
        >
          <div className="flex flex-col items-end">
            <span className="text-[10px] lg:text-xs text-white/80 uppercase font-bold tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Real-time
            </span>
            <span className="text-white font-mono font-medium text-xs lg:text-sm">
              อัปเดต: {formatTime(lastUpdated)}
            </span>
          </div>
          <RefreshCw className={`shared-scoreboard-refresh w-4 h-4 lg:w-5 lg:h-5 ${isRefreshing ? 'animate-spin text-white/70' : ''}`} />
        </button>
      </div>

      <div className="w-full max-w-[1400px] flex-1 min-h-0 pb-3 px-3">
        <ul className={`shared-scoreboard-grid grid grid-cols-1 grid-flow-row gap-x-8 gap-y-4 h-full content-start ${mode === 'fullscreen' ? 'lg:grid-rows-6 lg:grid-flow-col' : ''}`}>
          <AnimatePresence>
            {displayHouses.map((house) => {
              const isTop1 = house.rank === 1;
              const isTop2 = house.rank === 2;
              const isTop3 = house.rank === 3;

              return (
                <motion.li
                  key={house.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                  className={`shared-scoreboard-card relative flex items-center justify-between px-5 py-3 lg:px-6 lg:py-4 rounded-xl shadow-md border-l-8 bg-white h-[84px] lg:h-[96px] ${
                    isTop1 ? 'border-yellow-400 z-10 scale-[1.02] shadow-lg' :
                    isTop2 ? 'border-slate-400' :
                    isTop3 ? 'border-amber-600' :
                    'border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-5 overflow-hidden">
                    <div className={`shared-scoreboard-rank flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 flex items-center justify-center rounded-full text-xl font-black shadow-inner ${
                      isTop1 ? 'bg-yellow-100' : isTop2 ? 'bg-slate-100' : isTop3 ? 'bg-amber-50' : 'bg-gray-100'
                    }`}>
                      {isTop1 ? <Crown className="w-6 h-6 lg:w-7 lg:h-7 text-yellow-500" /> :
                       isTop2 ? <Medal className="w-6 h-6 lg:w-7 lg:h-7 text-slate-500" /> :
                       isTop3 ? <Medal className="w-6 h-6 lg:w-7 lg:h-7 text-amber-600" /> :
                       <span className="text-gray-500">{house.rank}</span>}
                    </div>

                    <div className="flex flex-col min-w-0">
                      <h2 className={`shared-scoreboard-name text-xl lg:text-2xl font-black tracking-wide mb-1 truncate ${isTop1 ? 'text-gray-900' : 'text-gray-800'}`}>
                        {house.name}
                      </h2>
                      {showDetails && <div className="flex gap-2 text-[10px] lg:text-xs font-bold text-gray-500 truncate">
                        <span className="shared-scoreboard-chip bg-gray-50 text-gray-700 px-2 py-0.5 rounded border border-gray-200">
                          เกมล่าง: <AnimatedNumber value={house.scoreLower} />
                        </span>
                        <span className="shared-scoreboard-chip bg-gray-50 text-gray-700 px-2 py-0.5 rounded border border-gray-200">
                          เกมบน: <AnimatedNumber value={house.scoreUpper} />
                        </span>
                      </div>}
                    </div>
                  </div>

                  <div className="shared-scoreboard-total flex flex-col items-end justify-center w-28 lg:w-36 shrink-0 border-l border-gray-100 pl-5">
                    <p className="shared-scoreboard-total-label text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Total</p>
                    <p className={`text-3xl lg:text-4xl font-black tabular-nums tracking-tight ${
                      isTop1 ? 'text-yellow-500' : isTop2 ? 'text-slate-600' : isTop3 ? 'text-amber-700' : 'text-gray-800'
                    }`}>
                      {showNumbers ? <AnimatedNumber value={house.totalScore} /> : <span className="shared-scoreboard-hidden-score">Hidden</span>}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
