// Il riquadro di un video assume le proporzioni del filmato (verticale,
// orizzontale o quadrato), così viene mostrato intero, senza tagli né bande nere.
export function fitFrameToVideo(media, frame = media.parentElement) {
  if (!frame || !media.videoWidth || !media.videoHeight) return;
  frame.style.setProperty('--video-ratio', String(media.videoWidth / media.videoHeight));
  frame.dataset.fitted = '';
}

export function resetVideoFrame(frame) {
  if (!frame) return;
  frame.style.removeProperty('--video-ratio');
  delete frame.dataset.fitted;
}

export function keepFrameFitted(media, frame = media.parentElement) {
  media.addEventListener('loadedmetadata', () => fitFrameToVideo(media, frame));
  media.addEventListener('emptied', () => resetVideoFrame(frame));
}
