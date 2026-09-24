# Transcription Pipeline Directive

## Goal
Reliably transcribe video audio across various sources (local files, offline copies, direct streams, and provider streams like Vimeo), automatically starting playback on demand and streaming real-time transcription cues into the Script desk panel.

## Architecture & Hierarchy

1. **Provider Captions (Highest fidelity & speed)**:
   - When a video URL belongs to a provider like Vimeo (`vimeo.com`), check `/api/transcript?url=...&language=...`.
   - If public WebVTT captions exist, load timed cues immediately into `Original Transcript`.
   - Trigger playback so the user can follow along with audio and captions in sync.

2. **Direct HLS Stream Audio Decoding (Fast & high quality)**:
   - When public captions are not available, resolve the direct media source via `/api/stream?url=...`.
   - For Vimeo, `server.js` resolves the unencrypted HLS master playlist URL (`.m3u8`).
   - The client parses the HLS master playlist to discover the dedicated audio playlist (`media.m3u8`) and initialization chunk (`segment.mp4`).
   - `transcribeHlsAudio()` starts decoding segments starting from the current playhead position (`currentTime`), combining init and media segments and downsampling to 16kHz mono.
   - Initial window size is tuned to ~6 seconds so the first transcribed line appears after a brief moment; subsequent windows process ~12 seconds.
   - Samples are posted to `/api/transcribe` (local Whisper model).

3. **Real-time Web Audio Element Tap (Fallback & direct video files)**:
   - Used for direct video files (MP4, WebM, etc.) and fallback if stream parsing is unavailable.
   - Requires `<video id="videoPlayer" crossorigin="anonymous">` to prevent cross-origin taint when tapping media elements with CORS headers.
   - `AudioContext.createMediaElementSource()` / `captureStream()` taps the video element while playing.
   - Audio worklet or script processor collects samples; first batch flushes at 5 seconds for rapid feedback.

## Edge Cases & Discovered Constraints

1. **Cross-Origin Iframe Taint**:
   - Web Audio API cannot tap audio from a cross-origin `<iframe>` (e.g. `player.vimeo.com`). Any attempt to tap a silent or hidden `<video>` while playing an iframe yields zero RMS and throws *"The video is playing, but its audio is not reaching the transcriber."*
   - Solution: Resolve stream sources and play directly inside the native `<video>` element with `hls.js`.

2. **CORS Headers on Provider Streams**:
   - Vimeo HLS CDNs provide `Access-Control-Allow-Origin: *` on master playlists, audio playlists, and segment media chunks, allowing both `hls.js` video playback and `decodeAudioData` fetching from `localhost`.
   - The `<video>` element must have `crossorigin="anonymous"` for MediaElementSource compatibility.

3. **Playhead Synchronization**:
   - Audio segments must start at `hlsSegmentIndexAt(segments, videoPlayer.currentTime)` so seeking and resuming transcription stays in sync with user playback.
