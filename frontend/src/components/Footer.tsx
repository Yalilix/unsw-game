import { Github } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="z-20 absolute bottom-0 left-0 p-6 lg:p-8">
      <div className="flex space-x-4">
        <a
          href="https://github.com/Froxzen/unsw-game"
          className="text-foreground hover:text-primary transition-colors p-2"
          aria-label="Facebook"
        >
          <Github size={24} />
        </a>
      </div>
    </footer>
  );
};
