import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Read {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
}

interface Trophy {
  id: number;
}

interface CaseFile {
  id: string;
  at: string;
  target: string;
  horizon_minutes: number;
  levels: number[];
  game: { release_date?: string };
  trophies: Trophy[];
  history: Read[];
}

interface Point {
  timeMs: number;
  x: number;
  y: number;
}

interface Fit {
  points: Point[];
  intercept: number;
  slope: number;
  residual: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const clampRate = (value: number): number => clamp(value, 0.01, 99.99);

const logit = (percent: number): number => {
  const p = clampRate(percent);
  return Math.log(p / (100 - p));
};

const inverseLogit = (value: number): number => {
  if (value >= 0) {
    const e = Math.exp(-value);
    return 100 / (1 + e);
  }
  const e = Math.exp(value);
  return 100 * e / (1 + e);
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

const timeOf = (value: string): number => {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
};

const samePage = (a: Read, b: Read): boolean => {
  if (a.players_tracked !== b.players_tracked || a.rates.length !== b.rates.length) return false;
  for (let i = 0; i < a.rates.length; i += 1) {
    if (a.rates[i] !== b.rates[i]) return false;
  }
  return true;
};

const distinctReads = (history: Read[]): Read[] => {
  const result: Read[] = [];
  for (const read of history) {
    if (result.length === 0 || !samePage(result[result.length - 1], read)) result.push(read);
  }
  return result;
};

const releaseTime = (c: CaseFile, firstReadMs: number): number => {
  const date = c.game?.release_date;
  if (typeof date === 'string') {
    const parsed = timeOf(`${date}T00:00:00Z`);
    if (parsed !== 0) return parsed;
  }
  return firstReadMs;
};

const logTime = (timeMs: number, releaseMs: number): number =>
  Math.log1p(Math.max(0, (timeMs - releaseMs) / HOUR));

const recentPoints = (points: Point[], lastTimeMs: number): Point[] => {
  if (points.length <= 3) return points;
  const cutoff = lastTimeMs - 36 * HOUR;
  const recent = points.filter((point) => point.timeMs >= cutoff);
  return recent.length >= 2 ? recent : points.slice(-3);
};

const fitWeighted = (allPoints: Point[], lastTimeMs: number): Fit | null => {
  if (allPoints.length === 0) return null;
  const points = recentPoints(allPoints, lastTimeMs);
  if (points.length === 1) {
    return { points, intercept: points[0].y, slope: 0, residual: 0 };
  }

  let weightTotal = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (let i = 0; i < points.length; i += 1) {
    const weight = 0.5 + (i + 1) / points.length;
    weightTotal += weight;
    xTotal += weight * points[i].x;
    yTotal += weight * points[i].y;
  }
  const xMean = xTotal / weightTotal;
  const yMean = yTotal / weightTotal;
  let xx = 0;
  let xy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const weight = 0.5 + (i + 1) / points.length;
    const dx = points[i].x - xMean;
    xx += weight * dx * dx;
    xy += weight * dx * (points[i].y - yMean);
  }
  const slope = xx > 1e-12 ? clamp(xy / xx, -1.5, 2.4) : 0;
  const intercept = yMean - slope * xMean;
  let squared = 0;
  let residualWeight = 0;
  for (let i = 0; i < points.length; i += 1) {
    const weight = 0.5 + (i + 1) / points.length;
    const error = points[i].y - (intercept + slope * points[i].x);
    squared += weight * error * error;
    residualWeight += weight;
  }
  return { points, intercept, slope, residual: Math.sqrt(squared / residualWeight) };
};

const dampingFor = (horizonMinutes: number): number => {
  const days = Math.max(0, horizonMinutes / 1440);
  return clamp(1 / (1 + 0.35 * Math.sqrt(days)), 0.35, 0.92);
};

const projectedValue = (fit: Fit | null, lastValue: number, lastX: number, targetX: number, damping: number): number => {
  if (fit === null || fit.points.length < 2) return lastValue;
  const gain = fit.slope * (targetX - lastX) * damping;
  return lastValue * Math.exp(clamp(gain, -6, 6));
};

const roundedEarners = (read: Read, index: number): number | null => {
  const rate = read.rates[index];
  if (rate === null || !Number.isFinite(rate) || !Number.isFinite(read.players_tracked) || read.players_tracked <= 0) return null;
  return Math.max(0, Math.round((rate / 100) * read.players_tracked));
};

const outputQuantiles = (median: number, sigma: number, perfect: boolean): number[] => {
  if (perfect) return [100, 100, 100, 100, 100];
  const center = logit(median);
  const result: number[] = [];
  let previous = 0;
  for (const z of Z) {
    const value = round4(clamp(inverseLogit(center + z * sigma), 0, 100));
    const monotone = Math.max(previous, value);
    result.push(monotone);
    previous = monotone;
  }
  return result;
};

const ratePoints = (reads: Read[], index: number, releaseMs: number): Point[] => {
  const points: Point[] = [];
  for (const read of reads) {
    const rate = read.rates[index];
    if (rate === null || !Number.isFinite(rate)) continue;
    points.push({ timeMs: timeOf(read.at), x: logTime(timeOf(read.at), releaseMs), y: logit(rate) });
  }
  return points;
};

const jumpSigma = (reads: Read[], index: number): number => {
  const jumps: number[] = [];
  for (let i = 1; i < reads.length; i += 1) {
    const previous = reads[i - 1].rates[index];
    const current = reads[i].rates[index];
    if (previous === null || current === null || !Number.isFinite(previous) || !Number.isFinite(current)) continue;
    jumps.push(Math.min(4.5, Math.abs(logit(current) - logit(previous))));
  }
  if (jumps.length === 0) return 0.35;
  const average = jumps.reduce((sum, value) => sum + value, 0) / jumps.length;
  const largest = Math.max(...jumps);
  return 0.35 + 0.45 * average + 0.25 * largest;
};

const lastRateFor = (reads: Read[], index: number): number => {
  for (let i = reads.length - 1; i >= 0; i -= 1) {
    const rate = reads[i].rates[index];
    if (rate !== null && Number.isFinite(rate)) return clamp(rate, 0, 100);
  }
  return 0.01;
};

const forecastCase = (c: CaseFile): { trophies: Array<{ id: number; q: number[] }> } => {
  const reads = distinctReads(c.history);
  const fallbackRead = reads[reads.length - 1] ?? c.history[c.history.length - 1];
  if (fallbackRead === undefined) throw new Error(`${c.id} has no history`);

  const firstMs = timeOf(reads[0]?.at ?? fallbackRead.at);
  const releaseMs = releaseTime(c, firstMs);
  const targetMs = timeOf(c.target) || timeOf(c.at) + c.horizon_minutes * 60 * 1000;
  const lastMs = timeOf(fallbackRead.at);
  const targetX = logTime(targetMs, releaseMs);
  const lastX = logTime(lastMs, releaseMs);
  const damping = dampingFor(c.horizon_minutes);
  const horizonDays = Math.max(0, c.horizon_minutes / 1440);
  const randomSigma = 0.5 * Math.sqrt(horizonDays);
  const flatHistory = reads.length === 1;

  const playerPoints = reads
    .filter((read) => Number.isFinite(read.players_tracked) && read.players_tracked > 0)
    .map((read) => ({
      timeMs: timeOf(read.at),
      x: logTime(timeOf(read.at), releaseMs),
      y: Math.log(read.players_tracked),
    }));
  const playerFit = fitWeighted(playerPoints, lastMs);
  const lastPlayers = Math.max(1, fallbackRead.players_tracked);
  const projectedPlayers = Math.max(lastPlayers, projectedValue(playerFit, lastPlayers, lastX, targetX, damping));
  const output = [];

  for (let index = 0; index < c.trophies.length; index += 1) {
    const lastRate = lastRateFor(reads, index);
    const perfect = lastRate >= 99.995;
    let median = perfect ? 100 : lastRate;
    let sigma = randomSigma;

    const earners = reads
      .map((read) => {
        const value = roundedEarners(read, index);
        if (value === null) return null;
        return { read, value };
      })
      .filter((item): item is { read: Read; value: number } => item !== null && item.value > 0)
      .map(({ read, value }) => ({
        timeMs: timeOf(read.at),
        x: logTime(timeOf(read.at), releaseMs),
        y: Math.log(value),
        value,
      }));

    if (!perfect && flatHistory) {
      const expectedGrowth = 1 + 5 * clamp(c.horizon_minutes / 90, 0, 3);
      const dilution = Math.max(1 / 3.5, 1 / expectedGrowth);
      median = clamp(lastRate * dilution, 0.01, 99.99);
      sigma = Math.max(1.65, randomSigma + 1.35);
    } else if (!perfect) {
      const lastEarner = earners[earners.length - 1]?.value ?? 0;
      const firstEarner = earners[0]?.value ?? lastEarner;
      const meaningfulMovement = earners.length >= 3 ||
        (earners.length >= 2 && (lastEarner > firstEarner * 1.25 || firstEarner > lastEarner * 1.25));
      const earnerPoints: Point[] = earners.map(({ timeMs, x, y }) => ({ timeMs, x, y }));
      const earnerFit = meaningfulMovement ? fitWeighted(earnerPoints, lastMs) : null;
      const projectedEarners = meaningfulMovement
        ? Math.max(lastEarner, projectedValue(earnerFit, lastEarner, lastX, targetX, damping))
        : lastEarner;
      median = clamp(100 * projectedEarners / projectedPlayers, 0.01, 99.99);

      const curve = fitWeighted(ratePoints(reads, index, releaseMs), lastMs);
      const residual = curve === null || curve.points.length < 3 ? 0 : curve.residual;
      const refresh = jumpSigma(reads, index);
      sigma = Math.sqrt(randomSigma * randomSigma + residual * residual + refresh * refresh);
      if (earners.length < 2 || !meaningfulMovement) sigma += 0.25;
    }

    output.push({ id: c.trophies[index].id, q: outputQuantiles(median, sigma, perfect) });
  }
  return { trophies: output };
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const files = readdirSync(INPUT_DIR).filter((file) => file.endsWith('.in')).sort();
for (const file of files) {
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((level, i) => level !== LEVELS[i])) {
    throw new Error(`${file} has unexpected quantile levels`);
  }
  const result = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${file.slice(0, -3)}.out`), `${JSON.stringify(result)}\n`);
}
