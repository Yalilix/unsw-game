import './style.css';
import { Intro } from '../components/Intro';
import Particles from '../components/Particles';
import { Footer } from '../components/Footer';

export const GameLanding = () => {
  return (
    <div
      className="min-h-screen w-full bg-gradient-space relative"
      style={{ fontFamily: 'DragonHunter, sans-serif' }}
    >
      <Particles
        particleColors={['#ffffff', '#ffffff']}
        particleCount={900}
        particleSpread={10}
        speed={0.5}
        particleBaseSize={100}
        moveParticlesOnHover={true}
        alphaParticles={false}
        disableRotation={false}
      />
      <Intro />
      <Footer />
    </div>
  );
};
