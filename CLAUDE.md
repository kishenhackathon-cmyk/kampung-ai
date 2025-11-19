# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kampung AI** is a voice and video AI assistant application that creates an interactive "Village Head" (Ketua Kampung) for community engagement. The app uses Google's Gemini Live API with multimodal capabilities (voice + video) to provide real-time conversational AI with mood analysis, event discovery, and scam detection.

## Key Technologies

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite 6
- **AI Integration**: Google GenAI SDK (@google/genai) with Gemini 2.5 Flash Native Audio Preview
- **Styling**: Tailwind CSS (via CDN in HTML)
- **Icons**: lucide-react

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (runs on http://0.0.0.0:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Configuration

Create a `.env` or `.env.local` file in the project root with:

```
GEMINI_API_KEY=your_api_key_here
```

The Vite config (vite.config.ts:14-15) exposes this as both `process.env.API_KEY` and `process.env.GEMINI_API_KEY` for use in the application.

## Architecture

### Single-File Application Structure

The entire application lives in `index.tsx` - a single React component that manages:

1. **Gemini Live API Session** (index.tsx:264-428)
   - Real-time bidirectional audio streaming using PCM16 format
   - Dynamic sample rate detection from AudioContext (typically 44100 or 48000 Hz)
   - Video frame capture and streaming (320x240 @ 5fps when camera enabled)
   - Tool calling integration for event search and scam detection

2. **Audio Processing Pipeline** (index.tsx:321-360)
   - ScriptProcessorNode for real-time PCM capture
   - Converts Float32 audio to Int16 PCM for Gemini API
   - Volume meter visualization
   - Silent stream fallback if microphone access fails

3. **Multimodal Input Handling**
   - Audio: Continuous PCM streaming via `sendRealtimeInput()`
   - Video: JPEG frames sent every 5 seconds when camera enabled
   - The AI analyzes facial expressions for distress detection

4. **Tool Functions** (index.tsx:298-314)
   - `searchNearbyEvents`: Returns mock community events
   - `checkSuspiciousNumber`: Checks phone numbers against scam database
   - Responses sent back via `sendToolResponse()`

5. **Google Maps 3D Integration** (index.tsx:107-224)
   - Custom React component for 3D map visualization
   - Dynamically loads Google Maps 3D library
   - Displays community events and user location
   - Triggered by AI when user asks to show map

### Audio Decode Logic

The `decodeAudioData()` function (index.tsx:82-105) manually constructs an AudioBuffer from Int16 PCM data returned by Gemini (24kHz native rate), converting to Float32 for Web Audio API playback.

### UI Modes

- **voice**: Default conversational mode
- **quest**: Event discovery interface with 3D map integration
- **connect**: QR code sharing for friend connections
- **distress**: SOS alert mode

## Important Implementation Details

### Audio Context Sample Rate

The app automatically detects and uses the system's native sample rate (index.tsx:269) to prevent hardware mismatches. The MIME type is dynamically set: `audio/pcm;rate=${sampleRate}`.

### Mic Fallback Behavior

If microphone access is denied or unavailable, the app creates a silent audio stream (index.tsx:58-65) to prevent crashes while disabling audio input UI.

### System Instruction

The AI persona is defined in `SYSTEM_INSTRUCTION` (index.tsx:26-47):
- Singlish accent with particles ("lah", "mah", "lor")
- Multilingual support (English, Malay, Mandarin, Tamil)
- Real-time mood analysis from video frames
- Automatic distress detection and response

### Video Frame Streaming

When camera is enabled, frames are captured at 5 second intervals (index.tsx:456-481), converted to base64 JPEG, and sent to Gemini for visual analysis.

### Google Maps API Key

The Google Maps API key is hardcoded in index.tsx:15. Consider moving to environment variable for production.

## Build Configuration

- TypeScript target: ES2022
- Module resolution: bundler mode
- Path alias: `@/*` maps to project root
- Dev server: Port 3000, accessible on all network interfaces (0.0.0.0)

## Mock Data

Two mock datasets are defined (index.tsx:49-54):
- `MOCK_EVENTS`: Community events with coordinates and rewards
- `MOCK_SCAM_NUMBERS`: Phone numbers flagged as scams

Replace these with real API calls when integrating backend services.

## Testing the Application

1. **Camera/Microphone**: The app will request permissions on first load
2. **Location**: Used for nearby events feature
3. **Voice Commands**: Try asking about nearby events or checking if a number is a scam
4. **Map View**: Ask "show me the map" to trigger 3D map visualization
5. **Distress Mode**: Access via menu drawer for emergency features