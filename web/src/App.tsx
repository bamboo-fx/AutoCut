import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';

function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [noiseDb, setNoiseDb] = useState<number>(-30);
  const [minSilence, setMinSilence] = useState<number>(0.4);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setSelectedFile(f);
      setStatus(`Selected: ${f.name}`);
    }
  }, []);

  const onBrowse = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setSelectedFile(f);
      setStatus(`Selected: ${f.name}`);
    }
  }, []);

  const canProcess = useMemo(() => !!selectedFile && !isLoading, [selectedFile, isLoading]);

  async function startProcess() {
    if (!selectedFile) return;
    setIsLoading(true);
    setProgress(0);
    setStatus('Starting…');
    setDownloadUrl(null);
    if (videoRef.current) {
      videoRef.current.src = '';
    }

    try {
      const formData = new FormData();
      formData.append('videoFile', selectedFile);
      formData.append('noiseDb', String(noiseDb));
      formData.append('minSilence', String(minSilence));

      // Start job
      const startRes = await fetch('/api/process', { method: 'POST', body: formData });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({} as any));
        throw new Error(err && err.error ? err.error : `Request failed (${startRes.status})`);
      }
      const { jobId } = await startRes.json();

      // Poll progress
      let finished = false;
      const poll = async () => {
        try {
          const r = await fetch(`/api/progress/${jobId}`);
          if (!r.ok) return;
          const info = await r.json();
          if (typeof info.percent === 'number') setProgress(clamp(Math.round(info.percent)));
          if (info.status) setStatus(info.status === 'done' ? 'Finalizing…' : info.status);
          if (info.status === 'done') finished = true;
          if (info.status === 'error') throw new Error(info.error || 'Processing error');
        } catch (e) {
          throw e as Error;
        }
      };

      while (!finished) {
        await poll();
        if (!finished) await new Promise(r => setTimeout(r, 700));
      }

      // Fetch result
      const resultRes = await fetch(`/api/result/${jobId}`);
      if (!resultRes.ok) throw new Error('Failed to fetch result');
      const blob = await resultRes.blob();
      setProgress(100);

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      if (videoRef.current) {
        videoRef.current.src = url;
        try { await videoRef.current.play(); } catch {}
      }
      setStatus('Done. Preview below.');
    } catch (err: any) {
      console.error(err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-900 to-black text-white">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight">AutoCut</h1>
          <a className="text-red-400 hover:text-red-300 text-sm" href="https://ffmpeg.org/" target="_blank" rel="noreferrer">Powered by FFmpeg</a>
        </header>

        <main className="rounded-2xl p-6 shadow-xl" style={{backdropFilter:'blur(10px)', background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)'}}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2">
              <div
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); }}
                className="border-2 border-dashed border-white/20 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-red-500 cursor-pointer"
                onClick={() => document.getElementById('fileInput')?.click()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-12 h-12 mb-3 text-red-400"><path fill="currentColor" d="M19 13v6H5v-6H3v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6z"/><path fill="currentColor" d="M11 6.414V16h2V6.414l3.293 3.293l1.414-1.414L12 2.586L6.293 8.293l1.414 1.414z"/></svg>
                <p className="text-lg font-medium">Drag & drop your video here</p>
                <p className="text-sm text-white/60 mt-1">or click to browse</p>
                <input id="fileInput" type="file" accept="video/*" className="hidden" onChange={onBrowse} />
              </div>
              <div className="mt-3 text-xs text-white/50">Supported: most video formats. Files stay on your device; processing is local.</div>

              <div className="mt-6">
                <Button onClick={startProcess} disabled={!canProcess} className="w-full h-12">
                  {isLoading && (
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                  )}
                  <span>Remove Deadspace</span>
                </Button>
                <div className="mt-3">
                  <Progress value={clamp(progress)} />
                </div>
                <div className="mt-2 text-sm text-white/70">{status}</div>
              </div>
            </section>

            <aside className="space-y-5">
              <div className="bg-white/5 rounded-xl p-4">
                <h2 className="font-semibold mb-3">Parameters</h2>
                <Label className="block mb-2">Silence Threshold (dB)</Label>
                <Slider min={-60} max={-10} step={1} value={[noiseDb]} onValueChange={(v: number[]) => setNoiseDb(v[0])} />
                <div className="text-xs text-white/60">{noiseDb} dB</div>

                <div className="h-4"></div>

                <Label className="block mb-2">Minimum Silence Length (s)</Label>
                <Slider min={0.1} max={2.0} step={0.1} value={[minSilence]} onValueChange={(v: number[]) => setMinSilence(v[0])} />
                <div className="text-xs text-white/60">{minSilence.toFixed(1)} s</div>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <h2 className="font-semibold mb-3">Preview</h2>
                <video ref={videoRef} controls className="w-full rounded-md bg-black aspect-video" />
                {downloadUrl && (
                  <a href={downloadUrl} download="autocut.mp4" className="mt-3 inline-block w-full text-center bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-semibold">Download</a>
                )}
              </div>
            </aside>
          </div>
        </main>

        <footer className="mt-8 text-center text-xs text-white/50">All processing done locally via FFmpeg. Your media does not leave your machine.</footer>
      </div>
    </div>
  );
} 