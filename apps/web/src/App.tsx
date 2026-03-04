import { Routes, Route } from 'react-router-dom';
import { EditorLayout } from './components/layout/EditorLayout';
import { DebugPanel } from './components/debug/DebugPanel';
import { GlobalAssistantModal } from './components/assistant/GlobalAssistantModal';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<EditorLayout />} />
        <Route path="/project/:projectId" element={<EditorLayout />} />
      </Routes>
      <GlobalAssistantModal />
      <DebugPanel />
    </>
  );
}

export default App;
