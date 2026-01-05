import os
import tempfile
import ffmpeg
import requests
from typing import Dict, Any, Optional

class NoAudioTrackError(Exception):
    """Raised when video has no audio track"""
    pass

def download_video(video_url: str, output_path: str) -> None:
    """Download video from URL to local file."""
    response = requests.get(video_url, stream=True, timeout=30)
    response.raise_for_status()

    with open(output_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

def extract_audio_from_video(video_path: str, audio_output_path: str) -> Dict[str, Any]:
    """
    Extract audio from video using ffmpeg.

    Returns:
        {
            "audio_path": "/tmp/audio.wav",
            "duration_seconds": 45.2,
            "sample_rate": 16000,
            "channels": 1
        }

    Raises:
        NoAudioTrackError: If video has no audio track
    """
    try:
        # Probe video to check for audio stream
        probe = ffmpeg.probe(video_path)
        audio_streams = [stream for stream in probe['streams'] if stream['codec_type'] == 'audio']

        if not audio_streams:
            raise NoAudioTrackError("Video has no audio track")

        # Extract audio to WAV (Speech-to-Text requires WAV/FLAC)
        # - Single channel (mono)
        # - 16kHz sample rate (optimal for speech)
        # - PCM 16-bit encoding
        (
            ffmpeg
            .input(video_path)
            .output(
                audio_output_path,
                acodec='pcm_s16le',  # PCM 16-bit little-endian
                ac=1,                 # Mono (1 channel)
                ar='16000'            # 16kHz sample rate
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True, quiet=True)
        )

        # Get audio duration
        audio_probe = ffmpeg.probe(audio_output_path)
        duration = float(audio_probe['format']['duration'])

        return {
            "audio_path": audio_output_path,
            "duration_seconds": duration,
            "sample_rate": 16000,
            "channels": 1
        }

    except ffmpeg.Error as e:
        raise Exception(f"FFmpeg error: {e.stderr.decode()}")

def process_video_for_transcription(video_url: str) -> Dict[str, Any]:
    """
    Download video and extract audio (if exists).

    Returns:
        {
            "video_path": "/tmp/video_123.mp4",
            "audio_path": "/tmp/audio_123.wav",  # None if no audio
            "has_audio": True/False,
            "duration_seconds": 45.2
        }
    """
    # Create temp files
    video_fd, video_path = tempfile.mkstemp(suffix='.mp4', prefix='video_')
    os.close(video_fd)

    audio_path = None
    has_audio = False
    duration = 0

    try:
        # Download video
        print(f"[AudioExtractor] Downloading video from {video_url}")
        download_video(video_url, video_path)
        print(f"[AudioExtractor] Video downloaded to {video_path}")

        # Try to extract audio
        try:
            audio_fd, audio_path = tempfile.mkstemp(suffix='.wav', prefix='audio_')
            os.close(audio_fd)

            print(f"[AudioExtractor] Extracting audio from video...")
            audio_info = extract_audio_from_video(video_path, audio_path)
            has_audio = True
            duration = audio_info['duration_seconds']
            print(f"[AudioExtractor] Audio extracted: {duration:.1f}s at {audio_info['sample_rate']}Hz")

        except NoAudioTrackError:
            print(f"[AudioExtractor] Video has no audio track (silent video)")
            has_audio = False
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
            audio_path = None

        return {
            "video_path": video_path,
            "audio_path": audio_path,
            "has_audio": has_audio,
            "duration_seconds": duration
        }

    except Exception as e:
        # Cleanup on error
        if os.path.exists(video_path):
            os.remove(video_path)
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
        raise Exception(f"Failed to process video: {e}")

def split_audio_into_chunks(audio_path: str, chunk_duration_seconds: int = 60) -> list:
    """
    Split audio file into chunks of specified duration.

    Args:
        audio_path: Path to WAV audio file
        chunk_duration_seconds: Duration of each chunk in seconds (default: 60)

    Returns:
        List of paths to chunk files: ['/tmp/chunk_0.wav', '/tmp/chunk_1.wav', ...]

    Raises:
        Exception: If chunking fails
    """
    try:
        # Get audio duration
        probe = ffmpeg.probe(audio_path)
        duration = float(probe['format']['duration'])

        print(f"[AudioExtractor] Splitting {duration:.1f}s audio into {chunk_duration_seconds}s chunks...")

        chunk_paths = []
        num_chunks = int(duration / chunk_duration_seconds) + (1 if duration % chunk_duration_seconds > 0 else 0)

        for i in range(num_chunks):
            start_time = i * chunk_duration_seconds

            # Create temp file for chunk
            chunk_fd, chunk_path = tempfile.mkstemp(suffix=f'_chunk{i}.wav', prefix='audio_')
            os.close(chunk_fd)

            # Extract chunk
            (
                ffmpeg
                .input(audio_path, ss=start_time, t=chunk_duration_seconds)
                .output(
                    chunk_path,
                    acodec='pcm_s16le',
                    ac=1,
                    ar='16000'
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True, quiet=True)
            )

            chunk_paths.append(chunk_path)
            print(f"[AudioExtractor] Created chunk {i+1}/{num_chunks}: {chunk_path}")

        return chunk_paths

    except Exception as e:
        # Cleanup any chunks created before error
        for path in chunk_paths:
            if os.path.exists(path):
                os.remove(path)
        raise Exception(f"Failed to split audio into chunks: {e}")

def cleanup_temp_files(file_paths: list):
    """Delete temporary files."""
    for path in file_paths:
        if path and os.path.exists(path):
            try:
                os.remove(path)
                print(f"[AudioExtractor] Cleaned up temp file: {path}")
            except Exception:
                pass  # Ignore cleanup errors
