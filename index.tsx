import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MapPin,
  AlertTriangle, Menu, X, QrCode, Activity, Pause,
  Navigation, Search, Target, Trophy, ChevronRight, Play, LogOut,
  UserPlus, Phone, Users, Copy, Check, PhoneIncoming, PhoneOutgoing,
  Camera, Image, Heart, Share2, Calendar, Clock, MapPinned,
  Award, Sparkles, TrendingUp, Home
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { Auth } from './src/components/Auth';
import { getDatabase, ref, set, onValue, remove, push, onChildAdded } from 'firebase/database';
import app from './src/firebase';

// --- Configuration & Types ---

interface CheckInPhoto {
  id: string;
  userId: string;
  userName: string;
  photoUrl: string;
  timestamp: number;
  location: { lat: number; lng: number };
}

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
  checkIns?: CheckInPhoto[];
}

interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  completed: boolean;
  type: 'checkpoint' | 'task' | 'bonus';
  description?: string;
  checkIns?: CheckInPhoto[];
}

interface CommunityEvent {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  time: string;
  date: string;
  reward: string;
  category: 'social' | 'fitness' | 'arts' | 'education' | 'food';
  participants: string[];
  maxParticipants?: number;
  imageUrl?: string;
  checkIns: CheckInPhoto[];
}

interface KampungConnection {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen?: number;
  kampungPoints?: number;
}

interface CallState {
  isInCall: boolean;
  callType: 'incoming' | 'outgoing' | null;
  remoteUserId: string | null;
  remoteUserName: string | null;
}

// WebRTC Configuration
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

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
4. Quest & Navigation: PROACTIVELY help users navigate when they mention ANY destination
   - IMPORTANT: When user mentions wanting to go somewhere, IMMEDIATELY create a quest
   - Listen for: "I want to go to", "bring me to", "where is", "how to get to", "navigate to"
   - Common places: kopitiam, hawker center, MRT station, bus stop, market, mall, clinic, park
   - Response example: "Okay can! I bring you to [place]. Creating your quest now ah!"
   - During navigation: Give turn-by-turn directions in Singlish
   - At checkpoints: "Wah steady! You reach checkpoint already! Continue straight lor"
   - When complete: "Shiok! You reach your destination! Well done!"

Tools:
- Use 'searchNearbyEvents' if they ask about activities ("Got what happenings?").
- Use 'checkSuspiciousNumber' if they mention a phone number.
- Use 'createQuestToDestination' IMMEDIATELY when user mentions wanting to go somewhere
- Use 'getActiveQuestStatus' to check progress and guide them
`;

const MOCK_COMMUNITY_EVENTS: CommunityEvent[] = [
  {
    id: 'e1',
    name: 'Morning Tai Chi',
    description: 'Join our daily morning exercise session at Capita Green, 138 Market Street. All levels welcome!',
    lat: 1.2821,
    lng: 103.8508,
    time: '7:00 AM',
    date: '2025-11-20',
    reward: '50 KP',
    category: 'fitness',
    participants: [],
    maxParticipants: 20,
    checkIns: []
  },
  {
    id: 'e2',
    name: 'Pasar Malam Cleanup',
    description: 'Help keep our night market clean and earn points!',
    lat: 1.3600,
    lng: 103.8200,
    time: '8:00 PM',
    date: '2025-11-20',
    reward: '100 KP',
    category: 'social',
    participants: [],
    maxParticipants: 15,
    checkIns: []
  },
  {
    id: 'e3',
    name: 'Kopitiam Gathering',
    description: 'Chat with neighbors over kopi and kaya toast!',
    lat: 1.3550,
    lng: 103.8210,
    time: '3:00 PM',
    date: '2025-11-20',
    reward: '30 KP',
    category: 'food',
    participants: [],
    maxParticipants: 25,
    checkIns: []
  },
  {
    id: 'e4',
    name: 'Painting Workshop',
    description: 'Learn watercolor painting with local artist Auntie Mei',
    lat: 1.3580,
    lng: 103.8190,
    time: '10:00 AM',
    date: '2025-11-21',
    reward: '80 KP',
    category: 'arts',
    participants: [],
    maxParticipants: 12,
    checkIns: []
  },
  {
    id: 'e5',
    name: 'Smartphone Basics Class',
    description: 'Learn to use your smartphone better. Bring your questions!',
    lat: 1.3540,
    lng: 103.8220,
    time: '2:00 PM',
    date: '2025-11-22',
    reward: '60 KP',
    category: 'education',
    participants: [],
    maxParticipants: 10,
    checkIns: []
  }
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
  communityEvents?: CommunityEvent[];
  onEventSelect?: (event: CommunityEvent) => void;
  showEvents?: boolean;
}

const MapView: React.FC<MapViewProps> = ({
  userLocation,
  onSelectDestination,
  activeQuest,
  onWaypointReached,
  communityEvents = [],
  onEventSelect,
  showEvents = false
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const eventMarkersRef = useRef<google.maps.Marker[]>([]);

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

  // Render community event markers
  useEffect(() => {
    if (!mapInstanceRef.current || !showEvents) return;

    // Clear existing event markers
    eventMarkersRef.current.forEach(marker => marker.setMap(null));
    eventMarkersRef.current = [];

    // Get category colors and icons
    const getCategoryStyle = (category: string) => {
      switch (category) {
        case 'fitness': return { color: '#10B981', icon: '🏃' };
        case 'social': return { color: '#3B82F6', icon: '👥' };
        case 'food': return { color: '#F59E0B', icon: '🍜' };
        case 'arts': return { color: '#EC4899', icon: '🎨' };
        case 'education': return { color: '#8B5CF6', icon: '📚' };
        default: return { color: '#6B7280', icon: '📍' };
      }
    };

    // Add markers for each event (LARGE for seniors)
    communityEvents.forEach(event => {
      const style = getCategoryStyle(event.category);

      // Create custom HTML marker for better visibility
      const markerDiv = document.createElement('div');
      markerDiv.innerHTML = `
        <div style="
          background: ${style.color};
          color: white;
          padding: 12px 16px;
          border-radius: 20px;
          font-weight: bold;
          font-size: 18px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          cursor: pointer;
          transform: scale(1);
          transition: transform 0.2s;
          border: 3px solid white;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 140px;
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
          <span style="font-size: 24px;">${style.icon}</span>
          <span>${event.name}</span>
        </div>
      `;

      const marker = new google.maps.Marker({
        position: { lat: event.lat, lng: event.lng },
        map: mapInstanceRef.current!,
        title: event.name,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="28" fill="${style.color}" stroke="white" stroke-width="4"/>
              <text x="30" y="38" font-size="28" text-anchor="middle" fill="white">${style.icon}</text>
            </svg>
          `),
          scaledSize: new google.maps.Size(60, 60),
          anchor: new google.maps.Point(30, 30)
        },
        label: {
          text: event.name,
          color: 'white',
          fontSize: '14px',
          fontWeight: 'bold'
        },
        animation: google.maps.Animation.DROP
      });

      marker.addListener('click', () => {
        if (onEventSelect) {
          onEventSelect(event);
        }
      });

      eventMarkersRef.current.push(marker);
    });
  }, [communityEvents, showEvents, onEventSelect]);

  return (
    <div className="relative w-full h-full">
      <input
        ref={searchBoxRef}
        type="text"
        placeholder="Search for a destination..."
        className="absolute top-4 left-4 z-10 px-4 py-3 rounded-xl bg-white text-gray-900 shadow-lg w-[calc(100%-2rem)] max-w-md text-lg"
        style={{ fontSize: '18px' }}
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

  // Event & Photo State
  const [communityEvents, setCommunityEvents] = useState<CommunityEvent[]>(MOCK_COMMUNITY_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState<CommunityEvent | null>(null);
  const [showPhotoGallery, setShowPhotoGallery] = useState(false);
  const [showCheckInCamera, setShowCheckInCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<{ type: 'event' | 'waypoint' | 'quest'; id: string } | null>(null);
  const [questView, setQuestView] = useState<'map' | 'events' | 'dashboard'>('dashboard');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrScanResult, setQrScanResult] = useState<string | null>(null);

  // Kampung Connect State
  const [myUserId, setMyUserId] = useState<string>(() => {
    // Generate a persistent user ID even when not logged in
    const stored = localStorage.getItem('kampung_user_id');
    if (stored) return stored;
    const newId = `KP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    localStorage.setItem('kampung_user_id', newId);
    return newId;
  });
  const [connections, setConnections] = useState<KampungConnection[]>([
    {
      id: 'KP-AH8G2K1L',
      name: 'Auntie Mei',
      status: 'online',
      lastSeen: Date.now(),
      kampungPoints: 2350
    },
    {
      id: 'KP-TAN5H9M3',
      name: 'Uncle Tan',
      status: 'online',
      lastSeen: Date.now(),
      kampungPoints: 1820
    },
    {
      id: 'KP-LIMS4R7P',
      name: 'Mrs. Lim',
      status: 'offline',
      lastSeen: Date.now() - 3600000, // 1 hour ago
      kampungPoints: 3150
    },
    {
      id: 'KP-RAJK3N8D',
      name: 'Mr. Raj',
      status: 'online',
      lastSeen: Date.now(),
      kampungPoints: 1450
    },
    {
      id: 'KP-CHENX2Q9',
      name: 'Auntie Chen',
      status: 'offline',
      lastSeen: Date.now() - 7200000, // 2 hours ago
      kampungPoints: 2890
    },
    {
      id: 'KP-WONGP6T4',
      name: 'Uncle Wong',
      status: 'online',
      lastSeen: Date.now(),
      kampungPoints: 950
    }
  ]);
  const [connectInput, setConnectInput] = useState('');
  const [callState, setCallState] = useState<CallState>({
    isInCall: false,
    callType: null,
    remoteUserId: null,
    remoteUserName: null
  });
  const [copiedId, setCopiedId] = useState(false);
  const [connectTab, setConnectTab] = useState<'share' | 'add' | 'friends'>('share');

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  // Check-in camera refs
  const checkInVideoRef = useRef<HTMLVideoElement>(null);
  const checkInCanvasRef = useRef<HTMLCanvasElement>(null);

  // Video call refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // QR Scanner refs
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrScanIntervalRef = useRef<number | null>(null);

  // WebRTC Refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

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

  // --- Kampung Connect Initialization ---

  useEffect(() => {
    if (!currentUser) return;

    // Generate or retrieve user ID from Firebase UID
    const userId = `KP-${currentUser.uid.substring(0, 8).toUpperCase()}`;
    setMyUserId(userId);

    // Initialize Firebase Realtime Database for signaling
    const db = getDatabase(app);

    // Set user as online
    const userStatusRef = ref(db, `users/${userId}`);
    set(userStatusRef, {
      name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Villager',
      status: 'online',
      lastSeen: Date.now()
    });

    // Listen for incoming calls
    const callsRef = ref(db, `calls/${userId}`);
    const unsubscribeCalls = onValue(callsRef, async (snapshot) => {
      const callData = snapshot.val();
      if (callData && callData.type === 'offer') {
        // Incoming call
        setCallState({
          isInCall: false,
          callType: 'incoming',
          remoteUserId: callData.from,
          remoteUserName: callData.fromName
        });
      }
    });

    // Load saved connections from localStorage
    const savedConnections = localStorage.getItem(`kampung_connections_${userId}`);
    if (savedConnections) {
      setConnections(JSON.parse(savedConnections));
    }

    // Cleanup on unmount
    return () => {
      unsubscribeCalls();
      set(userStatusRef, {
        status: 'offline',
        lastSeen: Date.now()
      });
    };
  }, [currentUser]);

  // --- Kampung Connect Functions ---

  const copyUserId = useCallback(() => {
    navigator.clipboard.writeText(myUserId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }, [myUserId]);

  const addConnection = useCallback(async () => {
    if (!connectInput.trim()) return;

    const friendId = connectInput.trim().toUpperCase();

    // Validate format
    if (!friendId.startsWith('KP-')) {
      setErrorMsg("Invalid Kampung ID format! Should start with KP-");
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }

    if (friendId === myUserId) {
      setErrorMsg("Cannot add yourself!");
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }

    // Check if already connected
    if (connections.some(c => c.id === friendId)) {
      setErrorMsg("Already connected!");
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }

    // Add the friend (works without authentication)
    const newConnection: KampungConnection = {
      id: friendId,
      name: `Friend ${friendId.substring(3, 6)}`, // Generate a name from ID
      status: Math.random() > 0.5 ? 'online' : 'offline', // Random status
      lastSeen: Date.now()
    };

    const updatedConnections = [...connections, newConnection];
    setConnections(updatedConnections);
    localStorage.setItem(`kampung_connections_${myUserId}`, JSON.stringify(updatedConnections));
    setConnectInput('');
    setConnectTab('friends');

    // Show success message
    console.log(`Added friend: ${friendId}`);
  }, [connectInput, connections, myUserId]);

  const initiateCall = useCallback(async (friendId: string, friendName: string) => {
    if (!currentUser || callState.isInCall) return;

    try {
      // Get audio and video stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      localStreamRef.current = stream;

      // Attach local stream to video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Create peer connection
      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      // Add local stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      const db = getDatabase(app);
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = push(ref(db, `candidates/${friendId}`));
          set(candidateRef, {
            from: myUserId,
            candidate: event.candidate.toJSON()
          });
        }
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const callRef = ref(db, `calls/${friendId}`);
      await set(callRef, {
        type: 'offer',
        from: myUserId,
        fromName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Villager',
        offer: { type: offer.type, sdp: offer.sdp }
      });

      setCallState({
        isInCall: true,
        callType: 'outgoing',
        remoteUserId: friendId,
        remoteUserName: friendName
      });

      // Listen for answer
      onValue(ref(db, `calls/${myUserId}`), async (snapshot) => {
        const data = snapshot.val();
        if (data && data.type === 'answer' && pc.signalingState !== 'closed') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });

      // Listen for ICE candidates
      onChildAdded(ref(db, `candidates/${myUserId}`), async (snapshot) => {
        const data = snapshot.val();
        if (data && data.candidate && pc.signalingState !== 'closed') {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

    } catch (error) {
      console.error('Call failed:', error);
      setErrorMsg('Failed to start call');
    }
  }, [currentUser, myUserId, callState.isInCall]);

  const acceptCall = useCallback(async () => {
    if (!callState.remoteUserId || !currentUser) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      localStreamRef.current = stream;

      // Attach local stream to video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      const db = getDatabase(app);
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = push(ref(db, `candidates/${callState.remoteUserId}`));
          set(candidateRef, {
            from: myUserId,
            candidate: event.candidate.toJSON()
          });
        }
      };

      // Get offer from Firebase
      const callRef = ref(db, `calls/${myUserId}`);
      onValue(callRef, async (snapshot) => {
        const data = snapshot.val();
        if (data && data.offer && pc.signalingState !== 'closed') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          // Send answer
          await set(ref(db, `calls/${callState.remoteUserId}`), {
            type: 'answer',
            from: myUserId,
            answer: { type: answer.type, sdp: answer.sdp }
          });
        }
      }, { onlyOnce: true });

      // Listen for ICE candidates
      onChildAdded(ref(db, `candidates/${myUserId}`), async (snapshot) => {
        const data = snapshot.val();
        if (data && data.candidate && pc.signalingState !== 'closed') {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

      setCallState(prev => ({ ...prev, isInCall: true }));

    } catch (error) {
      console.error('Failed to accept call:', error);
      setErrorMsg('Failed to accept call');
    }
  }, [callState.remoteUserId, myUserId, currentUser]);

  const endCall = useCallback(() => {
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Clear Firebase call data
    const db = getDatabase(app);
    if (callState.remoteUserId) {
      remove(ref(db, `calls/${callState.remoteUserId}`));
      remove(ref(db, `candidates/${callState.remoteUserId}`));
    }
    remove(ref(db, `calls/${myUserId}`));
    remove(ref(db, `candidates/${myUserId}`));

    setCallState({
      isInCall: false,
      callType: null,
      remoteUserId: null,
      remoteUserName: null
    });
  }, [callState.remoteUserId, myUserId]);

  const declineCall = useCallback(() => {
    const db = getDatabase(app);
    remove(ref(db, `calls/${myUserId}`));
    setCallState({
      isInCall: false,
      callType: null,
      remoteUserId: null,
      remoteUserName: null
    });
  }, [myUserId]);

  // --- Live API Connection ---

  const startSession = async () => {
    try {
      setErrorMsg(null);
      
      // 1. Init Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");
      
      audioContextRef.current = new AudioContextClass();
      const ctx = audioContextRef.current;
      
      // Vital: Resume context to ensure it's active (required by some browsers)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const sampleRate = ctx.sampleRate; 

      // 2. Get Media Stream (Mic)
      let stream: MediaStream;
      try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
          console.warn("Microphone not found or denied. Falling back to silent stream.", e);
          stream = createSilentStream(ctx);
          setIsMicOn(false); 
          setErrorMsg("Mic denied/missing - Audio Input Disabled");
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
                
                const source = ctx.createMediaStreamSource(stream);
                inputSourceRef.current = source;
                
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    if (!isMicOn) return; 
                    
                    const inputData = e.inputBuffer.getChannelData(0);
                    
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
                    
                    sessionPromise.then(session => {
                         session.sendRealtimeInput({
                             media: {
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
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
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
     // Close the session if it exists
     if (sessionRef.current && typeof sessionRef.current.close === 'function') {
         try {
             sessionRef.current.close();
             console.log('[DEBUG] Session closed successfully');
         } catch (error) {
             console.error('[ERROR] Failed to close session:', error);
         }
     }

     if (audioContextRef.current) audioContextRef.current.close();
     if (inputSourceRef.current) inputSourceRef.current.disconnect();
     if (processorRef.current) processorRef.current.disconnect();
     if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

     sessionRef.current = null;  // Clear the session reference
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
                        
                        // Only send video frames if still connected and have a session
                        if (connected && sessionRef.current && typeof sessionRef.current.sendRealtimeInput === 'function') {
                            try {
                                sessionRef.current.sendRealtimeInput({
                                    media: { mimeType: 'image/jpeg', data: base64Data }
                                });
                                console.log('[DEBUG] Video frame sent successfully');
                            } catch (error) {
                                console.warn('[WARN] Could not send video frame:', error);
                            }
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

  // Authentication disabled - uncomment below to enable
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
     console.log('[DECODE] Input data length:', data.length, 'bytes');

     // Check if data length is even (required for Int16 conversion)
     if (data.length % 2 !== 0) {
         console.warn('[DECODE WARNING] Odd number of bytes, trimming last byte');
         data = data.slice(0, data.length - 1);
     }

     const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
     console.log('[DECODE] Int16 samples:', int16.length);
     console.log('[DECODE] First 10 Int16 values:', Array.from(int16.slice(0, 10)));

     // Gemini returns 24kHz audio
     const sampleRate = 24000;
     const buffer = ctx.createBuffer(1, int16.length, sampleRate);
     const channel = buffer.getChannelData(0);

     // Check for audio content
     let maxSample = 0;
     let minSample = 0;

     for(let i = 0; i < int16.length; i++) {
         const normalized = int16[i] / 32768.0;
         channel[i] = normalized;
         if (normalized > maxSample) maxSample = normalized;
         if (normalized < minSample) minSample = normalized;
     }

     console.log('[DECODE] Audio stats:');
     console.log('[DECODE] - Sample rate:', sampleRate, 'Hz');
     console.log('[DECODE] - Duration:', buffer.duration, 'seconds');
     console.log('[DECODE] - Sample range:', minSample, 'to', maxSample);

     if (maxSample === 0 && minSample === 0) {
         console.error('[DECODE ERROR] All samples are zero - no audio content!');
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

      // Notify AI assistant about quest start with navigation instructions
      if (sessionRef.current && connected) {
        sessionRef.current.then((session: any) => {
          const navigationMessage = `Okay! Quest started to ${quest.destination.name}!
            Distance: ${quest.distance} km, about ${quest.duration} minutes walk.
            ${quest.waypoints.length > 0 ? `Got ${quest.waypoints.length} checkpoints on the way.` : ''}
            You will earn ${quest.reward} when you reach!
            Let's go! Follow the green route on the map lah!`;

          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa(navigationMessage)
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

      // Notify completion with Singlish encouragement
      if (sessionRef.current && connected) {
        sessionRef.current.then((session: any) => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa(`Wah shiok! You reach ${updatedQuest.destination.name} already! Quest complete! You earned ${updatedQuest.reward}! Steady lah!`)
            }
          });
        });
      }
    } else {
      // Notify checkpoint reached
      const nextWaypoint = updatedQuest.waypoints.find(wp => !wp.completed);
      if (sessionRef.current && connected) {
        sessionRef.current.then((session: any) => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa(`Steady! Checkpoint reached! ${nextWaypoint ? `Next checkpoint coming up: ${nextWaypoint.name}` : 'Final destination ahead!'}`)
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

  // --- Event Management Functions ---

  const joinEvent = useCallback((eventId: string) => {
    if (!myUserId) return;

    setCommunityEvents(prev => prev.map(event => {
      if (event.id === eventId) {
        if (event.participants.includes(myUserId)) {
          // Already joined
          return event;
        }
        if (event.maxParticipants && event.participants.length >= event.maxParticipants) {
          setErrorMsg("Event is full!");
          return event;
        }
        return {
          ...event,
          participants: [...event.participants, myUserId]
        };
      }
      return event;
    }));

    // Award points for joining
    setTotalKP(prev => prev + 10);
  }, [myUserId]);

  const leaveEvent = useCallback((eventId: string) => {
    if (!myUserId) return;

    setCommunityEvents(prev => prev.map(event => {
      if (event.id === eventId) {
        return {
          ...event,
          participants: event.participants.filter(id => id !== myUserId)
        };
      }
      return event;
    }));
  }, [myUserId]);

  const navigateToEvent = useCallback((event: CommunityEvent) => {
    if (!location) {
      setErrorMsg("Location not available. Please enable location access.");
      return;
    }

    // Switch to map view
    setQuestView('map');

    // Extract address from description if available
    let formattedAddress = event.description;
    if (event.id === 'e1') {
      formattedAddress = '138 Market Street, Singapore';
    }

    // Create a mock PlaceResult for the event location
    const mockPlace: google.maps.places.PlaceResult = {
      name: event.name,
      geometry: {
        location: new google.maps.LatLng(event.lat, event.lng)
      } as google.maps.places.PlaceGeometry,
      formatted_address: formattedAddress,
      types: [event.category],
      place_id: `event-${event.id}`
    };

    // Create the quest
    const newQuest = generateQuestFromDestination(mockPlace, location);
    setQuests(prev => [...prev, newQuest]);

    // Automatically start the quest to show directions
    setTimeout(() => {
      setActiveQuest({ ...newQuest, status: 'active' });
      setSelectedDestination(null);
    }, 100);
  }, [location]);

  // --- Photo Check-In Functions ---

  const openCheckInCamera = useCallback((target: { type: 'event' | 'waypoint' | 'quest'; id: string }) => {
    setCheckInTarget(target);
    setShowCheckInCamera(true);
  }, []);

  const captureCheckInPhoto = useCallback(async () => {
    if (!checkInVideoRef.current || !checkInCanvasRef.current) return;

    const canvas = checkInCanvasRef.current;
    const video = checkInVideoRef.current;

    if (video.readyState === 4) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);

      const photoData = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedPhoto(photoData);
    }
  }, []);

  const submitCheckIn = useCallback(async () => {
    if (!capturedPhoto || !checkInTarget || !location) return;

    const checkIn: CheckInPhoto = {
      id: `checkin-${Date.now()}`,
      userId: myUserId,
      userName: currentUser?.displayName || currentUser?.email?.split('@')[0] || myUserId || 'Villager',
      photoUrl: capturedPhoto,
      timestamp: Date.now(),
      location: location
    };

    // Add check-in to the appropriate target
    if (checkInTarget.type === 'event') {
      setCommunityEvents(prev => prev.map(event => {
        if (event.id === checkInTarget.id) {
          return {
            ...event,
            checkIns: [...event.checkIns, checkIn]
          };
        }
        return event;
      }));
      // Award points for event check-in
      setTotalKP(prev => prev + 20);
    } else if (checkInTarget.type === 'waypoint' && activeQuest) {
      const updatedQuest = {
        ...activeQuest,
        waypoints: activeQuest.waypoints.map(wp => {
          if (wp.id === checkInTarget.id) {
            return {
              ...wp,
              checkIns: [...(wp.checkIns || []), checkIn]
            };
          }
          return wp;
        })
      };
      setActiveQuest(updatedQuest);
      setQuests(prev => prev.map(q =>
        q.id === updatedQuest.id ? updatedQuest : q
      ));
      // Award points for waypoint check-in
      setTotalKP(prev => prev + 15);
    } else if (checkInTarget.type === 'quest' && activeQuest) {
      const updatedQuest = {
        ...activeQuest,
        checkIns: [...(activeQuest.checkIns || []), checkIn]
      };
      setActiveQuest(updatedQuest);
      setQuests(prev => prev.map(q =>
        q.id === updatedQuest.id ? updatedQuest : q
      ));
      // Award points for quest completion check-in
      setTotalKP(prev => prev + 30);
    }

    // Reset camera state
    setShowCheckInCamera(false);
    setCapturedPhoto(null);
    setCheckInTarget(null);

    // Stop camera stream
    if (checkInVideoRef.current && checkInVideoRef.current.srcObject) {
      const stream = checkInVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      checkInVideoRef.current.srcObject = null;
    }
  }, [capturedPhoto, checkInTarget, myUserId, location, currentUser, activeQuest]);

  // Start check-in camera
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCheckInCamera = async () => {
      if (showCheckInCamera && checkInVideoRef.current) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });

          if (checkInVideoRef.current) {
            checkInVideoRef.current.srcObject = stream;
            await checkInVideoRef.current.play();
          }
        } catch (err) {
          console.error("Camera access failed for check-in:", err);
          setErrorMsg("Could not access camera");
          setShowCheckInCamera(false);
        }
      }
    };

    startCheckInCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showCheckInCamera]);

  // Start QR scanner camera
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startQRScanner = async () => {
      if (showQRScanner && qrVideoRef.current && qrCanvasRef.current) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });

          if (qrVideoRef.current) {
            qrVideoRef.current.srcObject = stream;
            await qrVideoRef.current.play();

            // Start scanning for QR codes
            const canvas = qrCanvasRef.current;
            const video = qrVideoRef.current;
            const ctx = canvas.getContext('2d');

            // Try to use native BarcodeDetector if available
            if ('BarcodeDetector' in window) {
              const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });

              qrScanIntervalRef.current = window.setInterval(async () => {
                if (video.readyState === 4 && !qrScanResult) {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  ctx?.drawImage(video, 0, 0);

                  try {
                    const barcodes = await barcodeDetector.detect(canvas);
                    if (barcodes.length > 0) {
                      const qrData = barcodes[0].rawValue;
                      // Check if it's a valid Kampung ID
                      if (qrData.startsWith('KP-')) {
                        setQrScanResult(qrData);
                        if (qrScanIntervalRef.current) {
                          clearInterval(qrScanIntervalRef.current);
                        }
                      }
                    }
                  } catch (err) {
                    console.error('QR scan error:', err);
                  }
                }
              }, 500); // Scan every 500ms
            } else {
              // Fallback: Simulate QR detection for demo
              // In production, you'd use a library like jsQR here
              console.log('BarcodeDetector not available. QR scanning requires a compatible browser or library.');
              setErrorMsg('QR scanning not supported on this browser. Please enter the ID manually.');
              setTimeout(() => setShowQRScanner(false), 3000);
            }
          }
        } catch (err) {
          console.error("Camera access failed for QR scanner:", err);
          setErrorMsg("Could not access camera");
          setShowQRScanner(false);
        }
      }
    };

    startQRScanner();

    return () => {
      if (qrScanIntervalRef.current) {
        clearInterval(qrScanIntervalRef.current);
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showQRScanner, qrScanResult]);

  // Watch user location for quest progress and provide navigation updates
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
        } else if (distance < 100 && sessionRef.current && connected) {
          // Approaching waypoint - give voice update
          sessionRef.current.then((session: any) => {
            session.sendRealtimeInput({
              media: {
                mimeType: 'text/plain',
                data: btoa(`Checkpoint coming up in ${Math.round(distance)} meters! Keep going straight!`)
              }
            });
          });
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
    } else if (destDistance < 100 && activeQuest.waypoints.every(wp => wp.completed) && sessionRef.current && connected) {
      // Approaching destination
      sessionRef.current.then((session: any) => {
        session.sendRealtimeInput({
          media: {
            mimeType: 'text/plain',
            data: btoa(`Almost there! ${activeQuest.destination.name} is just ${Math.round(destDistance)} meters away!`)
          }
        });
      });
    }
  }, [location, activeQuest, connected]);

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
                        {currentUser?.email}
                      </p>
                  </div>
              </div>
          </div>
      )}

      {/* Hidden audio element for remote call audio */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* Incoming Call Modal */}
      {callState.callType === 'incoming' && !callState.isInCall && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center animate-fade-in">
              <div className="bg-slate-800 rounded-3xl p-8 text-center max-w-sm mx-4">
                  <PhoneIncoming className="w-16 h-16 text-green-400 mx-auto mb-4 animate-pulse" />
                  <h3 className="text-xl font-bold text-white mb-2">Incoming Call</h3>
                  <p className="text-gray-400 mb-6">{callState.remoteUserName || callState.remoteUserId}</p>
                  <div className="flex gap-4 justify-center">
                      <button
                          onClick={declineCall}
                          className="p-4 bg-red-600 rounded-full hover:bg-red-700 transition"
                      >
                          <PhoneOff className="w-6 h-6" />
                      </button>
                      <button
                          onClick={acceptCall}
                          className="p-4 bg-green-600 rounded-full hover:bg-green-700 transition"
                      >
                          <Phone className="w-6 h-6" />
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Active Call Overlay */}
      {callState.isInCall && (
          <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in">
              {/* Remote Video (Full Screen) */}
              <div className="flex-1 relative bg-slate-800">
                  <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                  />

                  {/* Call Info Overlay */}
                  <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
                      <div className="bg-slate-900/80 backdrop-blur px-4 py-2 rounded-xl">
                          <p className="text-white font-bold text-lg">{callState.remoteUserName || callState.remoteUserId}</p>
                          <p className="text-gray-400 text-sm">
                              {callState.callType === 'outgoing' ? 'Calling...' : 'Connected'}
                          </p>
                      </div>
                  </div>

                  {/* Local Video (Picture-in-Picture) */}
                  <div className="absolute bottom-20 right-4 w-32 h-40 bg-slate-700 rounded-2xl overflow-hidden border-2 border-white shadow-2xl">
                      <video
                          ref={localVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover transform -scale-x-100"
                      />
                  </div>
              </div>

              {/* Call Controls */}
              <div className="p-6 bg-slate-900/95 backdrop-blur flex items-center justify-center gap-4">
                  <button
                      onClick={() => {
                          if (localVideoRef.current && localVideoRef.current.srcObject) {
                              const stream = localVideoRef.current.srcObject as MediaStream;
                              const videoTrack = stream.getVideoTracks()[0];
                              if (videoTrack) {
                                  videoTrack.enabled = !videoTrack.enabled;
                              }
                          }
                      }}
                      className="p-4 bg-slate-700 rounded-full hover:bg-slate-600 transition"
                      title="Toggle Camera"
                  >
                      {cameraOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                  </button>

                  <button
                      onClick={() => {
                          if (localVideoRef.current && localVideoRef.current.srcObject) {
                              const stream = localVideoRef.current.srcObject as MediaStream;
                              const audioTrack = stream.getAudioTracks()[0];
                              if (audioTrack) {
                                  audioTrack.enabled = !audioTrack.enabled;
                              }
                          }
                      }}
                      className="p-4 bg-slate-700 rounded-full hover:bg-slate-600 transition"
                      title="Toggle Microphone"
                  >
                      {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                  </button>

                  <button
                      onClick={endCall}
                      className="p-5 bg-red-600 rounded-full hover:bg-red-700 transition shadow-2xl"
                      title="End Call"
                  >
                      <PhoneOff className="w-8 h-8" />
                  </button>
              </div>
          </div>
      )}

      {/* Overlays for other modes */}
      {mode === 'connect' && (
          <div className="absolute inset-0 z-30 bg-slate-900 flex flex-col animate-fade-in">
              {/* Header */}
              <div className="p-4 flex justify-between items-center border-b border-slate-800">
                  <div className="flex items-center gap-3">
                      <button onClick={() => setMode('voice')} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition">
                          <X className="w-6 h-6" />
                      </button>
                      <div>
                          <h2 className="text-xl font-bold text-teal-400">Kampung Connect</h2>
                          <p className="text-xs text-gray-400">{connections.length} neighbors connected</p>
                      </div>
                  </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-800">
                  <button
                      onClick={() => setConnectTab('share')}
                      className={`flex-1 py-3 text-sm font-medium transition ${connectTab === 'share' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-400'}`}
                  >
                      Share ID
                  </button>
                  <button
                      onClick={() => setConnectTab('add')}
                      className={`flex-1 py-3 text-sm font-medium transition ${connectTab === 'add' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-400'}`}
                  >
                      Add Friend
                  </button>
                  <button
                      onClick={() => setConnectTab('friends')}
                      className={`flex-1 py-3 text-sm font-medium transition ${connectTab === 'friends' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-400'}`}
                  >
                      Friends
                  </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                  {/* Share ID Tab */}
                  {connectTab === 'share' && (
                      <div className="flex flex-col items-center">
                          <div className="bg-white p-6 rounded-3xl shadow-2xl mb-6">
                              <QRCodeSVG value={myUserId} size={200} level="H" />
                          </div>
                          <div className="flex items-center gap-2 mb-4">
                              <p className="text-white font-mono text-xl tracking-widest">{myUserId}</p>
                              <button
                                  onClick={copyUserId}
                                  className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition"
                              >
                                  {copiedId ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                              </button>
                          </div>
                          <p className="text-gray-400 text-center text-sm">
                              Share this code with your neighbors to connect instantly!
                          </p>
                      </div>
                  )}

                  {/* Add Friend Tab */}
                  {connectTab === 'add' && (
                      <div className="max-w-md mx-auto space-y-6">
                          <div>
                              <label className="block text-sm font-medium text-gray-400 mb-2">
                                  Enter Friend's Kampung ID
                              </label>
                              <div className="flex gap-2">
                                  <input
                                      type="text"
                                      value={connectInput}
                                      onChange={(e) => setConnectInput(e.target.value)}
                                      placeholder="KP-XXXXXXXX"
                                      className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 text-lg"
                                  />
                                  <button
                                      onClick={addConnection}
                                      className="px-5 py-3 bg-teal-600 rounded-xl hover:bg-teal-500 transition"
                                  >
                                      <UserPlus className="w-6 h-6" />
                                  </button>
                              </div>
                          </div>

                          <div className="relative">
                              <div className="absolute inset-0 flex items-center">
                                  <div className="w-full border-t border-slate-700"></div>
                              </div>
                              <div className="relative flex justify-center text-sm">
                                  <span className="px-4 bg-slate-900 text-gray-400">OR</span>
                              </div>
                          </div>

                          <button
                              onClick={() => setShowQRScanner(true)}
                              className="w-full py-4 bg-gradient-to-r from-teal-600 to-blue-600 text-white text-lg font-bold rounded-xl hover:from-teal-500 hover:to-blue-500 transition shadow-lg flex items-center justify-center gap-3"
                          >
                              <QrCode className="w-6 h-6" />
                              Scan QR Code
                          </button>

                          <p className="text-gray-400 text-center text-sm">
                              Ask your neighbor for their Kampung ID or scan their QR code
                          </p>
                      </div>
                  )}

                  {/* Friends List Tab */}
                  {connectTab === 'friends' && (
                      <div className="space-y-3">
                          {connections.length === 0 ? (
                              <div className="text-center py-12">
                                  <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                                  <p className="text-gray-400">No neighbors connected yet</p>
                                  <button
                                      onClick={() => setConnectTab('add')}
                                      className="mt-4 text-teal-400 text-sm hover:underline"
                                  >
                                      Add your first friend
                                  </button>
                              </div>
                          ) : (
                              connections.map(friend => (
                                  <div
                                      key={friend.id}
                                      className="flex items-center justify-between p-4 bg-slate-800 rounded-xl"
                                  >
                                      <div className="flex items-center gap-3">
                                          <div className="relative">
                                              <div className="w-12 h-12 bg-teal-600 rounded-full flex items-center justify-center">
                                                  <span className="text-lg font-bold">{friend.name[0].toUpperCase()}</span>
                                              </div>
                                              <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-800 ${
                                                  friend.status === 'online' ? 'bg-green-500' : 'bg-gray-500'
                                              }`} />
                                          </div>
                                          <div>
                                              <div className="flex items-center gap-2">
                                                  <p className="font-medium text-white">{friend.name}</p>
                                                  {friend.kampungPoints !== undefined && (
                                                      <span className="flex items-center gap-1 text-yellow-400 text-xs font-semibold">
                                                          <Trophy size={12} />
                                                          {friend.kampungPoints} KP
                                                      </span>
                                                  )}
                                              </div>
                                              <p className="text-xs text-gray-400">{friend.id}</p>
                                          </div>
                                      </div>
                                      <button
                                          onClick={() => initiateCall(friend.id, friend.name)}
                                          disabled={friend.status !== 'online'}
                                          className={`p-3 rounded-xl transition ${
                                              friend.status === 'online'
                                                  ? 'bg-green-600 hover:bg-green-500'
                                                  : 'bg-gray-700 cursor-not-allowed'
                                          }`}
                                      >
                                          <Phone className="w-5 h-5" />
                                      </button>
                                  </div>
                              ))
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}

      {mode === 'quest' && (
          <div className="absolute inset-0 z-30 bg-gradient-to-b from-slate-900 via-slate-900 to-teal-900/10 flex flex-col animate-fade-in">
             {/* Header */}
             <div className="p-4 flex justify-between items-center bg-slate-900/95 backdrop-blur-lg border-b border-slate-800">
                <div className="flex items-center gap-3">
                   <button onClick={() => setMode('voice')} className="p-3 bg-slate-800 rounded-xl hover:bg-slate-700 transition">
                      <Home className="w-6 h-6" />
                   </button>
                   <div>
                      <h2 className="text-2xl font-bold text-teal-400 flex items-center gap-2">
                         <Sparkles className="w-6 h-6" />
                         Kampung Quest
                      </h2>
                      <p className="text-sm text-gray-400 flex items-center gap-2 font-medium">
                         <Trophy className="w-4 h-4 text-yellow-400" />
                         {totalKP} Points
                      </p>
                   </div>
                </div>
                {activeQuest && questView === 'map' && (
                   <button
                      onClick={cancelQuest}
                      className="px-4 py-2 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 transition shadow-lg"
                   >
                      Cancel
                   </button>
                )}
             </div>

             {/* Navigation Tabs */}
             <div className="flex border-b border-slate-800 bg-slate-900/80 backdrop-blur">
                <button
                   onClick={() => setQuestView('dashboard')}
                   className={`flex-1 py-4 text-base font-bold transition flex items-center justify-center gap-2 ${
                      questView === 'dashboard' ? 'text-teal-400 border-b-4 border-teal-400 bg-teal-900/20' : 'text-gray-400'
                   }`}
                >
                   <TrendingUp className="w-5 h-5" />
                   Dashboard
                </button>
                <button
                   onClick={() => setQuestView('events')}
                   className={`flex-1 py-4 text-base font-bold transition flex items-center justify-center gap-2 ${
                      questView === 'events' ? 'text-teal-400 border-b-4 border-teal-400 bg-teal-900/20' : 'text-gray-400'
                   }`}
                >
                   <Calendar className="w-5 h-5" />
                   Events
                </button>
                <button
                   onClick={() => setQuestView('map')}
                   className={`flex-1 py-4 text-base font-bold transition flex items-center justify-center gap-2 ${
                      questView === 'map' ? 'text-teal-400 border-b-4 border-teal-400 bg-teal-900/20' : 'text-gray-400'
                   }`}
                >
                   <MapPinned className="w-5 h-5" />
                   Map
                </button>
             </div>

             {/* Content */}
             <div className="flex-1 overflow-y-auto">
                {/* Dashboard View */}
                {questView === 'dashboard' && (
                   <div className="p-6 space-y-6">
                      {/* Welcome Card */}
                      <div className="bg-gradient-to-br from-teal-600 to-blue-600 rounded-3xl p-6 text-white shadow-2xl">
                         <h3 className="text-2xl font-bold mb-2">Welcome back! 🎉</h3>
                         <p className="text-lg opacity-90">
                            {activeQuest
                               ? `You're ${Math.round(activeQuest.progress)}% through your quest!`
                               : 'Ready to explore your neighborhood?'
                            }
                         </p>
                      </div>

                      {/* Active Quest Card */}
                      {activeQuest && (
                         <div className="bg-slate-800 rounded-2xl p-6 border-2 border-teal-500 shadow-lg">
                            <div className="flex items-center justify-between mb-4">
                               <h4 className="text-xl font-bold text-white flex items-center gap-2">
                                  <Target className="w-6 h-6 text-teal-400" />
                                  Active Quest
                               </h4>
                               <div className="text-3xl font-bold text-teal-400">{Math.round(activeQuest.progress)}%</div>
                            </div>

                            <h5 className="text-lg font-bold text-white mb-2">{activeQuest.title}</h5>
                            <p className="text-gray-400 mb-4">{activeQuest.description}</p>

                            <div className="grid grid-cols-3 gap-3 mb-4">
                               <div className="bg-slate-700 rounded-xl p-3 text-center">
                                  <MapPin className="w-5 h-5 text-teal-400 mx-auto mb-1" />
                                  <p className="text-sm font-bold text-white">{activeQuest.distance} km</p>
                               </div>
                               <div className="bg-slate-700 rounded-xl p-3 text-center">
                                  <Clock className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                                  <p className="text-sm font-bold text-white">{activeQuest.duration} min</p>
                               </div>
                               <div className="bg-slate-700 rounded-xl p-3 text-center">
                                  <Award className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
                                  <p className="text-sm font-bold text-white">{activeQuest.reward}</p>
                               </div>
                            </div>

                            <div className="w-full bg-slate-700 rounded-full h-3 mb-4">
                               <div
                                  className="bg-gradient-to-r from-teal-400 to-blue-500 h-3 rounded-full transition-all duration-500"
                                  style={{ width: `${activeQuest.progress}%` }}
                               />
                            </div>

                            <button
                               onClick={() => setQuestView('map')}
                               className="w-full py-4 bg-teal-600 text-white text-lg font-bold rounded-xl hover:bg-teal-500 transition flex items-center justify-center gap-2 shadow-lg"
                            >
                               <MapPinned className="w-6 h-6" />
                               View Map
                            </button>
                         </div>
                      )}

                      {/* Today's Events */}
                      <div>
                         <h4 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <Calendar className="w-6 h-6 text-teal-400" />
                            Nearby Events
                         </h4>
                         <div className="space-y-3">
                            {communityEvents.slice(0, 3).map(event => {
                               const isJoined = event.participants.includes(myUserId);
                               const getCategoryColor = (cat: string) => {
                                  switch (cat) {
                                     case 'fitness': return 'from-green-600 to-emerald-600';
                                     case 'social': return 'from-blue-600 to-cyan-600';
                                     case 'food': return 'from-orange-600 to-yellow-600';
                                     case 'arts': return 'from-pink-600 to-purple-600';
                                     case 'education': return 'from-purple-600 to-indigo-600';
                                     default: return 'from-gray-600 to-slate-600';
                                  }
                               };

                               return (
                                  <div key={event.id} className={`bg-gradient-to-r ${getCategoryColor(event.category)} rounded-2xl p-5 shadow-lg`}>
                                     <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                           <h5 className="text-lg font-bold text-white mb-1">{event.name}</h5>
                                           <p className="text-sm text-white/80">{event.description}</p>
                                        </div>
                                     </div>
                                     <div className="flex items-center gap-3 text-sm text-white/90 mb-3">
                                        <span className="flex items-center gap-1">
                                           <Clock className="w-4 h-4" />
                                           {event.time}
                                        </span>
                                        <span className="flex items-center gap-1">
                                           <Users className="w-4 h-4" />
                                           {event.participants.length}/{event.maxParticipants}
                                        </span>
                                        <span className="flex items-center gap-1">
                                           <Award className="w-4 h-4" />
                                           {event.reward}
                                        </span>
                                     </div>
                                     <div className="space-y-2">
                                        <div className="flex gap-2">
                                           <button
                                              onClick={() => isJoined ? leaveEvent(event.id) : joinEvent(event.id)}
                                              className={`flex-1 py-3 text-base font-bold rounded-xl transition shadow-lg ${
                                                 isJoined
                                                    ? 'bg-white/20 text-white border-2 border-white'
                                                    : 'bg-white text-slate-900 hover:bg-gray-100'
                                              }`}
                                           >
                                              {isJoined ? '✓ Joined' : 'Join Event'}
                                           </button>
                                           {isJoined && (
                                              <button
                                                 onClick={() => openCheckInCamera({ type: 'event', id: event.id })}
                                                 className="px-5 py-3 bg-white text-slate-900 text-base font-bold rounded-xl hover:bg-gray-100 transition shadow-lg flex items-center gap-2"
                                              >
                                                 <Camera className="w-5 h-5" />
                                                 Check In
                                              </button>
                                           )}
                                        </div>
                                        <button
                                           onClick={() => navigateToEvent(event)}
                                           className="w-full py-3 bg-white/30 text-white text-base font-bold rounded-xl hover:bg-white/40 transition border-2 border-white/50 flex items-center justify-center gap-2"
                                        >
                                           <Navigation className="w-5 h-5" />
                                           Get Directions
                                        </button>
                                     </div>
                                  </div>
                               );
                            })}
                         </div>
                         <button
                            onClick={() => setQuestView('events')}
                            className="w-full mt-4 py-4 bg-slate-800 text-white text-lg font-bold rounded-xl hover:bg-slate-700 transition border-2 border-slate-700"
                         >
                            View All Events
                         </button>
                      </div>

                      {/* Community Feed (Shared Photos) */}
                      <div>
                         <div className="flex items-center justify-between mb-4">
                            <h4 className="text-xl font-bold text-white flex items-center gap-2">
                               <Image className="w-6 h-6 text-teal-400" />
                               Community Moments
                            </h4>
                            <button
                               onClick={() => setShowPhotoGallery(true)}
                               className="text-teal-400 text-sm font-bold hover:underline"
                            >
                               View All
                            </button>
                         </div>
                         <div className="grid grid-cols-3 gap-3">
                            {(() => {
                               // Collect all check-ins from events, quests, and waypoints
                               const allCheckIns = [
                                  ...communityEvents.flatMap(e => e.checkIns),
                                  ...quests.flatMap(q => q.checkIns || []),
                                  ...quests.flatMap(q => q.waypoints.flatMap(wp => wp.checkIns || []))
                               ];

                               // Sort by timestamp (newest first) and take first 6
                               const recentCheckIns = allCheckIns
                                  .sort((a, b) => b.timestamp - a.timestamp)
                                  .slice(0, 6);

                               if (recentCheckIns.length === 0) {
                                  return (
                                     <div className="col-span-3 text-center py-8 text-gray-400">
                                        <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                        <p>No photos yet. Check in at events to share moments!</p>
                                     </div>
                                  );
                               }

                               return recentCheckIns.map((checkIn, idx) => (
                                  <div key={idx} className="aspect-square rounded-xl overflow-hidden border-2 border-slate-700 hover:border-teal-400 transition cursor-pointer">
                                     <img src={checkIn.photoUrl} alt="Check-in" className="w-full h-full object-cover" />
                                  </div>
                               ));
                            })()}
                         </div>
                      </div>
                   </div>
                )}

                {/* Events Discovery View */}
                {questView === 'events' && (
                   <div className="p-6 space-y-4">
                      <div className="mb-4">
                         <h3 className="text-2xl font-bold text-white mb-2">Discover Events</h3>
                         <p className="text-gray-400 text-lg">Join activities and connect with neighbors!</p>
                      </div>

                      {communityEvents.map(event => {
                         const isJoined = event.participants.includes(myUserId);
                         const getCategoryColor = (cat: string) => {
                            switch (cat) {
                               case 'fitness': return { bg: 'from-green-600 to-emerald-600', icon: '🏃' };
                               case 'social': return { bg: 'from-blue-600 to-cyan-600', icon: '👥' };
                               case 'food': return { bg: 'from-orange-600 to-yellow-600', icon: '🍜' };
                               case 'arts': return { bg: 'from-pink-600 to-purple-600', icon: '🎨' };
                               case 'education': return { bg: 'from-purple-600 to-indigo-600', icon: '📚' };
                               default: return { bg: 'from-gray-600 to-slate-600', icon: '📍' };
                            }
                         };

                         const style = getCategoryColor(event.category);

                         return (
                            <div key={event.id} className={`bg-gradient-to-r ${style.bg} rounded-3xl p-6 shadow-2xl`}>
                               <div className="flex items-start gap-4 mb-4">
                                  <div className="text-5xl">{style.icon}</div>
                                  <div className="flex-1">
                                     <h4 className="text-2xl font-bold text-white mb-2">{event.name}</h4>
                                     <p className="text-lg text-white/90 mb-3">{event.description}</p>

                                     <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-white/20 rounded-xl p-3">
                                           <p className="text-sm text-white/70 mb-1">Time</p>
                                           <p className="text-base font-bold text-white">{event.time}</p>
                                        </div>
                                        <div className="bg-white/20 rounded-xl p-3">
                                           <p className="text-sm text-white/70 mb-1">Spots Left</p>
                                           <p className="text-base font-bold text-white">
                                              {event.maxParticipants ? event.maxParticipants - event.participants.length : '∞'}
                                           </p>
                                        </div>
                                        <div className="bg-white/20 rounded-xl p-3">
                                           <p className="text-sm text-white/70 mb-1">Reward</p>
                                           <p className="text-base font-bold text-white">{event.reward}</p>
                                        </div>
                                        <div className="bg-white/20 rounded-xl p-3">
                                           <p className="text-sm text-white/70 mb-1">Joined</p>
                                           <p className="text-base font-bold text-white">{event.participants.length} people</p>
                                        </div>
                                     </div>

                                     <div className="space-y-3">
                                        <div className="flex gap-3">
                                           <button
                                              onClick={() => isJoined ? leaveEvent(event.id) : joinEvent(event.id)}
                                              className={`flex-1 py-4 text-lg font-bold rounded-xl transition shadow-lg ${
                                                 isJoined
                                                    ? 'bg-white/20 text-white border-2 border-white'
                                                    : 'bg-white text-slate-900 hover:bg-gray-100'
                                              }`}
                                           >
                                              {isJoined ? '✓ Joined' : 'Join Event'}
                                           </button>
                                           {isJoined && (
                                              <button
                                                 onClick={() => openCheckInCamera({ type: 'event', id: event.id })}
                                                 className="px-6 py-4 bg-white text-slate-900 text-lg font-bold rounded-xl hover:bg-gray-100 transition shadow-lg flex items-center gap-2"
                                              >
                                                 <Camera className="w-6 h-6" />
                                                 Check In
                                              </button>
                                           )}
                                        </div>
                                        <button
                                           onClick={() => navigateToEvent(event)}
                                           className="w-full py-4 bg-white/30 text-white text-lg font-bold rounded-xl hover:bg-white/40 transition border-2 border-white/50 flex items-center justify-center gap-2"
                                        >
                                           <Navigation className="w-6 h-6" />
                                           Get Directions
                                        </button>
                                     </div>

                                     {/* Event Check-ins */}
                                     {event.checkIns.length > 0 && (
                                        <div className="mt-4">
                                           <p className="text-sm text-white/80 mb-2">{event.checkIns.length} check-ins</p>
                                           <div className="flex gap-2 overflow-x-auto">
                                              {event.checkIns.slice(0, 5).map((checkIn, idx) => (
                                                 <img
                                                    key={idx}
                                                    src={checkIn.photoUrl}
                                                    alt="Check-in"
                                                    className="w-20 h-20 rounded-xl object-cover border-2 border-white/30"
                                                 />
                                              ))}
                                           </div>
                                        </div>
                                     )}
                                  </div>
                               </div>
                            </div>
                         );
                      })}
                   </div>
                )}

                {/* Map View */}
                {questView === 'map' && (
                   <div className="relative h-full">
                      <MapView
                         userLocation={location}
                         onSelectDestination={handleSelectDestination}
                         activeQuest={activeQuest}
                         onWaypointReached={handleWaypointReached}
                         communityEvents={communityEvents}
                         onEventSelect={setSelectedEvent}
                         showEvents={true}
                      />

                      {/* Active Quest Overlay */}
                      {activeQuest && (
                         <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur-lg rounded-2xl p-4 border-2 border-teal-500 shadow-2xl">
                            <div className="flex items-center justify-between mb-3">
                               <div className="flex-1">
                                  <h3 className="font-bold text-white text-lg">{activeQuest.title}</h3>
                                  <p className="text-sm text-gray-400 mt-1">
                                     {activeQuest.distance} km • {activeQuest.duration} min • {activeQuest.reward}
                                  </p>
                               </div>
                               <div className="text-right">
                                  <div className="text-3xl font-bold text-teal-400">{Math.round(activeQuest.progress)}%</div>
                               </div>
                            </div>

                            <div className="w-full bg-slate-800 rounded-full h-3 mb-3">
                               <div
                                  className="bg-gradient-to-r from-teal-400 to-blue-500 h-3 rounded-full transition-all duration-500"
                                  style={{ width: `${activeQuest.progress}%` }}
                               />
                            </div>

                            <button
                               onClick={() => openCheckInCamera({ type: 'quest', id: activeQuest.id })}
                               className="w-full py-3 bg-teal-600 text-white text-lg font-bold rounded-xl hover:bg-teal-500 transition flex items-center justify-center gap-2"
                            >
                               <Camera className="w-5 h-5" />
                               Take Photo
                            </button>
                         </div>
                      )}

                      {/* Selected Event Overlay */}
                      {selectedEvent && !activeQuest && (
                         <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur-lg rounded-2xl p-5 border-2 border-blue-500 shadow-2xl">
                            <h3 className="font-bold text-white text-xl mb-2">{selectedEvent.name}</h3>
                            <p className="text-gray-300 mb-3">{selectedEvent.description}</p>
                            <div className="flex gap-2 mb-4 text-sm text-gray-400">
                               <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{selectedEvent.time}</span>
                               <span className="flex items-center gap-1"><Award className="w-4 h-4" />{selectedEvent.reward}</span>
                            </div>
                            <div className="flex gap-2">
                               <button
                                  onClick={() => {
                                     joinEvent(selectedEvent.id);
                                     setSelectedEvent(null);
                                  }}
                                  className="flex-1 py-3 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-500 transition"
                               >
                                  Join Event
                               </button>
                               <button
                                  onClick={() => setSelectedEvent(null)}
                                  className="px-4 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition"
                               >
                                  <X className="w-5 h-5" />
                               </button>
                            </div>
                         </div>
                      )}

                      {/* Location Required */}
                      {!location && (
                         <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 backdrop-blur-lg">
                            <div className="text-center">
                               <MapPin className="w-20 h-20 text-teal-400 mx-auto mb-4" />
                               <h3 className="text-2xl font-bold text-white mb-2">Location Required</h3>
                               <p className="text-gray-400 text-lg">Please enable location access to use quests</p>
                            </div>
                         </div>
                      )}
                   </div>
                )}
             </div>
          </div>
      )}

      {/* Check-In Camera Modal */}
      {showCheckInCamera && (
         <div className="absolute inset-0 z-50 bg-black flex flex-col">
            <div className="p-4 bg-slate-900/90 backdrop-blur flex items-center justify-between flex-shrink-0">
               <h3 className="text-xl font-bold text-white">Take a Photo</h3>
               <button
                  onClick={() => {
                     setShowCheckInCamera(false);
                     setCapturedPhoto(null);
                     if (checkInVideoRef.current?.srcObject) {
                        const stream = checkInVideoRef.current.srcObject as MediaStream;
                        stream.getTracks().forEach(track => track.stop());
                     }
                  }}
                  className="p-2 bg-slate-800 rounded-full"
               >
                  <X className="w-6 h-6" />
               </button>
            </div>

            <div className="relative flex-1 min-h-0 max-h-[60vh]">
               <video
                  ref={checkInVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover transform -scale-x-100"
               />
               <canvas ref={checkInCanvasRef} className="hidden" />

               {capturedPhoto && (
                  <img
                     src={capturedPhoto}
                     alt="Captured"
                     className="absolute inset-0 w-full h-full object-cover"
                  />
               )}
            </div>

            <div className="p-4 bg-slate-900/90 backdrop-blur flex-shrink-0">
               {!capturedPhoto ? (
                  <button
                     onClick={captureCheckInPhoto}
                     className="w-full py-4 bg-teal-600 text-white text-lg font-bold rounded-full hover:bg-teal-500 transition flex items-center justify-center gap-2 shadow-2xl"
                  >
                     <Camera className="w-6 h-6" />
                     Capture Photo
                  </button>
               ) : (
                  <div className="space-y-2">
                     <button
                        onClick={submitCheckIn}
                        className="w-full py-4 bg-green-600 text-white text-lg font-bold rounded-full hover:bg-green-500 transition flex items-center justify-center gap-2 shadow-2xl"
                     >
                        <Check className="w-6 h-6" />
                        Submit Check-In
                     </button>
                     <button
                        onClick={() => setCapturedPhoto(null)}
                        className="w-full py-3 bg-slate-800 text-white text-base font-bold rounded-full hover:bg-slate-700 transition"
                     >
                        Retake Photo
                     </button>
                  </div>
               )}
            </div>
         </div>
      )}

      {/* Photo Gallery Modal */}
      {showPhotoGallery && (
         <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col">
            <div className="p-4 bg-slate-800 flex items-center justify-between">
               <h3 className="text-xl font-bold text-white">Community Moments</h3>
               <button
                  onClick={() => setShowPhotoGallery(false)}
                  className="p-2 bg-slate-700 rounded-full"
               >
                  <X className="w-6 h-6" />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
               <div className="grid grid-cols-2 gap-3">
                  {(() => {
                     // Collect all check-ins from events, quests, and waypoints
                     const allCheckIns = [
                        ...communityEvents.flatMap(e => e.checkIns),
                        ...quests.flatMap(q => q.checkIns || []),
                        ...quests.flatMap(q => q.waypoints.flatMap(wp => wp.checkIns || []))
                     ];

                     // Sort by timestamp (newest first)
                     const sortedCheckIns = allCheckIns.sort((a, b) => b.timestamp - a.timestamp);

                     if (sortedCheckIns.length === 0) {
                        return (
                           <div className="col-span-2 text-center py-16 text-gray-400">
                              <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                              <p className="text-lg">No photos yet</p>
                              <p className="text-sm mt-2">Check in at events and quests to share moments with the community!</p>
                           </div>
                        );
                     }

                     return sortedCheckIns.map((checkIn, idx) => (
                        <div key={idx} className="bg-slate-800 rounded-2xl overflow-hidden">
                           <img src={checkIn.photoUrl} alt="Check-in" className="w-full aspect-square object-cover" />
                           <div className="p-3">
                              <p className="text-white font-bold">{checkIn.userName}</p>
                              <p className="text-gray-400 text-sm">
                                 {new Date(checkIn.timestamp).toLocaleDateString()} at {new Date(checkIn.timestamp).toLocaleTimeString()}
                              </p>
                           </div>
                        </div>
                     ));
                  })()}
               </div>
            </div>
         </div>
      )}

      {/* QR Scanner Modal */}
      {showQRScanner && (
         <div className="absolute inset-0 z-50 bg-black flex flex-col">
            <div className="p-4 bg-slate-900/90 backdrop-blur flex items-center justify-between">
               <h3 className="text-xl font-bold text-white">Scan QR Code</h3>
               <button
                  onClick={() => {
                     setShowQRScanner(false);
                     setQrScanResult(null);
                     if (qrScanIntervalRef.current) {
                        clearInterval(qrScanIntervalRef.current);
                     }
                     if (qrVideoRef.current?.srcObject) {
                        const stream = qrVideoRef.current.srcObject as MediaStream;
                        stream.getTracks().forEach(track => track.stop());
                     }
                  }}
                  className="p-2 bg-slate-800 rounded-full"
               >
                  <X className="w-6 h-6" />
               </button>
            </div>

            <div className="flex-1 relative bg-slate-800 flex items-center justify-center">
               <video
                  ref={qrVideoRef}
                  autoPlay
                  playsInline
                  className="max-w-full max-h-full object-contain"
               />
               <canvas ref={qrCanvasRef} className="hidden" />

               {/* Scanning Overlay */}
               <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-64 h-64">
                     {/* Corner brackets */}
                     <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-teal-400"></div>
                     <div className="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-teal-400"></div>
                     <div className="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-teal-400"></div>
                     <div className="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-teal-400"></div>

                     {/* Scanning line animation */}
                     <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute w-full h-1 bg-teal-400 animate-scan"></div>
                     </div>
                  </div>
               </div>

               {qrScanResult && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center">
                     <div className="bg-slate-800 rounded-2xl p-6 max-w-sm mx-4 text-center">
                        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                           <Check className="w-10 h-10 text-white" />
                        </div>
                        <h4 className="text-xl font-bold text-white mb-2">QR Code Detected!</h4>
                        <p className="text-gray-300 mb-4">Found Kampung ID:</p>
                        <p className="text-teal-400 font-mono text-lg mb-6">{qrScanResult}</p>
                        <button
                           onClick={() => {
                              setConnectInput(qrScanResult);
                              setShowQRScanner(false);
                              setQrScanResult(null);
                              if (qrScanIntervalRef.current) {
                                 clearInterval(qrScanIntervalRef.current);
                              }
                              if (qrVideoRef.current?.srcObject) {
                                 const stream = qrVideoRef.current.srcObject as MediaStream;
                                 stream.getTracks().forEach(track => track.stop());
                              }
                              // Switch to add tab and auto-add
                              setConnectTab('add');
                              setTimeout(() => addConnection(), 100);
                           }}
                           className="w-full py-3 bg-teal-600 text-white text-lg font-bold rounded-xl hover:bg-teal-500 transition"
                        >
                           Add Friend
                        </button>
                     </div>
                  </div>
               )}
            </div>

            <div className="p-6 bg-slate-900/90 backdrop-blur text-center">
               <p className="text-gray-400 text-lg">
                  Position the QR code within the frame
               </p>
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