import { Navigate, Route, Routes } from 'react-router-dom';
import { GameLanding } from './pages/GameLanding';
// import GameStart from './pages/GameStart';
import { GamePage } from './components/GamePage';
import RoomPage from './components/RoomPage';

export const Router = () => {
  return (
    <>
      <Routes>
        <Route path="/" element={<GameLanding />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/game/:roomId" element={<GamePage />} />
        {/* <Route path="/game" element={<GameStart />} /> */}
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
};
