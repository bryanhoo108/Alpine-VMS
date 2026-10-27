import { useEffect } from 'react';

let ctx: AudioContext | null = null;

/** Two-tone alarm for red status. Browsers allow sound after the first tap (sign-in). */
export function playAlarm() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.3, t + i * 0.25);
      gain.gain.setValueAtTime(0, t + i * 0.25 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.25);
      osc.stop(t + i * 0.25 + 0.2);
    }
  } catch {
    // No audio device: the red screen still shows.
  }
}

/** Play the alarm whenever `key` changes to a new red situation. */
export function useAlarm(red: boolean, key: string | null) {
  useEffect(() => {
    if (red && key) playAlarm();
  }, [red, key]);
}
