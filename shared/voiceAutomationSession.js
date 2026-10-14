// A spoken media command remains valid when the user ends the call while its
// server-side brief is still being prepared. A new call or an unmounted agent
// must not start an older paid generation request.
export const shouldCompleteVoiceAutomation = ({ commandSession, currentSession, voiceActive, mounted }) =>
  mounted && (commandSession === currentSession || (!voiceActive && currentSession === commandSession + 1));
