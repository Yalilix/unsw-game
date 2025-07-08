import { Routes, Route, Navigate } from 'react-router-dom';
import { WaitingRoom } from './components/WaitingRoom';
import { GamePage } from './components/GamePage';
import RoomPage from './components/RoomPage';
import { GameLanding } from './pages/GameLanding';

function App() {
  return (
    <Routes>
      <Route path="/" element={<GameLanding />} />
      <Route path="/waitingroom" element={<WaitingRoom />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="/game/:roomId" element={<GamePage />} />
      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
