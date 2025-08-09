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

async function cutSegments(inputPath, segments, outDir) {
  const segPaths = [];
  let index = 0;
  for (const [start, end] of segments) {
    const outPath = path.join(outDir, `seg_${index}.mp4`);
    const args = [
      '-y',
      '-i', inputPath,
      '-ss', start.toFixed(3),
      '-to', end.toFixed(3),
      '-avoid_negative_ts', 'make_zero',
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
  }
  return segPaths;
}

async function concatSegments(segPaths, outPath) {
  const listPath = outPath + '.list.txt';
  const content = segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(listPath, content, 'utf8');
  try {
    // try stream copy
    await runCommand('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
  } catch (e) {
    // fallback to re-encode
    await runCommand('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outPath]);
  }
}

app.post('/api/process', upload.single('videoFile'), async (req, res) => {
  const noiseDb = parseFloat(req.body.noiseDb ?? '-30');
  const minSilence = parseFloat(req.body.minSilence ?? '0.4');
  const inputPath = path.join(req.jobDir, req.file.filename);
  const outPath = path.join(req.jobDir, 'output.mp4');

  try {
    const duration = await getDurationSeconds(inputPath);
    const { stderr } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
      '-f', 'null', '-'
    ]);
    const silencePairs = parseSilenceLog(stderr);

    // If no silence detected, just pass-through
    if (silencePairs.length === 0) {
      await runCommand('ffmpeg', ['-y', '-i', inputPath, '-c', 'copy', outPath]);
    } else {
      const segments = buildNonSilentSegments(duration, silencePairs);
      if (segments.length === 0) {
        // Entirely silent? Return a 1-second black/silent video
        await runCommand('ffmpeg', [
          '-y',
          '-f', 'lavfi', '-i', 'color=black:s=1280x720:d=1:r=30',
          '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
          '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outPath
        ]);
      } else {
        const segPaths = await cutSegments(inputPath, segments, req.jobDir);
        await concatSegments(segPaths, outPath);
      }
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="autocut.mp4"');
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', async () => {
      // cleanup
      try { await fsp.rm(req.jobDir, { recursive: true, force: true }); } catch {}
    });
  } catch (err) {
    console.error(err);
    try { await fsp.rm(req.jobDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: 'Processing failed', details: String(err && err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`AutoCut server listening on http://localhost:${PORT}`);
}); 