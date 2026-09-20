import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { ThemeProvider } from '../../src/components/ThemeProvider';
import { PlanetHero } from './PlanetHero';
import { PaletteInput } from './PaletteInput';
import './palette.css';
import '../../src/index.css';
import './styles.css';

// Render the real site; only the Index hero is substituted in this preview.
// No service worker is registered on the preview origin.
createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme="pastel"><App homeHero={PlanetHero} homeInput={PaletteInput}/></ThemeProvider>,
);
