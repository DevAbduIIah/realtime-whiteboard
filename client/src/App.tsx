import { SocketProvider, useSocket } from "./contexts/SocketContext";
import { JoinScreen } from "./components/JoinScreen";
import { Whiteboard } from "./components/Whiteboard";

function AppContent() {
  const { currentUser } = useSocket();

  if (!currentUser) {
    return <JoinScreen />;
  }

  return <Whiteboard />;
}

export default function App() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
