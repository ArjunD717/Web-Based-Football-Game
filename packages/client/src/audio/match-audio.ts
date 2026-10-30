// packages/client/src/audio/match-audio.ts

import type { SnapshotFrame, SnapshotMatchPhase } from "@fb/shared";

const STORAGE_KEY = "fb.audio";
const MASTER_LEVEL = 0.55;

/**
 * Self-made procedural match audio. There are no licensed samples: crowd noise
 * is filtered noise, whistles are sines, and goals are a short filtered swell.
 * The AudioContext is only created after a user gesture, as browsers require.
 */
export class MatchAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled: boolean;
  private unlocked = false;
  private score: string | null = null;
  private eventSeq = 0;
  private phase: SnapshotMatchPhase | null = null;

  constructor() {
    this.enabled = readEnabled();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      if (this.context === null) {
        const context = new AudioContext();
        const master = context.createGain();
        master.gain.value = MASTER_LEVEL;
        master.connect(context.destination);
        const crowdGain = context.createGain();
        crowdGain.gain.value = 0.03;
        crowdGain.connect(master);
        const noise = createNoiseBuffer(context, 2);
        const source = context.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 680;
        source.connect(filter);
        filter.connect(crowdGain);
        source.start();
        this.context = context;
        this.master = master;
        this.noiseBuffer = noise;
      }
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      if (this.master !== null) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.linearRampToValueAtTime(MASTER_LEVEL, now + 0.08);
      }
      this.unlocked = true;
    } catch {
      this.enabled = false;
    }
  }

  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled;
    writeEnabled(this.enabled);
    if (this.enabled) {
      await this.unlock();
    } else if (this.master !== null && this.context !== null) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(
        0,
        this.context.currentTime + 0.08,
      );
    }
    return this.enabled;
  }

  handleSnapshot(frame: SnapshotFrame): void {
    if (!this.enabled || !this.unlocked || this.context === null) {
      return;
    }
    const match = frame.match;
    const score = `${match.scoreHome}:${match.scoreAway}`;
    if (this.score !== null && score !== this.score) {
      this.playGoal();
    }
    this.score = score;

    if (this.phase !== null && this.phase !== match.phase) {
      if (match.phase === "halfTime" || match.phase === "fullTime") {
        this.playWhistle(0.45, 0.9);
      }
    }
    this.phase = match.phase;

    const event = match.lastEvent;
    if (event !== null && event.seq !== this.eventSeq) {
      this.eventSeq = event.seq;
      if (isWhistleEvent(event.type)) {
        this.playWhistle(0.22, 0.65);
      }
    }
  }

  reset(): void {
    this.score = null;
    this.eventSeq = 0;
    this.phase = null;
  }

  destroy(): void {
    if (this.context !== null) {
      void this.context.close();
    }
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.unlocked = false;
  }

  private playWhistle(duration: number, level: number): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) {
      return;
    }
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level * 0.16, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(master);
    for (const frequency of [2_050, 2_450]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }
    window.setTimeout(() => gain.disconnect(), (duration + 0.2) * 1_000);
  }

  private playGoal(): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.noiseBuffer;
    if (context === null || master === null || buffer === null) {
      return;
    }
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 760;
    filter.Q.value = 0.45;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 1.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + 2.7);
    window.setTimeout(() => {
      gain.disconnect();
      filter.disconnect();
    }, 2_900);
    this.playWhistle(0.3, 0.8);
  }
}

function isWhistleEvent(type: string): boolean {
  return (
    type === "foul" ||
    type === "offside" ||
    type === "handball" ||
    type === "yellowCard" ||
    type === "redCard" ||
    type === "forfeit"
  );
}

function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Audio remains usable for this session.
  }
}
