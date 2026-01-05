import os
from google.cloud import speech

def transcribe_audio(audio_path: str, language: str = 'en') -> str:
    """
    Transcribe audio using Google Cloud Speech-to-Text V1 with enhanced model.

    Args:
        audio_path: Path to WAV audio file
        language: Language code (default: 'en')

    Returns:
        Full transcript as string

    Raises:
        Exception: If transcription fails
    """
    print(f"[Transcriber] Starting transcription for {audio_path} (language: {language})")

    client = speech.SpeechClient()

    # Read audio file
    with open(audio_path, 'rb') as audio_file:
        audio_content = audio_file.read()

    print(f"[Transcriber] Audio file size: {len(audio_content)} bytes")

    # Configure audio
    audio = speech.RecognitionAudio(content=audio_content)

    # Configure recognition with default model
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code=language,
        use_enhanced=True  # Use enhanced model for better accuracy
    )

    # Transcribe
    try:
        print(f"[Transcriber] Calling Speech-to-Text API...")
        response = client.recognize(config=config, audio=audio)

        # Concatenate all transcript parts
        transcript_parts = []
        for result in response.results:
            if result.alternatives:
                transcript_parts.append(result.alternatives[0].transcript)

        full_transcript = " ".join(transcript_parts)
        print(f"[Transcriber] Transcription complete: {len(full_transcript)} characters")

        return full_transcript.strip()

    except Exception as e:
        print(f"[Transcriber] Speech-to-Text API error: {e}")
        raise Exception(f"Speech-to-Text error: {str(e)}")

def transcribe_long_audio(chunk_paths: list, language: str = 'en') -> str:
    """
    Transcribe long audio by processing multiple chunks and concatenating results.

    Args:
        chunk_paths: List of paths to audio chunk files
        language: Language code (default: 'en')

    Returns:
        Full transcript as string (all chunks concatenated)

    Raises:
        Exception: If transcription fails
    """
    print(f"[Transcriber] Transcribing {len(chunk_paths)} audio chunks...")

    all_transcripts = []

    for i, chunk_path in enumerate(chunk_paths):
        try:
            print(f"[Transcriber] Transcribing chunk {i+1}/{len(chunk_paths)}...")
            chunk_transcript = transcribe_audio(chunk_path, language)
            all_transcripts.append(chunk_transcript)
            print(f"[Transcriber] Chunk {i+1} transcribed: {len(chunk_transcript)} chars")
        except Exception as e:
            print(f"[Transcriber] Warning: Chunk {i+1} transcription failed: {e}")
            # Continue with other chunks even if one fails
            continue

    # Concatenate all transcripts with space separator
    full_transcript = " ".join(all_transcripts)
    print(f"[Transcriber] All chunks transcribed. Total: {len(full_transcript)} characters")

    return full_transcript.strip()
