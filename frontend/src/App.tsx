import { Routes, Route, Navigate } from 'react-router-dom';
import { WaitingRoom } from './pages/WaitingRoom';
import { GamePage } from './pages/GamePage';
import { GameLanding } from './pages/GameLanding';
import { SocketProvider } from './hooks/SocketContext';
import RoomPage from './pages/RoomPage';

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
