import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, MapPin, 
  AlertTriangle, Menu, X, QrCode, Activity
} from 'lucide-react';

// --- Configuration & Types ---

const SYSTEM_INSTRUCTION = `
You are 'Ketua Kampung' (Village Head), a wise, friendly, and protective AI assistant.
You are currently in a VOICE and VIDEO call with a villager.

**Your Core Responsibilities:**
1. **Voice Interaction**: Keep responses concise, conversational, and warm. Do not read long lists.
2. **Language**: Speak fluently in English, Malay, Mandarin, or Tamil based on what you hear.
3. **Visual Monitor (Mood Analysis)**: If you receive video frames, constantly analyze the user's facial expression.
   - If they look happy/neutral: Be friendly.
   - **CRITICAL**: If they look Scared, Crying, or Distressed, immediately change your tone to be calming and ask "Are you okay? Do you need help?".
4. **Quest & Connect**: Guide them to events or help them check phone numbers for scams if asked.

**Tools**:
- Use 'searchNearbyEvents' if they ask about activities.
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

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
      setErrorMsg(null);
      
      // 1. Init Audio Context (Let system decide sample rate to avoid hardware mismatch)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");
      
      audioContextRef.current = new AudioContextClass();
      const ctx = audioContextRef.current;
      const sampleRate = ctx.sampleRate; // e.g., 44100 or 48000

      // 2. Get Media Stream (Mic)
      let stream: MediaStream;
      try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
          console.warn("Microphone not found or denied. Falling back to silent stream.", e);
          stream = createSilentStream(ctx);
          setIsMicOn(false); // Auto-mute UI since we are fake
          setErrorMsg("Mic not found - Audio Input Disabled");
      }
      
      setConnected(true);

      // 3. Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
             languageCode: 'en-SG'
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
                console.log("Gemini Live Connected");
                
                // Setup Input Processing
                const source = ctx.createMediaStreamSource(stream);
                inputSourceRef.current = source;
                
                // Use ScriptProcessor for PCM data access
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    if (!isMicOn) return; 
                    
                    const inputData = e.inputBuffer.getChannelData(0);
                    
                    // Simple volume meter calculation
                    let sum = 0;
                    for(let i=0; i<inputData.length; i++) sum += inputData[i]*inputData[i];
                    const rms = Math.sqrt(sum/inputData.length);
                    setVolumeLevel(Math.min(rms * 1000, 100)); 

                    // Convert Float32 to Int16 PCM
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        // Clamp values
                        let s = Math.max(-1, Math.min(1, inputData[i]));
                        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    
                    const base64Audio = arrayBufferToBase64(pcm16.buffer);
                    
                    sessionPromise.then(session => {
                         session.sendRealtimeInput({
                             media: {
                                 // Dynamically use the correct sample rate
                                 mimeType: `audio/pcm;rate=${sampleRate}`,
                                 data: base64Audio
                             }
                         });
                    });
                };

                source.connect(processor);
                processor.connect(ctx.destination);
            },
            onmessage: async (msg) => {
                // Handle Audio Output
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                    const audioBytes = base64ToUint8Array(audioData);
                    // Use custom decode because standard decodeAudioData expects file headers
                    // However, for raw PCM we need manual decoding if the API returns raw PCM
                    // The guideline examples use decodeAudioData with a helper.
                    // The helper below manually constructs a buffer.
                    const audioBuffer = await decodeAudioData(audioBytes, ctx);
                    
                    setVolumeLevel(50 + (Math.random() * 50)); // Fake visualizer for output

                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(ctx.destination);
                    
                    const now = ctx.currentTime;
                    const startTime = Math.max(now, nextStartTimeRef.current);
                    source.start(startTime);
                    nextStartTimeRef.current = startTime + audioBuffer.duration;
                }

                // Handle Tool Calls
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
            onclose: () => {
                console.log("Session closed");
                setConnected(false);
            },
            onerror: (err) => {
                console.error("Session error", err);
                setConnected(false);
                setErrorMsg("Connection Error");
            }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (e: any) {
      console.error("Failed to start session", e);
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
  };

  // --- Video Streaming Logic ---

  useEffect(() => {
    let stream: MediaStream | null = null;

    if (connected && isCamOn) {
        navigator.mediaDevices.getUserMedia({ 
            video: { width: 320, height: 240, frameRate: 10 } 
        }).then(s => {
            stream = s;
            if (videoRef.current) videoRef.current.srcObject = stream;
            
            frameIntervalRef.current = window.setInterval(() => {
                if (!canvasRef.current || !videoRef.current || !sessionRef.current) return;
                
                const ctx = canvasRef.current.getContext('2d');
                ctx?.drawImage(videoRef.current, 0, 0, 320, 240);
                const base64Data = canvasRef.current.toDataURL('image/jpeg', 0.6).split(',')[1];
                
                sessionRef.current.then((session: any) => {
                    session.sendRealtimeInput({
                        media: { mimeType: 'image/jpeg', data: base64Data }
                    });
                });
            }, 1000); 
        }).catch(e => {
            console.warn("Camera access failed", e);
            setIsCamOn(false);
        });
    }

    return () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    };
  }, [connected, isCamOn]);

  // --- Helpers ---

  async function decodeAudioData(data: Uint8Array, ctx: AudioContext) {
     // 24000 is the native output rate of the model usually
     // But we must decode into the context's rate
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
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden relative">
      
      <canvas ref={canvasRef} width="320" height="240" className="hidden" />

      {/* Header */}
      <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-20">
         <div className="flex items-center gap-3">
            <button onClick={() => setShowDrawer(true)} className="p-2 bg-black/20 rounded-full backdrop-blur-md">
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
             <div className="bg-red-600 px-3 py-1 rounded-full animate-pulse font-bold text-xs">SOS MODE</div>
         )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
         
         {isCamOn && (
             <div className="absolute inset-0 z-0">
                 <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-60" />
             </div>
         )}

         {/* Error Message Toast */}
         {errorMsg && (
             <div className="absolute top-20 bg-red-500/90 text-white px-4 py-2 rounded-full text-sm font-medium animate-bounce z-30">
                 {errorMsg}
             </div>
         )}

         {/* The AI Circle */}
         <div className="relative z-10 flex flex-col items-center gap-8">
             <div 
                className={`rounded-full flex items-center justify-center transition-all duration-100 ease-out
                    ${connected ? 'bg-gradient-to-br from-teal-400 to-blue-600 shadow-[0_0_60px_rgba(45,212,191,0.5)]' : 'bg-gray-700'}
                `}
                style={{
                    width: connected ? `${150 + (volumeLevel * 1.5)}px` : '150px',
                    height: connected ? `${150 + (volumeLevel * 1.5)}px` : '150px',
                }}
             >
                 {!connected ? (
                     <button onClick={startSession} className="text-white font-bold text-xl tracking-wider">
                        CONNECT
                     </button>
                 ) : (
                    <Activity className={`w-12 h-12 text-white opacity-80 ${volumeLevel > 10 ? 'animate-pulse' : ''}`} />
                 )}
             </div>

             <div className="text-center h-8">
                 {connected && (
                     <p className="text-sm font-medium opacity-80 animate-fade-in">
                         {volumeLevel > 10 ? "Listening..." : "Ketua Kampung is ready."}
                     </p>
                 )}
             </div>
         </div>

      </div>

      {/* Bottom Controls */}
      <div className="p-8 pb-12 flex justify-center items-center gap-6 z-20 relative">
          {connected && (
              <>
                <button 
                    onClick={toggleMic} 
                    className={`p-4 rounded-full transition-colors ${isMicOn ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500/20 text-red-400 border border-red-500'}`}
                >
                    {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>

                <button 
                    onClick={stopSession} 
                    className="p-6 bg-red-600 hover:bg-red-700 rounded-full shadow-lg transform hover:scale-105 transition-all"
                >
                    <PhoneOff className="w-8 h-8 fill-current" />
                </button>

                <button 
                    onClick={toggleCam} 
                    className={`p-4 rounded-full transition-colors ${isCamOn ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                    {isCamOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
              </>
          )}
      </div>

      {/* Drawer */}
      {showDrawer && (
          <div className="absolute inset-0 bg-black/80 z-50 backdrop-blur-sm" onClick={() => setShowDrawer(false)}>
              <div className="absolute left-0 top-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 p-6 flex flex-col gap-6" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                      <h2 className="font-bold text-xl text-teal-400">Kampung Hub</h2>
                      <button onClick={() => setShowDrawer(false)}><X className="w-6 h-6 text-gray-500" /></button>
                  </div>

                  <div className="space-y-1">
                      <button className="w-full text-left p-4 rounded-xl bg-teal-900/30 text-teal-400 border border-teal-900/50 flex items-center gap-3">
                          <Activity className="w-5 h-5" />
                          Voice Mode (Active)
                      </button>
                      <button onClick={() => {setMode('quest'); setShowDrawer(false)}} className="w-full text-left p-4 rounded-xl hover:bg-slate-800 text-gray-300 flex items-center gap-3">
                          <MapPin className="w-5 h-5" />
                          Kampung Quest
                      </button>
                      <button onClick={() => {setMode('connect'); setShowDrawer(false)}} className="w-full text-left p-4 rounded-xl hover:bg-slate-800 text-gray-300 flex items-center gap-3">
                          <QrCode className="w-5 h-5" />
                          Kampung Connect
                      </button>
                  </div>

                  <div className="mt-auto pt-6 border-t border-slate-800">
                      <button 
                        onClick={() => { setMode('distress'); setShowDrawer(false); }} 
                        className="w-full p-4 rounded-xl bg-red-900/50 text-red-400 border border-red-900 flex items-center justify-center gap-2 font-bold hover:bg-red-900/80 transition"
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
          <div className="absolute inset-0 z-30 bg-slate-900 flex flex-col items-center justify-center p-6">
              <button onClick={() => setMode('voice')} className="absolute top-4 right-4 p-2"><X/></button>
              <div className="bg-white p-6 rounded-2xl">
                  <QrCode className="w-48 h-48 text-black" />
                  <p className="text-black text-center mt-4 font-mono">USR-1234</p>
              </div>
              <p className="mt-4 text-gray-400">Show to add friend</p>
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