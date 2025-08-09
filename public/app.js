const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const spinner = document.getElementById('spinner');
const statusEl = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const preview = document.getElementById('preview');
const downloadLink = document.getElementById('downloadLink');
const noiseDb = document.getElementById('noiseDb');
const noiseDbVal = document.getElementById('noiseDbVal');
const minSilence = document.getElementById('minSilence');
const minSilenceVal = document.getElementById('minSilenceVal');

let selectedFile = null;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.className = 'mt-2 text-sm ' + (isError ? 'text-red-400' : 'text-white/70');
}

function setProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  progressBar.style.width = clamped + '%';
}

function toggleLoading(isLoading) {
  spinner.classList.toggle('hidden', !isLoading);
  processBtn.disabled = isLoading || !selectedFile;
  if (!isLoading) setProgress(0);
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-indigo-400', 'bg-white/5');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-indigo-400', 'bg-white/5');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-400', 'bg-white/5');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    selectedFile = e.dataTransfer.files[0];
    setStatus(`Selected: ${selectedFile.name}`);
    processBtn.disabled = false;
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) {
    selectedFile = fileInput.files[0];
    setStatus(`Selected: ${selectedFile.name}`);
    processBtn.disabled = false;
  }
});

noiseDb.addEventListener('input', () => { noiseDbVal.textContent = noiseDb.value; });
minSilence.addEventListener('input', () => { minSilenceVal.textContent = minSilence.value; });

processBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  toggleLoading(true);
  setStatus('Processing… This can take a while for large files.');
  downloadLink.classList.add('hidden');
  preview.removeAttribute('src');

  try {
    const formData = new FormData();
    formData.append('videoFile', selectedFile);
    formData.append('noiseDb', noiseDb.value);
    formData.append('minSilence', minSilence.value);

    // Kick off processing and capture jobId if returned in error or headers
    // Start job
    const startRes = await fetch('/api/process', { method: 'POST', body: formData });
    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
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
        if (typeof info.percent === 'number') setProgress(info.percent);
        if (info.status) setStatus(info.status === 'done' ? 'Finalizing…' : info.status);
        if (info.status === 'done') finished = true;
        if (info.status === 'error') throw new Error(info.error || 'Processing error');
      } catch (e) {
        throw e;
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
    preview.src = url;
    preview.play().catch(() => {});
    downloadLink.href = url;
    downloadLink.classList.remove('hidden');
    setStatus('Done. Preview below.');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + (err && err.message ? err.message : String(err)), true);
  } finally {
    toggleLoading(false);
  }
}); 