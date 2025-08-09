const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const multer = require('multer');
const { nanoid } = require('nanoid');
const ffprobeStatic = require('ffprobe-static');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Upload handling
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const jobId = nanoid();
        const jobDir = path.join(__dirname, 'tmp', jobId);
        await fsp.mkdir(jobDir, { recursive: true });
        req.jobDir = jobDir;
        req.jobId = jobId;
        cb(null, jobDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, 'input' + path.extname(file.originalname || '.mp4'));
    }
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024 * 4 // 4GB
  }
});

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${command} exited with code ${code}`), { code, stdout, stderr }));
    });
  });
}

async function getDurationSeconds(inputPath) {
  return new Promise((resolve, reject) => {
    execFile(ffprobeStatic.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ], (err, stdout) => {
      if (err) return reject(err);
      const val = parseFloat(String(stdout).trim());
      if (Number.isFinite(val)) resolve(val);
      else reject(new Error('Unable to probe duration'));
    });
  });
}

function parseSilenceLog(stderrText) {
  const lines = stderrText.split(/\r?\n/);
  const silenceStarts = [];
  const silenceEnds = [];
  const startRe = /silence_start: ([0-9]+\.?[0-9]*)/;
  const endRe = /silence_end: ([0-9]+\.?[0-9]*)/;
  for (const line of lines) {
    const s = line.match(startRe);
    if (s) {
      silenceStarts.push(parseFloat(s[1]));
      continue;
    }
    const e = line.match(endRe);
    if (e) {
      silenceEnds.push(parseFloat(e[1]));
    }
  }
  // Pair starts and ends in order
  const pairs = [];
  let i = 0, j = 0;
  while (i < silenceStarts.length && j < silenceEnds.length) {
    if (silenceEnds[j] <= silenceStarts[i]) { j++; continue; }
    pairs.push([silenceStarts[i], silenceEnds[j]]);
    i++; j++;
  }
  return pairs;
}

function buildNonSilentSegments(duration, silencePairs) {
  const segments = [];
  let cursor = 0;
  for (const [sStart, sEnd] of silencePairs) {
    if (sStart > cursor) {
      segments.push([cursor, sStart]);
    }
    cursor = Math.max(cursor, sEnd);
  }
  if (duration > cursor + 0.01) {
    segments.push([cursor, duration]);
  }
  // filter out tiny segments (<0.2s)
  return segments.filter(([a, b]) => b - a >= 0.2);
}

async function cutSegments(inputPath, segments, outDir, onProgress) {
  const segPaths = [];
  let index = 0;
  const total = segments.length;
  for (const [start, end] of segments) {
    const outPath = path.join(outDir, `seg_${index}.mp4`);
    const args = [
      '-y',
      '-i', inputPath,
      '-ss', start.toFixed(3),
      '-to', end.toFixed(3),
      '-avoid_negative_ts', 'make_zero',
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-map_metadata', '-1',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outPath
    ];
    await runCommand('ffmpeg', args);
    segPaths.push(outPath);
    index++;
    if (typeof onProgress === 'function') {
      try { onProgress(index, total); } catch {}
    }
  }
  return segPaths;
}

async function concatSegments(segPaths, outPath) {
  const listPath = outPath + '.list.txt';
  const content = segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(listPath, content, 'utf8');
  // Always re-encode on concat to ensure a clean, safe container
  await runCommand('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-map_metadata', '-1',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outPath
  ]);
}

// Simple in-memory progress store per job
const jobProgress = new Map();

app.get('/api/progress/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const info = jobProgress.get(jobId) || { status: 'unknown', percent: 0 };
  res.json(info);
});

app.post('/api/process', upload.single('videoFile'), async (req, res) => {
  const jobId = req.jobId;
  const noiseDb = parseFloat(req.body.noiseDb ?? '-30');
  const minSilence = parseFloat(req.body.minSilence ?? '0.4');
  const inputPath = path.join(req.jobDir, req.file.filename);
  const outPath = path.join(req.jobDir, 'output.mp4');

  jobProgress.set(jobId, { status: 'queued', percent: 0, jobId, jobDir: req.jobDir, outPath });

  // Immediately respond with jobId so the client can poll progress
  res.status(202).json({ jobId });

  // Process asynchronously
  setImmediate(async () => {
    try {
      jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'analyzing', percent: 5 });
      const duration = await getDurationSeconds(inputPath);
      const { stderr } = await runCommand('ffmpeg', [
        '-i', inputPath,
        '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
        '-f', 'null', '-'
      ]);
      const silencePairs = parseSilenceLog(stderr);

      if (silencePairs.length === 0) {
        jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'encoding', percent: 60 });
        await runCommand('ffmpeg', [
          '-y',
          '-i', inputPath,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-map_metadata', '-1',
          '-pix_fmt', 'yuv420p',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          outPath
        ]);
      } else {
        const segments = buildNonSilentSegments(duration, silencePairs);
        if (segments.length === 0) {
          jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'generating', percent: 70 });
          await runCommand('ffmpeg', [
            '-y',
            '-f', 'lavfi', '-i', 'color=black:s=1280x720:d=1:r=30',
            '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
            '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outPath
          ]);
        } else {
          jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'cutting', percent: 30 });
          const segPaths = await cutSegments(inputPath, segments, req.jobDir, (idx, total) => {
            const base = 30;
            const span = 40;
            const p = Math.round(base + (idx / total) * span);
            jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'cutting', percent: Math.min(p, 70) });
          });
          jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'concatenating', percent: 75 });
          await concatSegments(segPaths, outPath);
        }
      }
      jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'done', percent: 100 });
    } catch (err) {
      console.error(err);
      try { await fsp.rm(req.jobDir, { recursive: true, force: true }); } catch {}
      jobProgress.set(jobId, { ...(jobProgress.get(jobId) || {}), status: 'error', percent: 100, error: String(err && err.message || err) });
    }
  });
});

app.get('/api/result/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const info = jobProgress.get(jobId);
  if (!info) return res.status(404).json({ error: 'Unknown job' });
  if (info.status !== 'done' || !info.outPath) return res.status(409).json({ error: 'Not ready' });
  try {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Use inline to allow in-browser preview; omit attachment header to avoid forced download
    res.setHeader('Content-Disposition', 'inline; filename="autocut.mp4"');
    const stream = fs.createReadStream(info.outPath);
    stream.pipe(res);
    stream.on('close', async () => {
      try { await fsp.rm(info.jobDir, { recursive: true, force: true }); } catch {}
      jobProgress.delete(jobId);
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stream result' });
  }
});

app.listen(PORT, () => {
  console.log(`AutoCut server listening on http://localhost:${PORT}`);
}); 