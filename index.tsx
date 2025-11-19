import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MapPin,
  AlertTriangle, Menu, X, QrCode, Activity, Pause,
  Navigation, Search, Target, Trophy, ChevronRight, Play, LogOut
} from 'lucide-react';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { Auth } from './src/components/Auth';

// --- Configuration & Types ---

interface Quest {
  id: string;
  title: string;
  description: string;
  destination: { lat: number; lng: number; name: string };
  waypoints: Waypoint[];
  reward: string;
  distance: number;
  duration: number;
  progress: number;
  status: 'active' | 'completed' | 'available';
  type: 'exploration' | 'community' | 'emergency' | 'fitness';
}

interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  completed: boolean;
  type: 'checkpoint' | 'task' | 'bonus';
  description?: string;
}

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
Respond in the language that you hear 

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

// --- Quest System ---

const generateQuestFromDestination = (
  destination: google.maps.places.PlaceResult,
  userLocation: { lat: number; lng: number }
): Quest => {
  const destLat = destination.geometry?.location?.lat() || 0;
  const destLng = destination.geometry?.location?.lng() || 0;

  // Calculate distance (approximate)
  const distance = Math.sqrt(
    Math.pow(destLat - userLocation.lat, 2) + Math.pow(destLng - userLocation.lng, 2)
  ) * 111; // Convert to km (rough approximation)

  // Generate waypoints along the route
  const waypoints: Waypoint[] = [];
  const waypointCount = Math.min(3, Math.floor(distance / 0.5)); // One waypoint every 500m

  for (let i = 0; i < waypointCount; i++) {
    const ratio = (i + 1) / (waypointCount + 1);
    waypoints.push({
      id: `wp-${i}`,
      lat: userLocation.lat + (destLat - userLocation.lat) * ratio,
      lng: userLocation.lng + (destLng - userLocation.lng) * ratio,
      name: `Checkpoint ${i + 1}`,
      completed: false,
      type: 'checkpoint',
      description: `Complete this checkpoint to earn bonus rewards!`
    });
  }

  // Determine quest type based on destination
  let questType: Quest['type'] = 'exploration';
  const placeTypes = destination.types || [];
  if (placeTypes.includes('park') || placeTypes.includes('gym')) {
    questType = 'fitness';
  } else if (placeTypes.includes('hospital') || placeTypes.includes('police')) {
    questType = 'emergency';
  } else if (placeTypes.includes('community_center') || placeTypes.includes('library')) {
    questType = 'community';
  }

  return {
    id: `quest-${Date.now()}`,
    title: `Journey to ${destination.name}`,
    description: `Complete this quest to explore ${destination.name} and earn rewards!`,
    destination: {
      lat: destLat,
      lng: destLng,
      name: destination.name || 'Unknown Destination'
    },
    waypoints,
    reward: `${Math.floor(distance * 50)} KP`,
    distance: Math.round(distance * 100) / 100,
    duration: Math.round(distance * 15), // Approx 15 min per km
    progress: 0,
    status: 'available',
    type: questType
  };
};

// --- Map Component ---

interface MapViewProps {
  userLocation: { lat: number; lng: number } | null;
  onSelectDestination: (place: google.maps.places.PlaceResult) => void;
  activeQuest: Quest | null;
  onWaypointReached?: (waypointId: string) => void;
}

const MapView: React.FC<MapViewProps> = ({
  userLocation,
  onSelectDestination,
  activeQuest,
  onWaypointReached
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    const initMap = async () => {
      const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;
      const { PlacesService } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;

      // Initialize map with 3D view
      const map = new Map(mapRef.current!, {
        center: userLocation,
        zoom: 16,
        mapTypeId: 'roadmap',
        tilt: 45,
        heading: 0,
        mapId: 'kampung_ai_map',
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: false,
        mapTypeControl: false
      });

      mapInstanceRef.current = map;

      // Add user location marker
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
      }

      userMarkerRef.current = new google.maps.Marker({
        position: userLocation,
        map: map,
        title: "You are here",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#4F46E5",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 3
        },
        animation: google.maps.Animation.DROP
      });

      // Initialize search box
      if (searchBoxRef.current) {
        const searchBox = new google.maps.places.SearchBox(searchBoxRef.current);
        map.controls[google.maps.ControlPosition.TOP_LEFT].push(searchBoxRef.current);

        searchBox.addListener('places_changed', () => {
          const places = searchBox.getPlaces();
          if (!places || places.length === 0) return;

          // Clear existing markers
          markersRef.current.forEach(marker => marker.setMap(null));
          markersRef.current = [];

          // Focus on the first place
          const place = places[0];
          if (place.geometry && place.geometry.location) {
            map.setCenter(place.geometry.location);
            map.setZoom(17);
            onSelectDestination(place);
          }
        });
      }

      // Initialize directions renderer
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: '#10B981',
          strokeWeight: 6,
          strokeOpacity: 0.8
        }
      });

      // If there's an active quest, show the route
      if (activeQuest) {
        showQuestRoute(activeQuest);
      }
    };

    initMap();
  }, [userLocation]);

  const showQuestRoute = async (quest: Quest) => {
    if (!mapInstanceRef.current || !userLocation || !directionsRendererRef.current) return;

    const directionsService = new google.maps.DirectionsService();

    // Create waypoints for the route
    const waypoints = quest.waypoints
      .filter(wp => !wp.completed)
      .map(wp => ({
        location: new google.maps.LatLng(wp.lat, wp.lng),
        stopover: true
      }));

    const request: google.maps.DirectionsRequest = {
      origin: userLocation,
      destination: new google.maps.LatLng(quest.destination.lat, quest.destination.lng),
      waypoints: waypoints,
      travelMode: google.maps.TravelMode.WALKING,
      unitSystem: google.maps.UnitSystem.METRIC
    };

    directionsService.route(request, (result, status) => {
      if (status === 'OK' && result) {
        directionsRendererRef.current?.setDirections(result);

        // Add markers for waypoints
        quest.waypoints.forEach((wp, index) => {
          const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lng },
            map: mapInstanceRef.current!,
            title: wp.name,
            label: {
              text: `${index + 1}`,
              color: 'white',
              fontWeight: 'bold'
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 15,
              fillColor: wp.completed ? '#10B981' : '#F59E0B',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2
            }
          });

          marker.addListener('click', () => {
            if (!wp.completed && onWaypointReached) {
              onWaypointReached(wp.id);
            }
          });

          markersRef.current.push(marker);
        });
      }
    });
  };

  useEffect(() => {
    if (activeQuest && mapInstanceRef.current) {
      showQuestRoute(activeQuest);
    }
  }, [activeQuest]);

  // Update user location marker
  useEffect(() => {
    if (userMarkerRef.current && userLocation) {
      userMarkerRef.current.setPosition(userLocation);
    }
  }, [userLocation]);

  return (
    <div className="relative w-full h-full">
      <input
        ref={searchBoxRef}
        type="text"
        placeholder="Search for a destination..."
        className="absolute top-4 left-4 z-10 px-4 py-3 rounded-xl bg-white text-gray-900 shadow-lg w-[calc(100%-2rem)] max-w-md"
      />
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

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

// Load Google Maps API dynamically
const loadGoogleMapsAPI = () => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'YOUR_API_KEY_HERE';

  if (!window.google && apiKey !== 'YOUR_API_KEY_HERE') {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.log('[INFO] Google Maps API loaded successfully');
    };
    script.onerror = () => {
      console.error('[ERROR] Failed to load Google Maps API. Please check your API key.');
    };
    document.head.appendChild(script);
  } else if (apiKey === 'YOUR_API_KEY_HERE') {
    console.error('[ERROR] Please set VITE_GOOGLE_MAPS_API_KEY in your .env file');
  }
};

const AppContent = () => {
  const { currentUser, logout, loading } = useAuth();

  // ALL hooks must be called before any early returns
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

  // Quest State
  const [quests, setQuests] = useState<Quest[]>([]);
  const [activeQuest, setActiveQuest] = useState<Quest | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<google.maps.places.PlaceResult | null>(null);
  const [totalKP, setTotalKP] = useState(150); // User's Kampung Points

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
    // Load Google Maps API
    loadGoogleMapsAPI();

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
              },
              {
                name: "createQuestToDestination",
                description: "Create a quest to navigate user to a destination.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    destination: { type: Type.STRING, description: "The destination name or place" }
                  },
                  required: ["destination"]
                }
              },
              {
                name: "getActiveQuestStatus",
                description: "Get the status of the current active quest.",
                parameters: { type: Type.OBJECT, properties: {} }
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

  // --- Auth Handlers ---

  const handleLogout = async () => {
    try {
      await logout();
      setShowDrawer(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Auth disabled for testing - uncomment below to enable
  // if (loading) {
  //   return (
  //     <div className="min-h-screen bg-slate-900 flex items-center justify-center">
  //       <div className="text-center">
  //         <div className="w-12 h-12 border-4 border-teal-400/30 border-t-teal-400 rounded-full animate-spin mx-auto mb-4" />
  //         <p className="text-gray-400">Loading...</p>
  //       </div>
  //     </div>
  //   );
  // }
  // if (!currentUser) {
  //   return <Auth />;
  // }

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

  // --- Quest Management Functions ---

  const handleSelectDestination = useCallback((place: google.maps.places.PlaceResult) => {
    if (!location) {
      setErrorMsg("Location not available");
      return;
    }

    setSelectedDestination(place);
    const newQuest = generateQuestFromDestination(place, location);

    // Add quest to the list but don't activate it yet
    setQuests(prev => [...prev, newQuest]);
  }, [location]);

  const startQuest = useCallback((questId: string) => {
    const quest = quests.find(q => q.id === questId);
    if (quest) {
      setActiveQuest({ ...quest, status: 'active' });
      setQuests(prev => prev.map(q =>
        q.id === questId ? { ...q, status: 'active' } : q
      ));

      // Notify AI assistant about quest start
      if (sessionRef.current && connected) {
        sessionRef.current.then((session: any) => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa(`User started quest: ${quest.title}. Guide them to ${quest.destination.name}.`)
            }
          });
        });
      }
    }
  }, [quests, connected]);

  const handleWaypointReached = useCallback((waypointId: string) => {
    if (!activeQuest) return;

    // Update waypoint status
    const updatedQuest = {
      ...activeQuest,
      waypoints: activeQuest.waypoints.map(wp =>
        wp.id === waypointId ? { ...wp, completed: true } : wp
      )
    };

    // Calculate progress
    const completedWaypoints = updatedQuest.waypoints.filter(wp => wp.completed).length;
    updatedQuest.progress = (completedWaypoints / updatedQuest.waypoints.length) * 100;

    // Award partial KP for checkpoint
    setTotalKP(prev => prev + 10);

    // Check if quest is complete
    if (updatedQuest.progress === 100) {
      updatedQuest.status = 'completed';
      // Award full quest rewards
      const rewardAmount = parseInt(updatedQuest.reward.split(' ')[0]);
      setTotalKP(prev => prev + rewardAmount);

      // Notify completion
      if (sessionRef.current && connected) {
        sessionRef.current.then((session: any) => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa(`Congratulations! Quest "${updatedQuest.title}" completed! You earned ${updatedQuest.reward}!`)
            }
          });
        });
      }
    }

    setActiveQuest(updatedQuest);
    setQuests(prev => prev.map(q =>
      q.id === updatedQuest.id ? updatedQuest : q
    ));
  }, [activeQuest, connected]);

  const cancelQuest = useCallback(() => {
    if (activeQuest) {
      setQuests(prev => prev.map(q =>
        q.id === activeQuest.id ? { ...q, status: 'available' } : q
      ));
      setActiveQuest(null);
    }
  }, [activeQuest]);

  // Watch user location for quest progress
  useEffect(() => {
    if (!activeQuest || activeQuest.status !== 'active' || !location) return;

    // Check proximity to waypoints
    activeQuest.waypoints.forEach(waypoint => {
      if (!waypoint.completed) {
        const distance = Math.sqrt(
          Math.pow(waypoint.lat - location.lat, 2) +
          Math.pow(waypoint.lng - location.lng, 2)
        ) * 111000; // Convert to meters

        if (distance < 50) { // Within 50 meters of waypoint
          handleWaypointReached(waypoint.id);
        }
      }
    });

    // Check proximity to destination
    const destDistance = Math.sqrt(
      Math.pow(activeQuest.destination.lat - location.lat, 2) +
      Math.pow(activeQuest.destination.lng - location.lng, 2)
    ) * 111000;

    if (destDistance < 50 && activeQuest.waypoints.every(wp => wp.completed)) {
      // Quest complete!
      handleWaypointReached('destination');
    }
  }, [location, activeQuest]);

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

                  <div className="mt-auto pt-6 border-t border-slate-800 space-y-3">
                      <button
                        onClick={() => { setMode('distress'); setShowDrawer(false); }}
                        className="w-full p-4 rounded-xl bg-red-900/50 text-red-400 border border-red-900 flex items-center justify-center gap-2 font-bold hover:bg-red-900/80 transition shadow-lg shadow-red-900/20"
                      >
                          <AlertTriangle className="w-5 h-5" />
                          SOS ALERT
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full p-4 rounded-xl bg-slate-800 text-gray-400 border border-slate-700 flex items-center justify-center gap-2 hover:bg-slate-700 transition"
                      >
                          <LogOut className="w-5 h-5" />
                          Sign Out
                      </button>
                      <p className="text-xs text-center text-gray-500 truncate">
                        {currentUser.email}
                      </p>
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
          <div className="absolute inset-0 z-30 bg-slate-900 flex flex-col animate-fade-in">
             {/* Header */}
             <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-40 bg-slate-900/90 backdrop-blur-lg">
                <div className="flex items-center gap-3">
                   <button onClick={() => setMode('voice')} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition">
                      <X className="w-6 h-6" />
                   </button>
                   <div>
                      <h2 className="text-xl font-bold text-teal-400">Kampung Quest</h2>
                      <p className="text-xs text-gray-400 flex items-center gap-2">
                         <Trophy className="w-3 h-3" />
                         {totalKP} KP
                      </p>
                   </div>
                </div>
                {activeQuest && (
                   <button
                      onClick={cancelQuest}
                      className="px-3 py-1 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition"
                   >
                      Cancel Quest
                   </button>
                )}
             </div>

             {/* Map View */}
             <div className="flex-1 relative mt-16">
                <MapView
                   userLocation={location}
                   onSelectDestination={handleSelectDestination}
                   activeQuest={activeQuest}
                   onWaypointReached={handleWaypointReached}
                />

                {/* Active Quest Overlay */}
                {activeQuest && (
                   <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur-lg rounded-2xl p-4 border border-slate-700">
                      <div className="flex items-center justify-between mb-3">
                         <div className="flex-1">
                            <h3 className="font-bold text-white flex items-center gap-2">
                               {activeQuest.type === 'fitness' && <Activity className="w-4 h-4 text-green-400" />}
                               {activeQuest.type === 'community' && <MapPin className="w-4 h-4 text-blue-400" />}
                               {activeQuest.type === 'exploration' && <Target className="w-4 h-4 text-purple-400" />}
                               {activeQuest.title}
                            </h3>
                            <p className="text-xs text-gray-400 mt-1">
                               {activeQuest.distance} km • {activeQuest.duration} min • {activeQuest.reward}
                            </p>
                         </div>
                         <div className="text-right">
                            <div className="text-2xl font-bold text-teal-400">{Math.round(activeQuest.progress)}%</div>
                            <div className="text-xs text-gray-400">Complete</div>
                         </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 rounded-full h-2 mb-3">
                         <div
                            className="bg-teal-400 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${activeQuest.progress}%` }}
                         />
                      </div>

                      {/* Waypoints */}
                      <div className="flex gap-2 flex-wrap">
                         {activeQuest.waypoints.map((wp, idx) => (
                            <div
                               key={wp.id}
                               className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                                  wp.completed
                                     ? 'bg-green-900/30 text-green-400 border border-green-800'
                                     : 'bg-slate-800 text-gray-400 border border-slate-700'
                               }`}
                            >
                               {wp.completed ? '✓' : idx + 1}
                               <span>{wp.name}</span>
                            </div>
                         ))}
                      </div>
                   </div>
                )}

                {/* Quest Selection Panel (when no active quest) */}
                {!activeQuest && selectedDestination && (
                   <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur-lg rounded-2xl p-4 border border-slate-700">
                      <h3 className="font-bold text-white mb-2">New Quest Available!</h3>
                      <p className="text-sm text-gray-400 mb-3">
                         Journey to {selectedDestination.name}
                      </p>
                      <button
                         onClick={() => {
                            const quest = quests[quests.length - 1]; // Get the most recent quest
                            if (quest) startQuest(quest.id);
                         }}
                         className="w-full py-3 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-500 transition flex items-center justify-center gap-2"
                      >
                         <Play className="w-5 h-5" />
                         Start Quest
                      </button>
                   </div>
                )}

                {/* Available Quests List (when no destination selected) */}
                {!activeQuest && !selectedDestination && quests.length > 0 && (
                   <div className="absolute bottom-4 left-4 right-4 max-h-64 overflow-y-auto">
                      <div className="bg-slate-900/95 backdrop-blur-lg rounded-2xl p-4 border border-slate-700">
                         <h3 className="font-bold text-white mb-3">Available Quests</h3>
                         <div className="space-y-2">
                            {quests.filter(q => q.status === 'available').map(quest => (
                               <div
                                  key={quest.id}
                                  className="flex items-center justify-between p-3 bg-slate-800 rounded-xl"
                               >
                                  <div className="flex-1">
                                     <p className="font-medium text-white text-sm">{quest.title}</p>
                                     <p className="text-xs text-gray-400">
                                        {quest.distance} km • {quest.reward}
                                     </p>
                                  </div>
                                  <button
                                     onClick={() => startQuest(quest.id)}
                                     className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded-lg hover:bg-teal-500 transition"
                                  >
                                     GO
                                  </button>
                               </div>
                            ))}
                         </div>
                      </div>
                   </div>
                )}

                {/* Instructions when no location */}
                {!location && (
                   <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 backdrop-blur-lg">
                      <div className="text-center">
                         <MapPin className="w-16 h-16 text-teal-400 mx-auto mb-4" />
                         <h3 className="text-xl font-bold text-white mb-2">Location Required</h3>
                         <p className="text-gray-400">Please enable location access to use quests</p>
                      </div>
                   </div>
                )}
             </div>
          </div>
      )}

    </div>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Root element not found");
}
const root = createRoot(rootElement);
root.render(<App />);