import { createRoot } from 'react-dom/client';
import Host from './components/Host';
import Screen from './components/Screen';
import { useProjector } from './lib/useGame';
import { appUrl, resolveAppRoute } from './lib/routes';
import './styles.css';

function Projector() {
  const { view, connected } = useProjector();
  return <Screen view={view} connected={connected} />;
}

const route = resolveAppRoute(window.location.pathname, window.location.hash);
const canonical = new URL(appUrl(route), window.location.origin);
canonical.search = window.location.search;
if (`${window.location.pathname}${window.location.hash}` !== `${canonical.pathname}${canonical.hash}`) {
  window.history.replaceState(null, '', `${canonical.pathname}${canonical.search}${canonical.hash}`);
}
const isScreen = route === 'screen';
document.title = isScreen ? 'Своя игра — экран зрителей' : 'Своя игра — пульт ведущего';
createRoot(document.getElementById('root')!).render(isScreen ? <Projector /> : <Host />);
