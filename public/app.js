const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const spinner = document.getElementById('spinner');
const statusEl = document.getElementById('status');
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

function toggleLoading(isLoading) {
  spinner.classList.toggle('hidden', !isLoading);
  processBtn.disabled = isLoading || !selectedFile;
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

    const response = await fetch('/api/process', { method: 'POST', body: formData });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err && err.error ? err.error : `Request failed (${response.status})`);
    }
    const blob = await response.blob();
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