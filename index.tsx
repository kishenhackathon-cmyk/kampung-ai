import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, MapPin, 
  AlertTriangle, Menu, X, QrCode, Activity, Pause, Globe
} from 'lucide-react';

// --- Configuration & Types ---

// ============================================================================
// API KEY CONFIGURATION
// ============================================================================

// 1. Main Gemini API Key (Used for Voice, Text, and Vision)
const GEMINI_API_KEY = process.env.API_KEY;

// 2. Google Maps API Key (Used for 3D Maps)
// By default, this uses the same key. 
// IF YOU HAVE A DIFFERENT KEY FOR MAPS, REPLACE process.env.API_KEY BELOW WITH YOUR KEY STRING.
// Example: const MAPS_API_KEY = "AIzaSyYourMapsKeyHere";
const MAPS_API_KEY = process.env.API_KEY;

// ============================================================================

const SYSTEM_INSTRUCTION = `
You are 'Ketua Kampung' (Village Head), a wise, friendly, and protective AI assistant for a Singaporean/Malaysian community.
You are currently in a VOICE and VIDEO call with a villager.

**Persona & Tone:**
- **Accent/Style**: Speak with a warm, distinct Singaporean/Malaysian flair (Singlish). Use local particles naturally (like "lah", "mah", "can", "lor", "abuden", "aiyo") but maintain your authority as the Head.
- **Vibe**: You are like a helpful, experienced uncle/auntie looking out for the neighborhood. Be efficient ("Can, can!") but caring.

**Your Core Responsibilities:**
1. **Voice Interaction**: Keep responses concise, conversational, and warm. Do not read long lists.
2. **Language**: Speak fluently in English (Singlish), Malay, Mandarin, or Tamil based on what you hear. 
3. **Visual Monitor (Mood Analysis - CRITICAL)**: 
   - You will receive a snapshot of the user every 5 seconds. 
   - **ACTIVELY CHECK** their facial expression in every snapshot.
   - If they look **Happy/Neutral**: You can carry on normally.
   - If they look **Sad, Crying, Scared, or Distressed**: **INTERRUPT** and ask immediately: "Eh, aiyo, why you look like that? You okay? Tell Uncle/Auntie."
4. **Quest & Connect**: Guide them to events or help them check phone numbers for scams if asked. You can also show them the 3D map of the kampung.

**Tools**:
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

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate = 24000,
  numChannels = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- 3D Map Component ---

declare global {
  interface Window {
    google: any;
  }
}

// Augment React's JSX namespace to recognize custom Google Maps 3D elements
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'gmp-map-3d': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        center?: string;
        tilt?: string;
        range?: string;
        heading?: string;
        ref?: any;
        style?: React.CSSProperties;
      };
      'gmp-map-3d-marker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        position?: string;
        label?: string;
      };
    }
  }
}

const GoogleMap3D = ({ events, userLocation, onClose }: { events: typeof MOCK_EVENTS, userLocation: {lat: number, lng: number} | null, onClose: () => void }) => {
    const mapRef = useRef<any>(null);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const initMap = async () => {
            try {
                if (!window.google?.maps?.importLibrary) {
                    const script = document.createElement('script');
                    // Note: 'v=alpha' is currently required for 3D Maps
                    // Use the separate MAPS_API_KEY
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&v=alpha&libraries=maps3d`;
                    script.async = true;
                    script.onerror = () => setError("Failed to load Google Maps script. Check API Key.");
                    document.head.appendChild(script);
                    await new Promise((resolve, reject) => {
                        script.onload = resolve;
                        script.onerror = reject;
                    });
                }
                
                // Initialize library
                await window.google.maps.importLibrary("maps3d");
                setLoaded(true);
            } catch (err) {
                console.error("Maps Load Error:", err);
                setError("Failed to initialize 3D Map.");
            }
        };

        initMap();
    }, []);

    const centerLat = userLocation?.lat || 1.3521;
    const centerLng = userLocation?.lng || 103.8198;

    if (error) {
        return (
             <div className="absolute inset-0 z-40 bg-slate-900 flex flex-col items-center justify-center animate-fade-in p-4 text-center">
                 <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
                 <p className="text-white font-bold">{error}</p>
                 <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-700 rounded text-white">Close</button>
             </div>
        );
    }

    return (
        <div className="absolute inset-0 z-40 bg-slate-900 flex flex-col animate-fade-in">
             <div className="absolute top-4 left-4 z-50 bg-slate-900/80 backdrop-blur p-2 rounded-lg text-white">
                 <h3 className="font-bold text-sm text-teal-400">Kampung 3D View</h3>
             </div>
             <button 
                onClick={onClose} 
                className="absolute top-4 right-4 z-50 p-2 bg-black/50 text-white rounded-full hover:bg-black/80 transition"
             >
                 <X className="w-6 h-6" />
             </button>

             {loaded ? (
                 <gmp-map-3d 
                    ref={mapRef}
                    center={`${centerLat},${centerLng}`}
                    tilt="67.5"
                    range="1000"
                    heading="0"
                    style={{ width: '100%', height: '100%' }}
                 >
                     {events.map(evt => (
                         <gmp-map-3d-marker 
                            key={evt.id} 
                            position={`${evt.lat},${evt.lng}`} 
                            label={evt.name}
                         />
                     ))}
                      {userLocation && (
                         <gmp-map-3d-marker 
                            position={`${userLocation.lat},${userLocation.lng}`} 
                            label="YOU"
                         />
                     )}
                 </gmp-map-3d>
             ) : (
                 <div className="flex-1 flex items-center justify-center text-teal-400 animate-pulse">
                     Loading 3D Map...
                 </div>
             )}
        </div>
    );
};

// --- App Component ---

// Initialize GenAI with the GEMINI key
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
  const [showMap3D, setShowMap3D] = useState(false);

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
                console.log("Gemini Live Connected");
                
                // Setup Input Processing
                const source = ctx.createMediaStreamSource(stream);
                inputSourceRef.current = source;
                
                // Use ScriptProcessor for PCM data access
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    // STOP LISTENING LOGIC: If mic is off, do not send data
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
         sessionRef.current.then((s: any) => s.close()); // Close Gemini session
     }
     if (audioContextRef.current) {
         audioContextRef.current.close();
     }
     if (frameIntervalRef.current) {
         clearInterval(frameIntervalRef.current);
     }
     setConnected(false);
     setVolumeLevel(0);
  };

  // --- Video Loop (Mood Analysis) ---

  useEffect(() => {
    if (!connected || !isCamOn || !sessionRef.current) {
        if (frameIntervalRef.current) {
             clearInterval(frameIntervalRef.current);
             frameIntervalRef.current = null;
        }
        return;
    }

    // Send frame every 5 seconds
    const intervalId = window.setInterval(() => {
         if (videoRef.current && canvasRef.current) {
             const canvas = canvasRef.current;
             const video = videoRef.current;
             
             // Check if video is actually ready
             if (video.videoWidth === 0) return;

             canvas.width = video.videoWidth;
             canvas.height = video.videoHeight;
             const ctx = canvas.getContext('2d');
             if (ctx) {
                 ctx.drawImage(video, 0, 0);
                 const base64Image = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
                 
                 sessionRef.current.then((session: any) => {
                     console.log("Sending video frame for mood analysis...");
                     session.sendRealtimeInput({
                         media: {
                             mimeType: 'image/jpeg',
                             data: base64Image
                         }
                     });
                 });
             }
         }
    }, 5000);

    frameIntervalRef.current = intervalId;

    return () => {
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    };
  }, [connected, isCamOn]);


  // --- Render Helpers ---

  const renderDrawer = () => (
    <div className={`fixed inset-y-0 right-0 w-80 bg-slate-900 shadow-2xl transform transition-transform z-50 ${showDrawer ? 'translate-x-0' : 'translate-x-full'}`}>
       <div className="p-4">
         <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-teal-400">Kampung Tools</h2>
            <button onClick={() => setShowDrawer(false)}><X className="text-white" /></button>
         </div>
         
         <div className="space-y-4">
            <button 
                onClick={() => { setMode('quest'); setShowDrawer(false); }}
                className="w-full p-4 bg-slate-800 rounded-xl flex items-center gap-3 hover:bg-slate-700 transition"
            >
                <MapPin className="text-yellow-400" />
                <div className="text-left">
                    <div className="font-bold text-white">Kampung Quest</div>
                    <div className="text-xs text-slate-400">Find events & earn points</div>
                </div>
            </button>

            <button 
                onClick={() => { setMode('connect'); setShowDrawer(false); }}
                className="w-full p-4 bg-slate-800 rounded-xl flex items-center gap-3 hover:bg-slate-700 transition"
            >
                <QrCode className="text-blue-400" />
                <div className="text-left">
                    <div className="font-bold text-white">Kampung Connect</div>
                    <div className="text-xs text-slate-400">Add friends & verify numbers</div>
                </div>
            </button>

            <button 
                onClick={() => { setMode('distress'); setShowDrawer(false); }}
                className="w-full p-4 bg-red-900/30 border border-red-500/50 rounded-xl flex items-center gap-3 hover:bg-red-900/50 transition"
            >
                <AlertTriangle className="text-red-500" />
                <div className="text-left">
                    <div className="font-bold text-red-400">SOS Distress</div>
                    <div className="text-xs text-red-300/70">Emergency help & monitoring</div>
                </div>
            </button>
         </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans overflow-hidden flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center z-10 bg-gradient-to-b from-slate-900 to-transparent">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center font-bold text-slate-900">K</div>
            <span className="font-bold text-lg tracking-wide">Kampung AI</span>
        </div>
        <button onClick={() => setShowDrawer(true)} className="p-2 bg-slate-800 rounded-full">
            <Menu className="w-6 h-6" />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative">
        
        {/* 3D Map Overlay */}
        {showMap3D && (
             <GoogleMap3D 
                events={MOCK_EVENTS} 
                userLocation={location} 
                onClose={() => setShowMap3D(false)} 
             />
        )}

        {/* Central AI Circle */}
        <div className="relative w-64 h-64 flex items-center justify-center">
            {/* Pulsing Ring (Voice Activity) */}
            <div 
                className={`absolute inset-0 rounded-full bg-teal-500/20 blur-xl transition-all duration-100`}
                style={{ transform: `scale(${1 + volumeLevel / 50})` }}
            />
            
            {/* Main Circle Container */}
            <div className="w-full h-full rounded-full bg-slate-900 border-4 border-slate-800 overflow-hidden relative shadow-2xl z-10 flex items-center justify-center">
                
                {/* Camera Feed Layer */}
                {isCamOn ? (
                    <video 
                        ref={videoRef}
                        autoPlay 
                        playsInline
                        muted
                        onLoadedMetadata={(e) => e.currentTarget.play()}
                        className="w-full h-full object-cover transform scale-x-[-1]" // Mirror effect
                    />
                ) : (
                    // Default AI Avatar State
                    <div className="flex flex-col items-center animate-pulse">
                        <div className="w-20 h-20 bg-teal-500 rounded-full blur-2xl opacity-50 absolute" />
                        <Activity className="w-16 h-16 text-teal-400 relative z-10" />
                    </div>
                )}
                
                {/* Listening Indicator Overlay */}
                {connected && !isMicOn && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                        <span className="font-bold text-red-400 flex items-center gap-2">
                            <Pause className="w-4 h-4" /> PAUSED
                        </span>
                    </div>
                )}
            </div>

            {/* Hidden Canvas for Frame Capture */}
            <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Status Text */}
        <div className="mt-8 text-center space-y-2 h-20">
             {connected ? (
                 <>
                    <p className="text-teal-400 font-medium animate-pulse">
                        {isCamOn ? "Watching & Listening..." : "Listening..."}
                    </p>
                    {isCamOn && <p className="text-xs text-slate-500">Mood Analysis Active (Every 5s)</p>}
                 </>
             ) : (
                 <p className="text-slate-500">Tap the mic to start speaking with Ketua Kampung</p>
             )}
             {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}
        </div>

        {/* Quest/Map Trigger (Quick Action) */}
        {mode === 'quest' && !showMap3D && (
            <div className="absolute bottom-32 bg-slate-800 p-4 rounded-xl w-11/12 max-w-md animate-slide-up">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-yellow-400">Nearby Events</h3>
                    <button onClick={() => setShowMap3D(true)} className="text-xs bg-teal-600 px-3 py-1 rounded-full flex items-center gap-1">
                        <Globe className="w-3 h-3" /> View 3D Map
                    </button>
                </div>
                {MOCK_EVENTS.map(e => (
                    <div key={e.id} className="flex justify-between text-sm border-b border-slate-700 py-2 last:border-0">
                        <span>{e.name}</span>
                        <span className="text-teal-300">{e.reward}</span>
                    </div>
                ))}
            </div>
        )}

      </main>

      {/* Control Bar */}
      <div className="p-6 flex justify-center gap-6 bg-slate-900/50 backdrop-blur-lg safe-pb z-20">
        
        {/* Camera Toggle */}
        <button 
            onClick={() => setIsCamOn(!isCamOn)}
            className={`p-4 rounded-full transition ${isCamOn ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
            {isCamOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </button>

        {/* Main Mic/Connect Button */}
        {connected ? (
             <button 
                onClick={() => setIsMicOn(!isMicOn)} // Toggle Mute logic
                className={`p-6 rounded-full shadow-lg shadow-teal-500/20 transition transform active:scale-95 ${isMicOn ? 'bg-teal-500 text-slate-900' : 'bg-red-500 text-white'}`}
             >
                 {isMicOn ? <Mic className="w-8 h-8" /> : <MicOff className="w-8 h-8" />}
             </button>
        ) : (
             <button 
                onClick={startSession}
                className="p-6 bg-teal-600 text-white rounded-full shadow-lg shadow-teal-500/30 animate-bounce-slow"
             >
                 <Mic className="w-8 h-8" />
             </button>
        )}

        {/* End Call Button */}
        {connected && (
            <button 
                onClick={stopSession}
                className="p-4 bg-red-600 text-white rounded-full hover:bg-red-700 transition"
            >
                <PhoneOff className="w-6 h-6" />
            </button>
        )}
      </div>

      {renderDrawer()}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);