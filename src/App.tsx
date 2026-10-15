// Корневой компонент: каркас окна и анимированная смена экранов.
import { Sidebar, StatusBar, TitleBar } from './components/Shell';
import { Toasts } from './components/ui';
import { Apps } from './screens/Apps';
import { Connections } from './screens/Connections';
import { Home } from './screens/Home';
import { Profiles } from './screens/Profiles';
import { Rules } from './screens/Rules';
import { Servers } from './screens/Servers';
import { Settings } from './screens/Settings';
import { useHalo, type Screen } from './store';

const SCREENS: Record<Screen, () => JSX.Element | null> = {
  home: Home,
  servers: Servers,
  rules: Rules,
  apps: Apps,
  profiles: Profiles,
  connections: Connections,
  settings: Settings,
};

export function App() {
  const { screen, toasts, closeToast, state } = useHalo();
  const Current = SCREENS[screen];
  return (
    <div className="window">
      <TitleBar />
      <div className="body">
        <Sidebar />
        <main className="content">
          {state && (
            // Смена экрана — CSS-анимация: она не застревает, в отличие от анимации прозрачности через WAAPI.
            <div key={screen} className="page page-in">
              <Current />
            </div>
          )}
        </main>
      </div>
      <StatusBar />
      <Toasts items={toasts} onClose={closeToast} />
    </div>
  );
}
