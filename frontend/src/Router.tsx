import { Navigate, Route, Routes } from 'react-router-dom';
import { GameLanding } from './pages/GameLanding';
// import GameStart from './pages/GameStart';
import { GamePage } from './components/GamePage';
import RoomPage from './components/RoomPage';
import VoiceChatRoom from './pages/VoiceChatRoom';

export const Router = () => {
  return (
    <>
      <Routes>
        <Route path="/" element={<VoiceChatRoom />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/game/:roomId" element={<GamePage />} />
        <Route path="/vc" element={<VoiceChatRoom />} />
        {/* <Route path="/game" element={<GameStart />} /> */}
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
};
