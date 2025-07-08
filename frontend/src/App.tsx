import { Routes, Route, Navigate } from 'react-router-dom';
import { WaitingRoom } from './components/WaitingRoom';
import { GamePage } from './components/GamePage';
import { GameLanding } from './pages/GameLanding';
import { SocketProvider } from './SocketContext';
import RoomPage from './components/RoomPage';
// import VoiceChatRoom from './pages/VoiceChatRoom';

function App() {
  return (
    <SocketProvider>
      <Routes>
        <Route path="/" element={<GameLanding />} />
        <Route path="/waitingroom" element={<WaitingRoom />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/game/:roomId" element={<GamePage />} />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </SocketProvider>
  );
}

export default App;
