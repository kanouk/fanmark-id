import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { ThemeProvider } from '../../src/components/ThemeProvider';
import { PlanetHero } from './PlanetHero';
import { PaletteInput } from './PaletteInput';
import './palette.css';
import '../../src/index.css';
import './styles.css';
import './home.css';

// Render the real site with the prototype hero, input, and home-only visual system.
// No service worker is registered on the preview origin.
createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme="pastel"><App homeHero={PlanetHero} homeInput={PaletteInput}/></ThemeProvider>,
);
