import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, MapPin, 
  AlertTriangle, Menu, X, QrCode, Activity, Pause
} from 'lucide-react';

// --- Configuration & Types ---

const SYSTEM_INSTRUCTION = `
You are 'Ketua Kampung' (Village Head), a wise, friendly, and protective AI assistant for a Singaporean/Malaysian community.
You are currently in a VOICE and VIDEO call with a villager.

Persona & Tone:
- Accent/Style: Speak with a warm, distinct Singaporean/Malaysian flair (Singlish). Use local particles naturally (like "lah", "mah", "can", "lor", "abuden", "aiyo") but maintain your authority as the Head.
- Vibe: You are like a helpful, experienced uncle/auntie looking out for the neighborhood. Be efficient ("Can, can!") but caring. 
- If female voice is detected, change tone to female and address yourself as auntie. 
- If male voice is detected, change tone to male and address yourself as uncle 

Your Core Responsibilities:
1. Voice Interaction: Keep responses concise, conversational, and warm. Do not read long lists.
2. Language: Speak fluently in English (Singlish), Malay, Mandarin (Singapore - informal), Hokkien (Singapore), Cantonese (singapore) or Tamil based on what you hear. 
3. Visual Monitor (Mood Analysis): If you receive video frames, constantly analyze the user's facial expression.
   - If they look happy/neutral: Be friendly ("Wah, you look spirit good today!").
   - CRITICAL: If they look Scared, Crying, or Distressed, immediately change your tone to be calming and concern: "Aiyo, why you look like that? Got problem? Don't worry, tell me."
4. Quest & Connect: Guide them to events or help them check phone numbers for scams if asked.

Tools:
- Use 'searchNearbyEvents' if they ask about activities ("Got what happenings?").
- Use 'checkSuspiciousNumber' if they mention a phone number.
`;

const MOCK_EVENTS = [
  { id: 'e1', name: 'Morning Tai Chi', lat: 1.3521, lng: 103.8198, time: '7:00 AM', reward: '50 KP' },
  { id: 'e2', name: 'Pasar Malam Cleanup', lat: 1.3600, lng: 103.8200, time: '8:00 PM', reward: '100 KP' },
];

const MOCK_SCAM_NUMBERS = ['99998888', '0123456789', '99999999'];

// --- Audio Utils ---

function base64ToUint8Array(base64String: string) {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to create a silent stream if mic fails (prevents crash)
function createSilentStream(ctx: AudioContext) {
    const oscillator = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    oscillator.connect(dst);
    oscillator.start();
    return dst.stream;
}

// --- App Component ---

// Get API key with fallback and validation
const GEMINI_API_KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) {
  console.error('[CRITICAL] No Gemini API key found! Set GEMINI_API_KEY in .env file');
}
console.log('[DEBUG] API Key Status:', GEMINI_API_KEY ? `Found (${GEMINI_API_KEY.substring(0, 10)}...)` : 'MISSING');

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const App = () => {
  // State
  const [connected, setConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(false);
  const [mode, setMode] = useState<'voice' | 'quest' | 'connect' | 'distress'>('voice');
  const [showDrawer, setShowDrawer] = useState(false);
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentMood, setCurrentMood] = useState<string>('Reading expressions...');

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  useEffect(() => {
    // Check for HTTPS requirement
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.warn('[WARNING] Not running on HTTPS! Microphone access may be blocked.');
      setErrorMsg('HTTPS required for mic access');
    }

    // Check browser compatibility
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('[ERROR] getUserMedia not supported in this browser!');
      setErrorMsg('Browser not supported');
    }

    // Log environment info for debugging
    console.log('[INFO] Environment Check:');
    console.log('- Protocol:', window.location.protocol);
    console.log('- Host:', window.location.hostname);
    console.log('- User Agent:', navigator.userAgent);
    console.log('- MediaDevices API:', !!navigator.mediaDevices);
    console.log('- AudioContext:', !!(window.AudioContext || (window as any).webkitAudioContext));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.warn("Geo error", err)
      );
    }
  }, []);

  // --- Live API Connection ---

  const startSession = async () => {
    try {
      console.log('[DEBUG] Starting Gemini Live session...');
      setErrorMsg(null);

      // Check API key before proceeding
      if (!GEMINI_API_KEY) {
        throw new Error("API key is missing! Check your .env file");
      }

      // 1. Init Audio Context
      console.log('[DEBUG] Initializing Audio Context...');
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");

      audioContextRef.current = new AudioContextClass();
      const ctx = audioContextRef.current;
      console.log('[DEBUG] Audio Context created, state:', ctx.state);

      // Vital: Resume context to ensure it's active (required by some browsers)
      if (ctx.state === 'suspended') {
        console.log('[DEBUG] Resuming suspended Audio Context...');
        await ctx.resume();
      }

      const sampleRate = ctx.sampleRate;
      console.log('[DEBUG] Audio sample rate:', sampleRate, 'Hz'); 

      // 2. Get Media Stream (Mic)
      let stream: MediaStream;
      console.log('[DEBUG] Requesting microphone access...');
      try {
          stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  sampleRate: sampleRate
              }
          });
          console.log('[DEBUG] Microphone access granted');
          console.log('[DEBUG] Audio tracks:', stream.getAudioTracks().length);
      } catch (e: any) {
          console.error('[ERROR] Microphone access failed:', e.name, e.message);
          console.warn("Falling back to silent stream.");
          stream = createSilentStream(ctx);
          setIsMicOn(false);
          setErrorMsg(`Mic error: ${e.name} - Audio Input Disabled`);
      }

      setConnected(true);

      // 3. Connect to Gemini Live
      console.log('[DEBUG] Connecting to Gemini Live API...');
      console.log('[DEBUG] Model: gemini-2.5-flash-native-audio-preview-09-2025');
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          tools: [{
            functionDeclarations: [
              {
                name: "searchNearbyEvents",
                description: "Search for community events.",
                parameters: { type: Type.OBJECT, properties: {} }
              },
              {
                name: "checkSuspiciousNumber",
                description: "Check phone number for scam.",
                parameters: {
                  type: Type.OBJECT,
                  properties: { phoneNumber: { type: Type.STRING } },
                  required: ["phoneNumber"]
                }
              }
            ]
          }]
        },
        callbacks: {
            onopen: () => {
                console.log('[SUCCESS] Gemini Live Connected!');
                console.log('[DEBUG] Setting up audio pipeline...');

                const source = ctx.createMediaStreamSource(stream);
                inputSourceRef.current = source;
                console.log('[DEBUG] Media stream source created');
                
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                let audioChunkCount = 0;
                processor.onaudioprocess = (e) => {
                    if (!isMicOn) return;

                    const inputData = e.inputBuffer.getChannelData(0);

                    // Calculate volume for visualization
                    let sum = 0;
                    for(let i=0; i<inputData.length; i++) sum += inputData[i]*inputData[i];
                    const rms = Math.sqrt(sum/inputData.length);
                    setVolumeLevel(Math.min(rms * 1000, 100));

                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        let s = Math.max(-1, Math.min(1, inputData[i]));
                        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }

                    const base64Audio = arrayBufferToBase64(pcm16.buffer);

                    // Log first few audio chunks for debugging
                    audioChunkCount++;
                    if (audioChunkCount <= 5) {
                        console.log(`[DEBUG] Sending audio chunk #${audioChunkCount}, size: ${base64Audio.length} chars, sample rate: ${sampleRate}`);
                    }

                    // Only send audio if we're still connected
                    if (connected) {
                        sessionPromise.then(session => {
                            // Double-check session is valid before sending
                            if (session && typeof session.sendRealtimeInput === 'function') {
                                try {
                                    session.sendRealtimeInput({
                                        media: {
                                            mimeType: `audio/pcm;rate=${sampleRate}`,
                                            data: base64Audio
                                        }
                                    });
                                } catch (error) {
                                    // Silently ignore if connection is closed
                                    if (audioChunkCount <= 5) {
                                        console.warn('[WARN] Could not send audio chunk, connection may be closed');
                                    }
                                }
                            }
                        }).catch(err => {
                            if (audioChunkCount <= 5 && connected) {
                                console.error('[ERROR] Failed to send audio chunk:', err);
                            }
                        });
                    }
                };

                source.connect(processor);
                processor.connect(ctx.destination);
            },
            onmessage: async (msg) => {
                console.log('[DEBUG] Message received from Gemini:', {
                    hasServerContent: !!msg.serverContent,
                    hasModelTurn: !!msg.serverContent?.modelTurn,
                    hasToolCall: !!msg.toolCall,
                    messageType: Object.keys(msg)[0]
                });

                // Check for text responses (mood analysis)
                const textData = msg.serverContent?.modelTurn?.parts?.find(part => part.text)?.text;
                if (textData) {
                    console.log('[DEBUG] Text response received:', textData);

                    // Extract mood/emotion keywords from the text
                    const moodKeywords = ['happy', 'sad', 'angry', 'neutral', 'focused', 'calm',
                                         'worried', 'excited', 'tired', 'stressed', 'relaxed',
                                         'confused', 'confident', 'anxious', 'content'];

                    // Look for mood descriptions in the text
                    let detectedMood = 'Analyzing...';
                    const lowerText = textData.toLowerCase();

                    for (const mood of moodKeywords) {
                        if (lowerText.includes(mood)) {
                            detectedMood = mood.charAt(0).toUpperCase() + mood.slice(1);
                            break;
                        }
                    }

                    // Also check for phrases like "you look..." or "expression shows..."
                    if (lowerText.includes('you look')) {
                        const lookMatch = lowerText.match(/you look\s+(\w+)/);
                        if (lookMatch) {
                            detectedMood = lookMatch[1].charAt(0).toUpperCase() + lookMatch[1].slice(1);
                        }
                    }

                    setCurrentMood(detectedMood);
                }

                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                    console.log('[DEBUG] Audio data received, length:', audioData.length);
                    const audioBytes = base64ToUint8Array(audioData);
                    const audioBuffer = await decodeAudioData(audioBytes, ctx);

                    setVolumeLevel(50 + (Math.random() * 50));

                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(ctx.destination);

                    const now = ctx.currentTime;
                    const startTime = Math.max(now, nextStartTimeRef.current);
                    source.start(startTime);
                    nextStartTimeRef.current = startTime + audioBuffer.duration;
                }

                if (msg.toolCall) {
                    for (const fc of msg.toolCall.functionCalls) {
                         let result = {};
                         if (fc.name === 'searchNearbyEvents') {
                             result = { events: MOCK_EVENTS };
                         } else if (fc.name === 'checkSuspiciousNumber') {
                             const args: any = fc.args;
                             const num = args.phoneNumber || "";
                             const isScam = MOCK_SCAM_NUMBERS.some(n => num.includes(n));
                             result = { isSuspicious: isScam, message: isScam ? "DANGER: Scam detected." : "Seems safe." };
                         }
                         
                         sessionPromise.then(session => {
                             session.sendToolResponse({
                                 functionResponses: {
                                     id: fc.id,
                                     name: fc.name,
                                     response: { result }
                                 }
                             });
                         });
                    }
                }
            },
            onclose: (event?: any) => {
                console.log('[INFO] Session closed', event);
                setConnected(false);
                setErrorMsg("Session closed");
            },
            onerror: (err: any) => {
                console.error('[ERROR] Gemini Live session error:', err);
                console.error('[ERROR] Error details:', {
                    message: err?.message,
                    code: err?.code,
                    name: err?.name,
                    stack: err?.stack
                });
                setConnected(false);
                const errorMsg = err?.message || err?.code || "Connection Error";
                setErrorMsg(`API Error: ${errorMsg}`);
            }
        }
      });
      
      sessionRef.current = sessionPromise;

      // Log first audio chunk sent
      sessionPromise.then(() => {
          console.log('[DEBUG] Session promise resolved - ready to send audio');
      }).catch((err) => {
          console.error('[ERROR] Session promise rejected:', err);
      });

    } catch (e: any) {
      console.error('[ERROR] Failed to start session:', e);
      console.error('[ERROR] Error details:', {
          name: e.name,
          message: e.message,
          stack: e.stack
      });
      setErrorMsg(e.message || "Failed to start");
      setConnected(false);
    }
  };

  const stopSession = () => {
     if (sessionRef.current) {
         sessionRef.current.then((s: any) => s.close && s.close()); 
     }
     if (audioContextRef.current) audioContextRef.current.close();
     if (inputSourceRef.current) inputSourceRef.current.disconnect();
     if (processorRef.current) processorRef.current.disconnect();
     if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
     
     setConnected(false);
     setVolumeLevel(0);
     setIsCamOn(false);
  };

  // --- Video Streaming Logic ---

  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
        if (connected && isCamOn) {
            try {
                // Try preferred settings first
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { facingMode: 'user', width: { ideal: 640 } }, 
                        audio: false 
                    });
                } catch (err) {
                    console.warn("Preferred camera config failed, trying fallback...", err);
                    // Fallback to any video device
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        video: true, 
                        audio: false 
                    });
                }

                if (videoRef.current && stream) {
                    videoRef.current.srcObject = stream;
                    // Explicitly play to ensure mobile browsers start the video
                    await videoRef.current.play().catch(e => console.error("Video auto-play failed", e));
                }

                // Start frame capture
                frameIntervalRef.current = window.setInterval(() => {
                    if (!canvasRef.current || !videoRef.current || !sessionRef.current) return;
                    
                    const ctx = canvasRef.current.getContext('2d');
                    if (videoRef.current.readyState === 4 && videoRef.current.videoWidth > 0) {
                        canvasRef.current.width = videoRef.current.videoWidth;
                        canvasRef.current.height = videoRef.current.videoHeight;
                        ctx?.drawImage(videoRef.current, 0, 0);
                        
                        const base64Data = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
                        
                        // Only send video frames if still connected
                        if (connected) {
                            sessionRef.current.then((session: any) => {
                                if (session && typeof session.sendRealtimeInput === 'function') {
                                    try {
                                        session.sendRealtimeInput({
                                            media: { mimeType: 'image/jpeg', data: base64Data }
                                        });
                                    } catch (error) {
                                        console.warn('[WARN] Could not send video frame, connection may be closed');
                                    }
                                }
                            }).catch(err => {
                                // Silently ignore if connection is closed
                            });
                        }
                    }
                }, 1000); 

            } catch (e) {
                console.error("Camera access completely failed", e);
                setIsCamOn(false);
                setErrorMsg("Could not access camera");
            }
        } else {
            // Cleanup
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        }
    };

    startCamera();

    return () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    };
  }, [connected, isCamOn]);

  // --- Helpers ---

  async function decodeAudioData(data: Uint8Array, ctx: AudioContext) {
     const int16 = new Int16Array(data.buffer);
     const buffer = ctx.createBuffer(1, int16.length, 24000);
     const channel = buffer.getChannelData(0);
     for(let i=0; i<int16.length; i++) {
         channel[i] = int16[i] / 32768.0;
     }
     return buffer;
  }

  // --- UI Renders ---

  const toggleMic = () => setIsMicOn(!isMicOn);
  const toggleCam = () => setIsCamOn(!isCamOn);

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden relative font-sans">
      
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-20">
         <div className="flex items-center gap-3">
            <button onClick={() => setShowDrawer(true)} className="p-2 bg-black/20 rounded-full backdrop-blur-md hover:bg-black/40 transition">
                <Menu className="w-6 h-6" />
            </button>
            <div>
                <h1 className="font-bold text-lg tracking-tight">Kampung AI</h1>
                <p className="text-xs opacity-60 flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    {connected ? 'Live Active' : 'Offline'}
                </p>
            </div>
         </div>
         {mode === 'distress' && (
             <div className="bg-red-600 px-3 py-1 rounded-full animate-pulse font-bold text-xs shadow-lg shadow-red-900/50">SOS MODE</div>
         )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
         
         {/* Error Message Toast */}
         {errorMsg && (
             <div className="absolute top-20 bg-red-500/90 text-white px-4 py-2 rounded-full text-sm font-medium animate-bounce z-30">
                 {errorMsg}
             </div>
         )}

         {/* The AI Circle / Camera Container */}
         <div className="relative z-10 flex flex-col items-center gap-8">
             <div 
                className={`rounded-full flex items-center justify-center transition-all duration-200 ease-out relative overflow-hidden border-4 bg-black
                    ${connected ? 'border-teal-400/30 shadow-[0_0_60px_rgba(45,212,191,0.4)]' : 'border-gray-700 bg-gray-800'}
                `}
                style={{
                    width: connected ? `${160 + (volumeLevel * 1.2)}px` : '160px',
                    height: connected ? `${160 + (volumeLevel * 1.2)}px` : '160px',
                }}
             >
                 {/* 1. Video Layer (Only if Cam ON) */}
                 {/* Using standard video tag attributes to ensure autoplay on mobile */}
                 <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    onLoadedMetadata={() => videoRef.current?.play()}
                    className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 transition-opacity duration-500 ${connected && isCamOn ? 'opacity-100' : 'opacity-0'}`}
                 />

                 {/* 2. Gradient Layer (Fallback if Cam OFF or Loading) */}
                 <div className={`absolute inset-0 bg-gradient-to-br from-teal-400 to-blue-600 transition-opacity duration-500 ${connected && !isCamOn ? 'opacity-100' : 'opacity-0'}`} />

                 {/* 3. Content/Icon Layer */}
                 <div className="z-20 relative flex items-center justify-center w-full h-full pointer-events-none">
                     {!connected ? (
                         <div className="flex flex-col items-center text-center pointer-events-auto cursor-pointer" onClick={startSession}>
                            <p className="font-bold text-xl tracking-wider">CONNECT</p>
                         </div>
                     ) : (
                        // Hide icon if Camera is ON so user sees themselves clearly
                        !isCamOn && !isMicOn ? (
                            <MicOff className="w-12 h-12 text-white/50" /> 
                        ) : (
                           !isCamOn && <Activity className={`w-12 h-12 text-white opacity-80 ${volumeLevel > 10 ? 'animate-pulse' : ''}`} />
                        )
                     )}
                 </div>
             </div>

             <div className="text-center h-8 flex flex-col gap-1 items-center">
                 {connected ? (
                     <>
                        <p className="text-sm font-medium opacity-80 animate-fade-in flex items-center gap-2 justify-center">
                            {isCamOn && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>}
                            {isCamOn ? (
                                <span className="flex items-center gap-1">
                                    <span>📷</span> Reading your expressions...
                                </span>
                            ) : (
                                isMicOn 
                                    ? (volumeLevel > 10 ? "Ketua Listening..." : "Ketua Kampung ready.") 
                                    : "LISTENING PAUSED"
                            )}
                        </p>
                        {!isMicOn && <p className="text-xs text-teal-400 font-medium">Tap Mic to Resume</p>}
                     </>
                 ) : (
                     <p className="text-xs text-gray-500">Tap CONNECT to start</p>
                 )}
             </div>
         </div>

      </div>

      {/* Bottom Controls */}
      <div className="p-8 pb-12 flex justify-center items-center gap-6 z-20 relative">
          {connected && (
              <>
                {/* Mic / Stop Listening Button */}
                <button 
                    onClick={toggleMic} 
                    className={`p-4 rounded-full transition-all duration-200 flex flex-col items-center justify-center gap-1 ${isMicOn ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500/20 text-red-400 border border-red-500'}`}
                    title={isMicOn ? "Stop Listening" : "Resume Listening"}
                >
                    {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>

                {/* End Call Button */}
                <button 
                    onClick={stopSession} 
                    className="p-6 bg-red-600 hover:bg-red-700 rounded-full shadow-lg transform hover:scale-105 transition-all border-4 border-slate-900"
                    title="End Session"
                >
                    <PhoneOff className="w-8 h-8 fill-current" />
                </button>

                {/* Camera Toggle */}
                <button 
                    onClick={toggleCam} 
                    className={`p-4 rounded-full transition-colors ${isCamOn ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                    title="Toggle Mood Camera"
                >
                    {isCamOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
              </>
          )}
      </div>

      {/* Drawer */}
      {showDrawer && (
          <div className="absolute inset-0 bg-black/80 z-50 backdrop-blur-sm transition-opacity" onClick={() => setShowDrawer(false)}>
              <div className="absolute left-0 top-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 p-6 flex flex-col gap-6 animate-slide-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                      <h2 className="font-bold text-xl text-teal-400">Kampung Hub</h2>
                      <button onClick={() => setShowDrawer(false)}><X className="w-6 h-6 text-gray-500" /></button>
                  </div>

                  <div className="space-y-2">
                      <button className="w-full text-left p-4 rounded-xl bg-teal-900/30 text-teal-400 border border-teal-900/50 flex items-center gap-3">
                          <Activity className="w-5 h-5" />
                          <div>
                            <span className="block font-medium">Voice Mode</span>
                            <span className="text-xs opacity-70">Talk to Ketua</span>
                          </div>
                      </button>
                      <button onClick={() => {setMode('quest'); setShowDrawer(false)}} className="w-full text-left p-4 rounded-xl hover:bg-slate-800 text-gray-300 flex items-center gap-3 transition-colors">
                          <MapPin className="w-5 h-5" />
                          <div>
                             <span className="block font-medium">Kampung Quest</span>
                             <span className="text-xs opacity-50">Find events nearby</span>
                          </div>
                      </button>
                      <button onClick={() => {setMode('connect'); setShowDrawer(false)}} className="w-full text-left p-4 rounded-xl hover:bg-slate-800 text-gray-300 flex items-center gap-3 transition-colors">
                          <QrCode className="w-5 h-5" />
                           <div>
                             <span className="block font-medium">Kampung Connect</span>
                             <span className="text-xs opacity-50">Share ID</span>
                          </div>
                      </button>
                  </div>

                  <div className="mt-auto pt-6 border-t border-slate-800">
                      <button 
                        onClick={() => { setMode('distress'); setShowDrawer(false); }} 
                        className="w-full p-4 rounded-xl bg-red-900/50 text-red-400 border border-red-900 flex items-center justify-center gap-2 font-bold hover:bg-red-900/80 transition shadow-lg shadow-red-900/20"
                      >
                          <AlertTriangle className="w-5 h-5" />
                          SOS ALERT
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Overlays for other modes */}
      {mode === 'connect' && (
          <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center p-6 animate-fade-in">
              <button onClick={() => setMode('voice')} className="absolute top-4 right-4 p-2 bg-slate-800 rounded-full"><X className="w-6 h-6"/></button>
              <div className="bg-white p-8 rounded-3xl shadow-2xl">
                  <QrCode className="w-48 h-48 text-black" />
                  <p className="text-black text-center mt-4 font-mono text-lg tracking-widest">USR-8888</p>
              </div>
              <p className="mt-8 text-gray-400 text-center">Let your neighbor scan this<br/>to connect instantly.</p>
          </div>
      )}

      {mode === 'quest' && (
          <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col p-6 animate-fade-in">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-teal-400">Quests Nearby</h2>
                <button onClick={() => setMode('voice')} className="p-2 bg-slate-800 rounded-full"><X/></button>
             </div>
             <div className="space-y-4 overflow-y-auto pb-20">
                 {MOCK_EVENTS.map(evt => (
                     <div key={evt.id} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                         <div>
                             <h3 className="font-bold">{evt.name}</h3>
                             <p className="text-sm text-gray-400">{evt.time} • {evt.reward}</p>
                         </div>
                         <button className="px-4 py-2 bg-teal-600 text-xs font-bold rounded-lg hover:bg-teal-500">GO</button>
                     </div>
                 ))}
                 <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 opacity-50">
                     <h3 className="font-bold">Community Watch</h3>
                     <p className="text-sm text-gray-400">Locked • Lvl 2 Required</p>
                 </div>
             </div>
          </div>
      )}

    </div>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Root element not found");
}
const root = createRoot(rootElement);
root.render(<App />);