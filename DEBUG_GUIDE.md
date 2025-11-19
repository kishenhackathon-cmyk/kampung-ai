# Debugging Guide for Kampung AI Microphone Issues

## Chrome Developer Console Instructions

Follow these steps to debug the Gemini Live API microphone issues:

### 1. Open Chrome Developer Console
- Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
- Click on the "Console" tab

### 2. Check Initial Environment
When you load the page, you should see:
```
[DEBUG] API Key Status: Found (AIzaSy...)
[INFO] Environment Check:
- Protocol: http: or https:
- Host: localhost or your domain
- User Agent: ...
- MediaDevices API: true
- AudioContext: true
```

**Important Checks:**
- ✅ API Key must show "Found"
- ✅ Protocol should be "https:" (or "http:" if localhost)
- ✅ MediaDevices API must be true
- ✅ AudioContext must be true

### 3. Click "CONNECT" Button
Watch the console for these messages in order:

```
[DEBUG] Starting Gemini Live session...
[DEBUG] Initializing Audio Context...
[DEBUG] Audio Context created, state: running
[DEBUG] Audio sample rate: 48000 Hz (or 44100)
[DEBUG] Requesting microphone access...
```

### 4. Allow Microphone Access
When the browser asks for microphone permission, click "Allow"

You should then see:
```
[DEBUG] Microphone access granted
[DEBUG] Audio tracks: 1
[DEBUG] Connecting to Gemini Live API...
[DEBUG] Model: gemini-2.5-flash-native-audio-preview-09-2025
```

### 5. Check Connection Success
If successful, you'll see:
```
[SUCCESS] Gemini Live Connected!
[DEBUG] Setting up audio pipeline...
[DEBUG] Media stream source created
[DEBUG] Session promise resolved - ready to send audio
[DEBUG] Sending audio chunk #1, size: XXXX chars, sample rate: 48000
[DEBUG] Sending audio chunk #2, size: XXXX chars, sample rate: 48000
...
```

### 6. Common Error Messages and Solutions

#### Error: "API key is missing!"
**Solution:** Check your `.env` file contains:
```
GEMINI_API_KEY=your_actual_api_key_here
```
Then restart the dev server: `npm run dev`

#### Error: "Microphone access failed: NotAllowedError"
**Solution:**
- Click the camera icon in the URL bar and allow microphone access
- If using HTTP (not localhost), switch to HTTPS

#### Error: "AudioContext not supported"
**Solution:** Update your browser to the latest version

#### Error: "Session error" or API connection fails
**Possible causes:**
1. Invalid API key - verify it's correct in .env
2. API quota exceeded - check Google Cloud Console
3. Network issues - check internet connection
4. CORS issues - make sure you're running via the dev server

#### No audio chunks being sent
Check if you see:
```
[DEBUG] Sending audio chunk #1...
```
If not, the microphone may be muted or not working properly.

### 7. Test with Different Browsers
If Chrome doesn't work, try:
- Edge (latest version)
- Firefox (may need different audio settings)
- Safari (check security settings)

### 8. Additional Debugging Commands
Run these in the console to check status:

```javascript
// Check if API key is loaded
console.log('API Key:', process.env.API_KEY);

// Check browser capabilities
console.log('MediaDevices:', navigator.mediaDevices);
console.log('getUserMedia:', navigator.mediaDevices?.getUserMedia);

// Check current protocol
console.log('Protocol:', window.location.protocol);

// List audio devices
navigator.mediaDevices.enumerateDevices().then(devices => {
    console.log('Audio input devices:', devices.filter(d => d.kind === 'audioinput'));
});
```

### 9. Network Tab Check
1. Switch to "Network" tab in DevTools
2. Look for WebSocket connections to Gemini API
3. Check for any failed requests (shown in red)

### 10. Quick Fixes to Try

1. **Clear browser cache**: Ctrl+Shift+Del → Clear browsing data
2. **Reset permissions**: Settings → Privacy → Site Settings → Microphone → Reset
3. **Try incognito mode**: Ctrl+Shift+N (may help with extensions causing issues)
4. **Disable ad blockers**: They might block API connections
5. **Check firewall**: Ensure it's not blocking WebSocket connections

## Report Issues

If you still have problems after following this guide, please note:
1. All error messages from the console
2. Your browser version (Help → About)
3. Whether you're using HTTP or HTTPS
4. Any network errors shown

The enhanced logging will help identify exactly where the connection is failing.