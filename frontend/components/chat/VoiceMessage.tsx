"use client";

// Voice bubble. Renders three states:
//   1. loading (mediaAssetId present, url not yet)
//   2. ready   (signed URL): play/pause + duration
//   3. error
//
// A full waveform view requires precomputed peaks from the worker meta or
// an in-browser AnalyserNode; the current implementation shows a compact
// progress bar. The waveform upgrade is a low-risk follow-up because the
// props already carry the assetId that would key any peaks lookup.

import * as React from "react";

interface Props {
  mediaAssetId: string;
  url: string | null;
  error?: string | null;
}

export function VoiceMessage({ mediaAssetId, url, error }: Props) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  React.useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setProgress(el.currentTime);
    const onLoaded = () => setDuration(el.duration || 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnd);
    };
  }, [url]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
        Voice failed ({error}) - the text reply is still above.
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        Generating voice note...
      </div>
    );
  }

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  return (
    <div
      data-media-id={mediaAssetId}
      className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
    >
      <button
        type="button"
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "||" : ">"}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full bg-blue-500"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
          />
        </div>
        <span className="text-[11px] text-slate-500">
          {Math.floor(progress)}s / {Math.max(1, Math.floor(duration))}s
        </span>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}
