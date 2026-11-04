/* eslint-disable react-refresh/only-export-components */
// Web（SPACE-client）の実装の Provider を検証するための画面。配布物には含めない。
// @web は SPACE_WEB_DIR/src を指す（e2e-desktop/desktop.test.mjs で設定）。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthContext } from '@web/features/user/context/authContextValue';
import { NotificationProvider } from '@web/features/user/context/NotificationContext';
import { UnreadRoomCountsProvider } from '@web/features/user/context/UnreadRoomCountsContext';
import { ToastProvider } from '@web/context/ToastContext';
import { useToast } from '@web/context/useToast';
import { DesktopIntegration } from '@web/components/DesktopIntegration';

localStorage.setItem('space_user_token', 'fixture-token');
localStorage.setItem('space_user_id', 'fixture-user');
function Toasts() {
  const { toasts } = useToast();
  return <output id="toasts">{toasts.map((toast) => toast.message).join(',')}</output>;
}
function Fixture() {
  const [token, setToken] = useState<string | null>('fixture-token');
  const logout = async () => { localStorage.removeItem('space_user_token'); setToken(null); };
  return <BrowserRouter><AuthContext.Provider value={{ token, userId: 'fixture-user', login: () => {}, logout }}>
    <ToastProvider><NotificationProvider><DesktopIntegration />
      {token && <UnreadRoomCountsProvider><p>ログイン済み</p></UnreadRoomCountsProvider>}
      <Toasts /><button onClick={() => void logout()}>ログアウト</button>
    </NotificationProvider></ToastProvider>
  </AuthContext.Provider></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
